import { createHmac } from "node:crypto";
import {
  HttpException,
  HttpStatus,
  Injectable
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service.js";

type RateLimitAction =
  | "PASSWORD_LOGIN_IDENTIFIER"
  | "PASSWORD_LOGIN_IP"
  | "GOOGLE_AUTH_IP"
  | "REGISTER_IP"
  | "GOOGLE_CHALLENGE_IP";

type SecurityEventOutcome = "SUCCESS" | "FAILURE" | "BLOCKED";

type RateLimitRow = QueryResultRow & {
  attempt_count: number;
};

@Injectable()
export class AuthSecurityService {
  private lastCleanupAt = 0;

  constructor(private readonly db: DatabaseService) {}

  async assertPasswordLoginAllowed(email: string, ip: string): Promise<void> {
    const windowSeconds = this.positiveInteger(
      "AUTH_LOGIN_RATE_WINDOW_SECONDS",
      900
    );
    // Check the bounded IP key first so rotating arbitrary email values cannot
    // create an unbounded number of identifier buckets from one source.
    await this.consume(
      "PASSWORD_LOGIN_IP",
      "ip",
      ip,
      this.positiveInteger("AUTH_LOGIN_RATE_MAX_PER_IP", 120),
      windowSeconds
    );
    await this.consume(
      "PASSWORD_LOGIN_IDENTIFIER",
      "email",
      email.trim().toLowerCase(),
      this.positiveInteger("AUTH_LOGIN_RATE_MAX_PER_EMAIL", 30),
      windowSeconds
    );
  }

  async assertGoogleAllowed(ip: string): Promise<void> {
    await this.consume(
      "GOOGLE_AUTH_IP",
      "ip",
      ip,
      this.positiveInteger("AUTH_GOOGLE_RATE_MAX_PER_IP", 60),
      this.positiveInteger("AUTH_GOOGLE_RATE_WINDOW_SECONDS", 900)
    );
  }

  async assertRegistrationAllowed(ip: string): Promise<void> {
    await this.consume(
      "REGISTER_IP",
      "ip",
      ip,
      this.positiveInteger("AUTH_REGISTER_RATE_MAX_PER_IP", 20),
      this.positiveInteger("AUTH_REGISTER_RATE_WINDOW_SECONDS", 3600)
    );
  }

  async assertGoogleChallengeAllowed(ip: string): Promise<void> {
    await this.consume(
      "GOOGLE_CHALLENGE_IP",
      "ip",
      ip,
      this.positiveInteger("AUTH_GOOGLE_CHALLENGE_MAX_PER_IP", 120),
      this.positiveInteger("AUTH_GOOGLE_CHALLENGE_WINDOW_SECONDS", 900)
    );
  }

  async recordEvent(input: {
    eventType: string;
    outcome: SecurityEventOutcome;
    email?: string | null;
    ip?: string | null;
    userId?: string | null;
    organizationId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO auth_security_events (
           event_type,
           outcome,
           user_id,
           organization_id,
           identifier_hash,
           ip_hash,
           metadata
         )
         VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7::jsonb)`,
        [
          input.eventType,
          input.outcome,
          input.userId ?? null,
          input.organizationId ?? null,
          input.email
            ? this.hash("identifier", input.email.trim().toLowerCase())
            : null,
          input.ip ? this.hash("ip", input.ip) : null,
          JSON.stringify(input.metadata ?? {})
        ]
      );
    } catch (error) {
      // Security telemetry must never turn a successful authentication
      // operation into an outage. The caller still owns normal app logging.
      console.error(
        "[auth-security] failed to persist security event",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async consume(
    action: RateLimitAction,
    keyType: "email" | "ip",
    value: string,
    limit: number,
    windowSeconds: number
  ): Promise<void> {
    const normalized = value.trim();
    if (!normalized) return;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowStartSeconds =
      Math.floor(nowSeconds / windowSeconds) * windowSeconds;
    const windowStart = new Date(windowStartSeconds * 1000);

    const result = await this.db.query<RateLimitRow>(
      `INSERT INTO auth_rate_limit_buckets (
         action, key_hash, window_start, attempt_count, updated_at
       )
       VALUES ($1, $2, $3, 1, now())
       ON CONFLICT (action, key_hash, window_start)
       DO UPDATE SET
         attempt_count = auth_rate_limit_buckets.attempt_count + 1,
         updated_at = now()
       RETURNING attempt_count`,
      [action, this.hash(keyType, normalized), windowStart]
    );

    const attempts = result.rows[0]?.attempt_count ?? 1;
    await this.cleanupExpiredSecurityData();
    if (attempts > limit) {
      await this.recordEvent({
        eventType: "AUTH_RATE_LIMITED",
        outcome: "BLOCKED",
        email: keyType === "email" ? normalized : null,
        ip: keyType === "ip" ? normalized : null,
        metadata: { action, limit, windowSeconds }
      });
      throw new HttpException(
        "Có quá nhiều yêu cầu xác thực. Vui lòng thử lại sau.",
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
  }

  private async cleanupExpiredSecurityData(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanupAt < 60 * 60 * 1000) return;
    this.lastCleanupAt = now;

    const retentionDays = this.positiveInteger(
      "AUTH_SECURITY_EVENT_RETENTION_DAYS",
      90
    );

    try {
      await this.db.query(
        `DELETE FROM auth_rate_limit_buckets
         WHERE updated_at < now() - interval '48 hours'`
      );
      await this.db.query(
        `DELETE FROM auth_security_events
         WHERE occurred_at < now() - ($1::int * interval '1 day')`,
        [retentionDays]
      );
    } catch (error) {
      console.error(
        "[auth-security] retention cleanup failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private hash(namespace: string, value: string): Buffer {
    return createHmac("sha256", this.hmacKey())
      .update(namespace)
      .update("\0")
      .update(value)
      .digest();
  }

  private hmacKey(): string {
    const configured = process.env.AUTH_SECURITY_HMAC_KEY?.trim();
    if (configured && configured.length >= 32) {
      return configured;
    }
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AUTH_SECURITY_HMAC_KEY must contain at least 32 characters in production."
      );
    }
    return "habi-development-auth-security-key-change-me";
  }

  private positiveInteger(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(name + " must be a positive integer.");
    }
    return value;
  }
}
