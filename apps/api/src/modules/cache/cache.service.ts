import { EventEmitter } from "node:events";
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";
import { Redis } from "ioredis";

export interface CacheStats {
  connected: boolean;
  hits: number;
  misses: number;
  hitRatioPercent: number;
  totalReads: number;
  totalWrites: number;
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly localEmitter = new EventEmitter();
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private isConnected = false;
  private hits = 0;
  private misses = 0;
  private totalWrites = 0;

  constructor() {
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    try {
      this.client = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
        retryStrategy: (times) => {
          if (times > 3) return null; // Don't loop infinitely if down
          return Math.min(times * 500, 2000);
        }
      });

      this.client.on("connect", () => {
        this.isConnected = true;
        this.logger.log("Redis cache connected successfully.");
      });

      this.client.on("ready", () => {
        this.isConnected = true;
      });

      this.client.on("error", (err) => {
        this.isConnected = false;
        this.logger.warn(`Redis connection error (fallback to DB): ${err.message}`);
      });

      this.client.on("close", () => {
        this.isConnected = false;
      });
    } catch (err) {
      this.logger.warn(`Failed to initialize Redis client: ${err instanceof Error ? err.message : String(err)}`);
      this.client = null;
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.client) {
      try {
        await this.client.connect();
        try {
          this.subscriber = this.client.duplicate();
          await this.subscriber.connect();
          this.subscriber.on("message", (channel: string, message: string) => {
            try {
              const parsed = JSON.parse(message);
              this.localEmitter.emit(channel, parsed);
            } catch {
              this.localEmitter.emit(channel, message);
            }
          });
        } catch (subErr) {
          this.logger.warn(`Redis subscriber connection failed: ${subErr instanceof Error ? subErr.message : String(subErr)}`);
        }
      } catch (err) {
        this.logger.warn(`Could not connect to Redis at startup (will operate without cache): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      try {
        await this.subscriber.quit();
      } catch {
        this.subscriber.disconnect();
      }
    }
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client || !this.isConnected) {
      this.misses += 1;
      return null;
    }

    try {
      const raw = await this.client.get(key);
      if (raw === null || raw === undefined) {
        this.misses += 1;
        return null;
      }
      this.hits += 1;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.misses += 1;
      this.logger.warn(`Cache get failed for key ${key}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds = 300): Promise<void> {
    if (!this.client || !this.isConnected) return;

    try {
      this.totalWrites += 1;
      const serialized = JSON.stringify(value);
      if (ttlSeconds > 0) {
        await this.client.set(key, serialized, "EX", ttlSeconds);
      } else {
        await this.client.set(key, serialized);
      }
    } catch (err) {
      this.logger.warn(`Cache set failed for key ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client || !this.isConnected) return;

    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.warn(`Cache del failed for key ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async delPrefix(prefix: string): Promise<void> {
    if (!this.client || !this.isConnected) return;

    try {
      const keys = await this.client.keys(prefix + "*");
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (err) {
      this.logger.warn(`Cache delPrefix failed for ${prefix}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds = 300
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const fresh = await fetcher();
    await this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  async publish(channel: string, message: unknown): Promise<void> {
    // Always notify local listeners immediately (zero latency)
    this.localEmitter.emit(channel, message);

    if (this.client && this.isConnected) {
      try {
        const serialized = JSON.stringify(message);
        await this.client.publish(channel, serialized);
      } catch (err) {
        this.logger.warn(`Redis publish failed for ${channel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  subscribe<T>(channel: string, listener: (message: T) => void): () => void {
    this.localEmitter.on(channel, listener as (...args: unknown[]) => void);

    if (this.subscriber && this.isConnected) {
      this.subscriber.subscribe(channel).catch((err: unknown) => {
        this.logger.warn(`Redis subscribe failed for ${channel}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }

    return () => {
      this.localEmitter.off(channel, listener as (...args: unknown[]) => void);
    };
  }

  getStats(): CacheStats {
    const totalReads = this.hits + this.misses;
    const hitRatioPercent =
      totalReads > 0 ? Number(((this.hits / totalReads) * 100).toFixed(1)) : 0;

    return {
      connected: this.isConnected,
      hits: this.hits,
      misses: this.misses,
      hitRatioPercent,
      totalReads,
      totalWrites: this.totalWrites
    };
  }
}
