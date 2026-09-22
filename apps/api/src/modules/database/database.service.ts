import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow
} from "pg";

export type DatabaseRuntimeStats = {
  pool: {
    max: number;
    total: number;
    idle: number;
    waiting: number;
  };
  operations: {
    queryCount: number;
    transactionCount: number;
    slowOperationCount: number;
    durationSumMs: number;
    durationMaxMs: number;
    slowThresholdMs: number;
  };
};

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly poolMax: number;
  private readonly slowOperationThresholdMs: number;
  private queryCount = 0;
  private transactionCount = 0;
  private slowOperationCount = 0;
  private durationSumMs = 0;
  private durationMaxMs = 0;

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL is required.");
    }

    const max = Number(process.env.DATABASE_POOL_MAX ?? "10");

    if (!Number.isInteger(max) || max < 1) {
      throw new Error("DATABASE_POOL_MAX must be a positive integer.");
    }

    const slowOperationThresholdMs = Number(
      process.env.DB_SLOW_OPERATION_THRESHOLD_MS ?? "250"
    );
    if (
      !Number.isFinite(slowOperationThresholdMs) ||
      slowOperationThresholdMs <= 0
    ) {
      throw new Error(
        "DB_SLOW_OPERATION_THRESHOLD_MS must be a positive number."
      );
    }

    this.poolMax = max;
    this.slowOperationThresholdMs = slowOperationThresholdMs;
    this.pool = new Pool({
      connectionString,
      max
    });
  }

  async query<T extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<QueryResult<T>> {
    const startedAt = process.hrtime.bigint();
    try {
      return await this.pool.query<T>(text, [...values]);
    } finally {
      this.queryCount += 1;
      this.recordDuration(startedAt);
    }
  }

  async withTransaction<T>(
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const startedAt = process.hrtime.bigint();
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
      this.transactionCount += 1;
      this.recordDuration(startedAt);
    }
  }

  getRuntimeStats(): DatabaseRuntimeStats {
    return {
      pool: {
        max: this.poolMax,
        total: this.pool.totalCount,
        idle: this.pool.idleCount,
        waiting: this.pool.waitingCount
      },
      operations: {
        queryCount: this.queryCount,
        transactionCount: this.transactionCount,
        slowOperationCount: this.slowOperationCount,
        durationSumMs: this.durationSumMs,
        durationMaxMs: this.durationMaxMs,
        slowThresholdMs: this.slowOperationThresholdMs
      }
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private recordDuration(startedAt: bigint): void {
    const durationMs =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    this.durationSumMs += durationMs;
    this.durationMaxMs = Math.max(this.durationMaxMs, durationMs);
    if (durationMs >= this.slowOperationThresholdMs) {
      this.slowOperationCount += 1;
    }
  }
}
