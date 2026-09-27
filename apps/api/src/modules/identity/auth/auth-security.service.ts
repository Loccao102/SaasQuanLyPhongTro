import { createHmac } from "node:crypto";
import {
  HttpException,
  HttpStatus,
  Injectable
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import { AuthEmailDeliveryService } from "./auth-email-delivery.service.js";

type RateLimitAction =
  | "PASSWORD_LOGIN_IDENTIFIER"
  | "PASSWORD_LOGIN_IP"
  | "GOOGLE_AUTH_IP"
  | "REGISTER_IP"
  | "GOOGLE_CHALLENGE_IP"
  | "PASSWORD_CHANGE_USER"
  | "PASSWORD_RESET_IP"
  | "PASSWORD_RESET_IDENTIFIER"
  | "PASSWORD_RESET_CONFIRM_IP"
  | "EMAIL_VERIFY_IP"
  | "MFA_VERIFY_IP"
  | "MFA_SETUP_USER"
  | "PUBLIC_INVOICE_IP"
  | "PUBLIC_MAINTENANCE_IP";

type SecurityEventOutcome = "SUCCESS" | "FAILURE" | "BLOCKED";
type SecurityAlertSeverity = "LOW" | "MEDIUM" | "HIGH";

type SecurityAlertCandidate = {
  type: string;
  severity: SecurityAlertSeverity;
  summary: string;
  metadata?: Record<string, unknown>;
};

type RateLimitRow = QueryResultRow & {
  attempt_count: number;
};

@Injectable()
export class AuthSecurityService {
  private lastCleanupAt = 0;

  constructor(
    private readonly db: DatabaseService,
    private readonly emailDelivery: AuthEmailDeliveryService
  ) {}

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

  async assertPublicInvoiceAllowed(ip: string): Promise<void> {
    await this.consume(
      "PUBLIC_INVOICE_IP",
      "ip",
      ip,
      this.positiveInteger("PUBLIC_INVOICE_RATE_MAX_PER_IP", 300),
      this.positiveInteger("PUBLIC_INVOICE_RATE_WINDOW_SECONDS", 900)
    );
  }

  async assertPublicMaintenanceAllowed(ip: string): Promise<void> {
    await this.consume(
      "PUBLIC_MAINTENANCE_IP",
      "ip",
      ip,
      this.positiveInteger("PUBLIC_MAINTENANCE_RATE_MAX_PER_IP", 30),
      this.positiveInteger("PUBLIC_MAINTENANCE_RATE_WINDOW_SECONDS", 3600)
    );
  }

  async assertPasswordChangeAllowed(userId: string): Promise<void> {
    await this.consume(
      "PASSWORD_CHANGE_USER",
      "email",
      userId,
      this.positiveInteger("AUTH_PASSWORD_CHANGE_MAX_PER_WINDOW", 10),
      this.positiveInteger("AUTH_PASSWORD_CHANGE_WINDOW_SECONDS", 3600)
    );
  }

  async assertPasswordResetRequestAllowed(
    email: string,
    ip: string
  ): Promise<void> {
    const windowSeconds = this.positiveInteger(
      "AUTH_PASSWORD_RESET_WINDOW_SECONDS",
      3600
    );
    await this.consume(
      "PASSWORD_RESET_IP",
      "ip",
      ip,
      this.positiveInteger("AUTH_PASSWORD_RESET_MAX_PER_IP", 30),
      windowSeconds
    );
    await this.consume(
      "PASSWORD_RESET_IDENTIFIER",
      "email",
      email.trim().toLowerCase(),
      this.positiveInteger("AUTH_PASSWORD_RESET_MAX_PER_EMAIL", 6),
      windowSeconds
    );
  }

  async assertPasswordResetConfirmAllowed(ip: string): Promise<void> {
    await this.consume(
      "PASSWORD_RESET_CONFIRM_IP",
      "ip",
      ip,
      this.positiveInteger("AUTH_PASSWORD_RESET_CONFIRM_MAX_PER_IP", 30),
      this.positiveInteger("AUTH_PASSWORD_RESET_CONFIRM_WINDOW_SECONDS", 3600)
    );
  }

  async assertEmailVerificationAllowed(ip: string): Promise<void> {
    await this.consume(
      "EMAIL_VERIFY_IP",
      "ip",
      ip,
      this.positiveInteger("AUTH_EMAIL_VERIFY_MAX_PER_IP", 60),
      this.positiveInteger("AUTH_EMAIL_VERIFY_WINDOW_SECONDS", 3600)
    );
  }

  async assertMfaVerifyAllowed(ip: string): Promise<void> {
    await this.consume(
      "MFA_VERIFY_IP",
      "ip",
      ip,
      this.positiveInteger("AUTH_MFA_VERIFY_MAX_PER_IP", 60),
      this.positiveInteger("AUTH_MFA_VERIFY_WINDOW_SECONDS", 900)
    );
  }

  async assertMfaSetupAllowed(userId: string): Promise<void> {
    await this.consume(
      "MFA_SETUP_USER",
      "email",
      userId,
      this.positiveInteger("AUTH_MFA_SETUP_MAX_PER_USER", 10),
      this.positiveInteger("AUTH_MFA_SETUP_WINDOW_SECONDS", 3600)
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
      const identifierHash = input.email
        ? this.hash("identifier", input.email.trim().toLowerCase())
        : null;
      const ipHash = input.ip ? this.hash("ip", input.ip) : null;

      const result = await this.db.query<QueryResultRow & { id: string }>(
        `INSERT INTO auth_security_events (
           event_type,
           outcome,
           user_id,
           organization_id,
           identifier_hash,
           ip_hash,
           metadata
         )
         VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7::jsonb)
         RETURNING id::text`,
        [
          input.eventType,
          input.outcome,
          input.userId ?? null,
          input.organizationId ?? null,
          identifierHash,
          ipHash,
          JSON.stringify(input.metadata ?? {})
        ]
      );

      const eventId = result.rows[0]?.id;
      if (eventId) {
        await this.evaluateAlerts({
          ...input,
          eventId,
          ipHash
        });
      }
    } catch (error) {
      // Security telemetry must never turn a successful authentication
      // operation into an outage. The caller still owns normal app logging.
      console.error(
        "[auth-security] failed to persist security telemetry",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  async listAlertsForUser(userId: string): Promise<Array<{
    id: string;
    type: string;
    severity: SecurityAlertSeverity;
    summary: string;
    metadata: Record<string, unknown>;
    deliveryStatus: string;
    createdAt: string;
  }>> {
    const result = await this.db.query<
      QueryResultRow & {
        id: string;
        alert_type: string;
        severity: SecurityAlertSeverity;
        summary: string;
        metadata: Record<string, unknown>;
        delivery_status: string;
        created_at: Date;
      }
    >(
      `SELECT
         id::text,
         alert_type,
         severity,
         summary,
         metadata,
         delivery_status,
         created_at
       FROM auth_security_alerts
       WHERE user_id = $1::uuid
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
      [userId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      type: row.alert_type,
      severity: row.severity,
      summary: row.summary,
      metadata: row.metadata,
      deliveryStatus: row.delivery_status,
      createdAt: row.created_at.toISOString()
    }));
  }

  private async evaluateAlerts(input: {
    eventId: string;
    eventType: string;
    outcome: SecurityEventOutcome;
    email?: string | null;
    userId?: string | null;
    organizationId?: string | null;
    metadata?: Record<string, unknown>;
    ipHash: Buffer | null;
  }): Promise<void> {
    const candidates: SecurityAlertCandidate[] = [];

    if (input.outcome === "SUCCESS") {
      const direct = this.directAlert(input.eventType);
      if (direct) candidates.push(direct);
    }

    if (
      input.outcome === "SUCCESS" &&
      input.userId &&
      input.ipHash &&
      this.isCompletedLoginEvent(input.eventType) &&
      (await this.isNewLoginNetwork(
        input.userId,
        input.eventId,
        input.ipHash
      ))
    ) {
      candidates.push({
        type: "NEW_LOGIN_NETWORK",
        severity: "MEDIUM",
        summary:
          "Habi phát hiện đăng nhập thành công từ một network chưa từng thấy cho tài khoản này."
      });
    }

    if (
      input.outcome === "FAILURE" &&
      input.userId &&
      input.eventType.startsWith("STEP_UP_") &&
      (await this.hasRepeatedStepUpFailures(input.userId))
    ) {
      const duplicate = await this.hasRecentAlert(
        input.userId,
        "REPEATED_STEP_UP_FAILURE",
        60
      );
      if (!duplicate) {
        candidates.push({
          type: "REPEATED_STEP_UP_FAILURE",
          severity: "HIGH",
          summary:
            "Có nhiều lần xác thực lại thất bại liên tiếp trên tài khoản Habi."
        });
      }
    }

    for (const candidate of candidates) {
      await this.persistAlert({
        eventId: input.eventId,
        userId: input.userId ?? null,
        organizationId: input.organizationId ?? null,
        email: input.email ?? null,
        candidate
      });
    }
  }

  private directAlert(eventType: string): SecurityAlertCandidate | null {
    switch (eventType) {
      case "MFA_DISABLED":
        return {
          type: "MFA_DISABLED",
          severity: "HIGH",
          summary: "Xác thực hai bước vừa bị tắt trên tài khoản Habi."
        };
      case "PASSKEY_REGISTERED":
        return {
          type: "PASSKEY_REGISTERED",
          severity: "MEDIUM",
          summary: "Một passkey mới vừa được đăng ký cho tài khoản Habi."
        };
      case "PASSKEY_REVOKED":
        return {
          type: "PASSKEY_REVOKED",
          severity: "MEDIUM",
          summary: "Một passkey vừa bị thu hồi khỏi tài khoản Habi."
        };
      case "PASSWORD_CHANGED":
        return {
          type: "PASSWORD_CHANGED",
          severity: "MEDIUM",
          summary: "Mật khẩu tài khoản Habi vừa được thay đổi."
        };
      default:
        return null;
    }
  }

  private isCompletedLoginEvent(eventType: string): boolean {
    return [
      "PASSWORD_LOGIN",
      "GOOGLE_AUTH",
      "MFA_LOGIN",
      "PASSKEY_MFA_LOGIN",
      "PLATFORM_LOGIN"
    ].includes(eventType);
  }

  private async isNewLoginNetwork(
    userId: string,
    currentEventId: string,
    ipHash: Buffer
  ): Promise<boolean> {
    const eventTypes = [
      "PASSWORD_LOGIN",
      "GOOGLE_AUTH",
      "MFA_LOGIN",
      "PASSKEY_MFA_LOGIN",
      "PLATFORM_LOGIN"
    ];
    const result = await this.db.query<
      QueryResultRow & { total: string; same_network: string }
    >(
      `SELECT
         count(*)::text AS total,
         count(*) FILTER (WHERE ip_hash = $3)::text AS same_network
       FROM auth_security_events
       WHERE user_id = $1::uuid
         AND id <> $2::uuid
         AND outcome = 'SUCCESS'
         AND event_type = ANY($4::text[])`,
      [userId, currentEventId, ipHash, eventTypes]
    );
    const total = Number(result.rows[0]?.total ?? "0");
    const sameNetwork = Number(result.rows[0]?.same_network ?? "0");
    return total > 0 && sameNetwork === 0;
  }

  private async hasRepeatedStepUpFailures(userId: string): Promise<boolean> {
    const result = await this.db.query<QueryResultRow & { count: string }>(
      `SELECT count(*)::text AS count
       FROM auth_security_events
       WHERE user_id = $1::uuid
         AND outcome = 'FAILURE'
         AND event_type LIKE 'STEP_UP_%'
         AND occurred_at > now() - interval '15 minutes'`,
      [userId]
    );
    return Number(result.rows[0]?.count ?? "0") >= 3;
  }

  private async hasRecentAlert(
    userId: string,
    alertType: string,
    minutes: number
  ): Promise<boolean> {
    const result = await this.db.query(
      `SELECT 1
       FROM auth_security_alerts
       WHERE user_id = $1::uuid
         AND alert_type = $2
         AND created_at > now() - ($3::int * interval '1 minute')
       LIMIT 1`,
      [userId, alertType, minutes]
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async persistAlert(input: {
    eventId: string;
    userId: string | null;
    organizationId: string | null;
    email: string | null;
    candidate: SecurityAlertCandidate;
  }): Promise<void> {
    const initialDeliveryStatus =
      input.userId &&
      input.email &&
      input.candidate.severity !== "LOW" &&
      this.emailDelivery.isSecurityAlertAvailable()
        ? "PENDING"
        : "SKIPPED";

    const result = await this.db.query<QueryResultRow & { id: string }>(
      `INSERT INTO auth_security_alerts (
         source_event_id,
         user_id,
         organization_id,
         alert_type,
         severity,
         summary,
         metadata,
         delivery_status
       )
       VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb, $8
       )
       ON CONFLICT (source_event_id, alert_type) DO NOTHING
       RETURNING id::text`,
      [
        input.eventId,
        input.userId,
        input.organizationId,
        input.candidate.type,
        input.candidate.severity,
        input.candidate.summary,
        JSON.stringify(input.candidate.metadata ?? {}),
        initialDeliveryStatus
      ]
    );

    const alertId = result.rows[0]?.id;
    if (
      !alertId ||
      initialDeliveryStatus !== "PENDING" ||
      !input.email
    ) {
      return;
    }

    void this.deliverAlertEmail(
      alertId,
      input.email,
      input.candidate
    );
  }

  private async deliverAlertEmail(
    alertId: string,
    email: string,
    candidate: SecurityAlertCandidate
  ): Promise<void> {
    try {
      await this.emailDelivery.sendSecurityAlert({
        email,
        subject:
          candidate.severity === "HIGH"
            ? "Cảnh báo bảo mật quan trọng từ Habi"
            : "Thông báo bảo mật từ Habi",
        message: candidate.summary
      });
      await this.db.query(
        `UPDATE auth_security_alerts
         SET delivery_status = 'SENT',
             delivered_at = now()
         WHERE id = $1::uuid`,
        [alertId]
      );
    } catch (error) {
      try {
        await this.db.query(
          `UPDATE auth_security_alerts
           SET delivery_status = 'FAILED'
           WHERE id = $1::uuid`,
          [alertId]
        );
      } catch {
        // Ignore secondary persistence failures; the original alert exists.
      }
      console.error(
        "[auth-security] security alert email failed",
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
    const alertRetentionDays = this.positiveInteger(
      "AUTH_SECURITY_ALERT_RETENTION_DAYS",
      180
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
      await this.db.query(
        `DELETE FROM auth_security_alerts
         WHERE created_at < now() - ($1::int * interval '1 day')`,
        [alertRetentionDays]
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
