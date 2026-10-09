import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";

type LoginRow = QueryResultRow & {
  id: string;
  status: string;
  qr_image: string | null;
  error_message: string | null;
  expires_at: Date;
};
type AccountRow = QueryResultRow & {
  status: string;
  connected_at: Date | null;
};

@Injectable()
export class ZaloPersonalService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessControlService
  ) {}

  private authorize(principal: TenantPrincipal) {
    if (!this.access.can(principal.membership, "notification.send", {
      organizationId: principal.organizationId
    })) {
      throw new ForbiddenException("notification.send permission denied.");
    }
  }

  private authorizeManage(principal: TenantPrincipal) {
    if (principal.role !== "OWNER" && principal.role !== "ADMIN") {
      throw new ForbiddenException("Only owners and admins may link Zalo accounts.");
    }
  }

  async status(principal: TenantPrincipal) {
    this.authorize(principal);
    await this.expireOldRequests(principal.organizationId);
    const [account, login] = await Promise.all([
      this.db.query<AccountRow>(
        `SELECT status, connected_at FROM zalo_personal_accounts WHERE organization_id = $1::uuid`,
        [principal.organizationId]
      ),
      this.db.query<LoginRow>(
        `SELECT id::text, status, qr_image, error_message, expires_at
         FROM zalo_personal_login_requests
         WHERE organization_id = $1::uuid
         ORDER BY created_at DESC LIMIT 1`,
        [principal.organizationId]
      )
    ]);
    const canManage = principal.role === "OWNER" || principal.role === "ADMIN";
    const row = login.rows[0];
    return {
      canManage,
      status: account.rows[0]?.status ?? "DISCONNECTED",
      connectedAt: account.rows[0]?.connected_at?.toISOString() ?? null,
      login: row && canManage ? {
        id: row.id,
        status: row.status,
        qrImage: row.status === "RUNNING" && row.expires_at > new Date()
          ? row.qr_image : null,
        expiresAt: row.expires_at.toISOString(),
        errorMessage: row.error_message
      } : null
    };
  }

  async begin(principal: TenantPrincipal) {
    this.authorize(principal);
    this.authorizeManage(principal);
    return this.db.withTransaction(async (client) => {
      // Serialize connect/disconnect even when the account row does not yet exist.
      await client.query("SELECT id FROM organizations WHERE id = $1::uuid FOR UPDATE", [
        principal.organizationId
      ]);
      await this.expireOldRequests(principal.organizationId, client);
      const current = await client.query<LoginRow>(
        `SELECT id::text, status, qr_image, error_message, expires_at
         FROM zalo_personal_login_requests
         WHERE organization_id = $1::uuid AND status IN ('PENDING','RUNNING')
         ORDER BY created_at DESC LIMIT 1`, [principal.organizationId]
      );
      if (current.rows[0]) {
        return { requestId: current.rows[0].id, expiresAt: current.rows[0].expires_at.toISOString() };
      }

      const recent = await client.query<QueryResultRow & { count: number }>(
        `SELECT count(*)::int AS count FROM zalo_personal_login_requests
         WHERE organization_id = $1::uuid
           AND created_at > now() - interval '15 minutes'`,
        [principal.organizationId]
      );
      if ((recent.rows[0]?.count ?? 0) >= 3) {
        throw new ConflictException("Too many Zalo login attempts. Try again later.");
      }

      const requestId = randomUUID();
      const expiresAt = new Date(Date.now() + 180_000);
      await client.query(
        `INSERT INTO zalo_personal_accounts (organization_id, status, encrypted_session, connected_at)
         VALUES ($1::uuid, 'CONNECTING', NULL, NULL)
         ON CONFLICT (organization_id)
         DO UPDATE SET status = 'CONNECTING', encrypted_session = NULL,
                       connected_at = NULL, updated_at = now()`,
        [principal.organizationId]
      );
      await client.query(
        `INSERT INTO zalo_personal_login_requests
           (id, organization_id, expires_at)
         VALUES ($1::uuid, $2::uuid, $3::timestamptz)`,
        [requestId, principal.organizationId, expiresAt.toISOString()]
      );
      await client.query(
        `INSERT INTO audit_events
           (organization_id, actor_user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, 'ZALO_PERSONAL_CONNECT_REQUESTED', 'ZALO_PERSONAL_ACCOUNT',
                 $1, '{}'::jsonb)`,
        [principal.organizationId, principal.userId]
      );
      return { requestId, expiresAt: expiresAt.toISOString() };
    });
  }

  async disconnect(principal: TenantPrincipal) {
    this.authorize(principal);
    this.authorizeManage(principal);
    await this.db.withTransaction(async (client) => {
      await client.query("SELECT id FROM organizations WHERE id = $1::uuid FOR UPDATE", [
        principal.organizationId
      ]);
      await client.query(
        `INSERT INTO zalo_personal_accounts (organization_id, status, encrypted_session, connected_at)
         VALUES ($1::uuid, 'DISCONNECTED', NULL, NULL)
         ON CONFLICT (organization_id)
         DO UPDATE SET status = 'DISCONNECTED', encrypted_session = NULL,
                       connected_at = NULL, updated_at = now()`,
        [principal.organizationId]
      );
      await client.query(
        `UPDATE zalo_personal_login_requests
         SET status = 'CANCELLED', qr_image = NULL, updated_at = now()
         WHERE organization_id = $1::uuid AND status IN ('PENDING','RUNNING')`,
        [principal.organizationId]
      );
      await client.query(
        `INSERT INTO audit_events
           (organization_id, actor_user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, 'ZALO_PERSONAL_DISCONNECTED', 'ZALO_PERSONAL_ACCOUNT',
                 $1, '{}'::jsonb)`,
        [principal.organizationId, principal.userId]
      );
    });
    return { status: "DISCONNECTED" };
  }

  async claim(): Promise<{ id: string; organizationId: string; expiresAt: string } | null> {
    return this.db.withTransaction(async (client) => {
      await this.expireOldRequests(undefined, client);
      const result = await client.query<QueryResultRow & {
        id: string; organization_id: string; expires_at: Date;
      }>(
        `SELECT id::text, organization_id::text, expires_at
         FROM zalo_personal_login_requests
         WHERE status = 'PENDING' AND expires_at > now()
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`
      );
      const row = result.rows[0];
      if (!row) return null;
      await client.query(
        `UPDATE zalo_personal_login_requests
         SET status = 'RUNNING', started_at = now(), updated_at = now()
         WHERE id = $1::uuid`, [row.id]
      );
      return {
        id: row.id, organizationId: row.organization_id,
        expiresAt: row.expires_at.toISOString()
      };
    });
  }

  async progress(requestId: string, qrImage: unknown) {
    if (typeof qrImage !== "string" ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(qrImage) ||
      qrImage.length > 250_000) {
      throw new BadRequestException("A bounded JPEG QR image is required.");
    }
    const result = await this.db.query(
      `UPDATE zalo_personal_login_requests SET qr_image = $2, updated_at = now()
       WHERE id = $1::uuid AND status = 'RUNNING' AND expires_at > now()`,
      [requestId, qrImage]
    );
    return { ok: result.rowCount === 1 };
  }

  async finish(requestId: string, input: {
    status: "CONNECTED" | "FAILED";
    encryptedSession?: unknown;
    errorMessage?: unknown;
  }) {
    if (input.status !== "CONNECTED" && input.status !== "FAILED") {
      throw new BadRequestException("Invalid connection outcome.");
    }
    if (input.status === "CONNECTED") {
      this.checkEncrypted(input.encryptedSession);
    }
    return this.db.withTransaction(async (client) => {
      const result = await client.query<QueryResultRow & { organization_id: string }>(
        `SELECT organization_id::text FROM zalo_personal_login_requests
         WHERE id = $1::uuid AND status = 'RUNNING' AND expires_at > now()
         FOR UPDATE`, [requestId]
      );
      const row = result.rows[0];
      if (!row) return { ok: false };
      await client.query(
        `UPDATE zalo_personal_login_requests
         SET status = $2, qr_image = NULL, error_message = $3, updated_at = now()
         WHERE id = $1::uuid`,
        [requestId, input.status,
          input.status === "FAILED"
            ? String(input.errorMessage ?? "Could not authenticate Zalo.").slice(0,300)
            : null]
      );
      await client.query(
        `UPDATE zalo_personal_accounts
         SET status = $2, encrypted_session = $3,
             connected_at = CASE WHEN $2 = 'CONNECTED' THEN now() ELSE NULL END,
             updated_at = now()
         WHERE organization_id = $1::uuid AND status = 'CONNECTING'`,
        [row.organization_id,
          input.status === "CONNECTED" ? "CONNECTED" : "DISCONNECTED",
          input.status === "CONNECTED" ? input.encryptedSession : null]
      );
      return { ok: true };
    });
  }

  async sessionForJob(jobId: string) {
    const result = await this.db.query<QueryResultRow & {
      organization_id: string;
      encrypted_session: string;
    }>(
      `SELECT j.organization_id::text, a.encrypted_session
       FROM notification_jobs j
       JOIN zalo_personal_accounts a ON a.organization_id = j.organization_id
       WHERE j.id = $1::uuid AND j.status = 'RUNNING'
         AND j.provider IN ('PLAYWRIGHT_ZALO','ZALO_PLAYWRIGHT')
         AND a.status = 'CONNECTED' AND a.encrypted_session IS NOT NULL`,
      [jobId]
    );
    const row = result.rows[0];
    return row ? {
      organizationId: row.organization_id,
      encryptedSession: row.encrypted_session
    } : null;
  }

  async updateSessionForJob(jobId: string, encryptedSession: unknown) {
    this.checkEncrypted(encryptedSession);
    const result = await this.db.query(
      `UPDATE zalo_personal_accounts a
       SET encrypted_session = $2, updated_at = now()
       FROM notification_jobs j
       WHERE j.id = $1::uuid AND j.organization_id = a.organization_id
         AND j.status = 'RUNNING'
         AND j.provider IN ('PLAYWRIGHT_ZALO','ZALO_PLAYWRIGHT')
         AND a.status = 'CONNECTED'`,
      [jobId, encryptedSession]
    );
    return { ok: result.rowCount === 1 };
  }

  async invalidateSessionForJob(jobId: string, reason: string) {
    if (!["AUTH_REQUIRED","SESSION_EXPIRED","SESSION_STORAGE_ERROR","CAPTCHA"].includes(reason)) {
      throw new BadRequestException("Invalid per-account Zalo invalidation reason.");
    }
    const result = await this.db.query(
      `UPDATE zalo_personal_accounts a
       SET status = 'DISCONNECTED', encrypted_session = NULL,
           connected_at = NULL, updated_at = now()
       FROM notification_jobs j
       WHERE j.id = $1::uuid AND j.organization_id = a.organization_id
         AND j.status = 'RUNNING'
         AND j.provider IN ('PLAYWRIGHT_ZALO','ZALO_PLAYWRIGHT')
         AND a.status = 'CONNECTED'`,
      [jobId]
    );
    return { ok: result.rowCount === 1 };
  }

  private checkEncrypted(value: unknown): asserts value is string {
    // The worker performs authenticated AES-GCM encryption; browser callers never see the ciphertext.
    if (typeof value !== "string" || value.length > 900_000 ||
        !/^\{"v":1,"iv":"[A-Za-z0-9+/=]+","tag":"[A-Za-z0-9+/=]+","data":"[A-Za-z0-9+/=]+"\}$/.test(value)) {
      throw new BadRequestException("Invalid encrypted session envelope.");
    }
  }

  private async expireOldRequests(organizationId?: string, client?: PoolClient) {
    const parameters = organizationId ? [organizationId] : [];
    const sql = `WITH expired AS (
         UPDATE zalo_personal_login_requests
         SET status = 'EXPIRED', qr_image = NULL, updated_at = now()
         WHERE status IN ('PENDING','RUNNING') AND expires_at <= now()
           ${organizationId ? "AND organization_id = $1::uuid" : ""}
         RETURNING organization_id
       )
       UPDATE zalo_personal_accounts a
       SET status = 'DISCONNECTED', encrypted_session = NULL, connected_at = NULL,
           updated_at = now()
       WHERE a.organization_id IN (SELECT organization_id FROM expired)
         AND a.status = 'CONNECTING'`;
    if (client) {
      await client.query(sql, parameters);
    } else {
      await this.db.query(sql, parameters);
    }
  }
}
