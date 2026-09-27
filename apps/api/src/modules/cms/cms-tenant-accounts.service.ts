import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import {
  CommercialPolicyService,
  CommercialResourceLimitExceededError
} from "../commercial/application/commercial-policy.service.js";
import {
  tenantFeatureEnabled,
  tenantFeatureKeys
} from "../commercial/domain/entitlements.js";
import { DatabaseService } from "../database/database.service.js";
import { roles, type Role } from "../identity/domain/access-control.js";
import { hashPassword, InvalidPasswordPolicyError } from "../identity/auth/password.js";
import type { PlatformPrincipal } from "./cms.types.js";
import {
  platformRoleHasPermission,
  type PlatformPermission
} from "./domain/platform-access.js";

type AccountRow = QueryResultRow & {
  id: string;
  email: string;
  display_name: string;
  user_status: "ACTIVE" | "SUSPENDED";
  role: Role;
  membership_status: "INVITED" | "ACTIVE" | "SUSPENDED";
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class CmsTenantAccountsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async list(principal: PlatformPrincipal, organizationId: string) {
    this.requirePermission(principal, "platform.accounts.read");

    return this.db.withTransaction(async (client) => {
      const policy = await this.commercialPolicy.loadPolicy(
        client,
        organizationId
      );
      const result = await client.query<AccountRow>(
        `SELECT
           u.id::text,
           u.email,
           u.display_name,
           u.status AS user_status,
           om.role,
           om.status AS membership_status,
           u.created_at,
           u.updated_at
         FROM users u
         JOIN organization_memberships om
           ON om.organization_id = u.organization_id
          AND om.user_id = u.id
         WHERE u.account_type = 'TENANT'
           AND u.organization_id = $1::uuid
         ORDER BY
           CASE om.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END,
           lower(u.display_name),
           lower(u.email)`,
        [organizationId]
      );

      return {
        organizationId,
        used: result.rows.length,
        limit: policy.entitlements.staffLimit,
        planCode: policy.planCode,
        subscriptionStatus: policy.subscriptionStatus,
        features: Object.fromEntries(
          tenantFeatureKeys.map((key) => [
            key,
            {
              enabled: tenantFeatureEnabled(policy.entitlements, key),
              source: policy.entitlements.source[key]
            }
          ])
        ),
        accounts: result.rows.map((row) => this.mapAccount(row))
      };
    });
  }

  async create(
    principal: PlatformPrincipal,
    organizationId: string,
    input: {
      email: string;
      displayName: string;
      role: string;
      temporaryPassword: string;
      reason: string;
    }
  ) {
    this.requirePermission(principal, "platform.accounts.manage");
    const role = this.role(input.role);
    const email = this.email(input.email);
    const displayName = this.required(input.displayName, "displayName");
    const reason = this.required(input.reason, "reason");

    let credential;
    try {
      credential = await hashPassword(input.temporaryPassword);
    } catch (error) {
      if (error instanceof InvalidPasswordPolicyError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }

    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.lockOrganizationForMutation(
        client,
        organizationId
      );
      const policy = await this.commercialPolicy.loadPolicy(
        client,
        organizationId
      );
      const usage = await client.query<QueryResultRow & { count: number }>(
        `SELECT count(*)::int AS count
         FROM organization_memberships
         WHERE organization_id = $1::uuid`,
        [organizationId]
      );

      try {
        this.commercialPolicy.assertResourceIncreaseAllowed(
          policy,
          "STAFF",
          usage.rows[0]?.count ?? 0,
          1
        );
      } catch (error) {
        if (error instanceof CommercialResourceLimitExceededError) {
          throw new ConflictException(
            `Tenant đã dùng hết quota tài khoản (${error.current}/${error.limit}).`
          );
        }
        throw error;
      }

      const existing = await client.query(
        "SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1",
        [email]
      );
      if ((existing.rowCount ?? 0) > 0) {
        throw new ConflictException("Email đã thuộc một tài khoản Habi khác.");
      }

      const user = await client.query<QueryResultRow & { id: string }>(
        `INSERT INTO users (
           organization_id, account_type, email, display_name, status
         )
         VALUES ($1, 'TENANT', $2, $3, 'ACTIVE')
         RETURNING id::text`,
        [organizationId, email, displayName]
      );
      const userId = user.rows[0]!.id;

      await client.query(
        `INSERT INTO user_password_credentials (
           user_id, password_hash, password_salt, scrypt_n, scrypt_r, scrypt_p
         )
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          credential.hash,
          credential.salt,
          credential.n,
          credential.r,
          credential.p
        ]
      );

      const membership = await client.query<QueryResultRow & { id: string }>(
        `INSERT INTO organization_memberships (
           organization_id, user_id, role, status
         )
         VALUES ($1, $2, $3, 'ACTIVE')
         RETURNING id::text`,
        [organizationId, userId, role]
      );

      await client.query(
        `INSERT INTO membership_scopes (
           organization_id, membership_id, scope_type
         )
         VALUES ($1, $2, 'ORGANIZATION')`,
        [organizationId, membership.rows[0]!.id]
      );

      await this.audit(client, principal, {
        action: "TENANT_ACCOUNT_CREATED",
        organizationId,
        targetKey: userId,
        before: {},
        after: { email, displayName, role, status: "ACTIVE" },
        reason
      });

      return {
        id: userId,
        email,
        displayName,
        userStatus: "ACTIVE" as const,
        role,
        membershipStatus: "ACTIVE" as const
      };
    });
  }

  async setRole(
    principal: PlatformPrincipal,
    organizationId: string,
    userId: string,
    roleInput: string,
    reason: string
  ) {
    this.requirePermission(principal, "platform.accounts.manage");
    const role = this.role(roleInput);
    const auditReason = this.required(reason, "reason");

    return this.db.withTransaction(async (client) => {
      const before = await this.accountForUpdate(client, organizationId, userId);

      if (before.role === "OWNER" && role !== "OWNER") {
        await this.assertNotLastActiveOwner(client, organizationId, userId);
      }

      await client.query(
        `UPDATE organization_memberships
         SET role = $3,
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND user_id = $2::uuid`,
        [organizationId, userId, role]
      );

      if (role === "OWNER") {
        const membership = await client.query<QueryResultRow & { id: string }>(
          `SELECT id::text
           FROM organization_memberships
           WHERE organization_id = $1::uuid
             AND user_id = $2::uuid
           LIMIT 1`,
          [organizationId, userId]
        );
        const membershipId = membership.rows[0]?.id;
        if (membershipId) {
          await client.query(
            `DELETE FROM membership_scopes
             WHERE organization_id = $1::uuid
               AND membership_id = $2::uuid`,
            [organizationId, membershipId]
          );
          await client.query(
            `INSERT INTO membership_scopes (
               organization_id, membership_id, scope_type
             )
             VALUES ($1, $2, 'ORGANIZATION')`,
            [organizationId, membershipId]
          );
        }
      }

      await this.audit(client, principal, {
        action: "TENANT_ACCOUNT_ROLE_CHANGED",
        organizationId,
        targetKey: userId,
        before: { role: before.role },
        after: { role },
        reason: auditReason
      });

      return { userId, organizationId, role };
    });
  }

  async setStatus(
    principal: PlatformPrincipal,
    organizationId: string,
    userId: string,
    status: "ACTIVE" | "SUSPENDED",
    reason: string
  ) {
    this.requirePermission(principal, "platform.accounts.manage");
    const auditReason = this.required(reason, "reason");

    return this.db.withTransaction(async (client) => {
      const before = await this.accountForUpdate(client, organizationId, userId);
      if (
        status === "SUSPENDED" &&
        before.role === "OWNER" &&
        before.userStatus === "ACTIVE" &&
        before.membershipStatus === "ACTIVE"
      ) {
        await this.assertNotLastActiveOwner(client, organizationId, userId);
      }

      await client.query(
        `UPDATE users
         SET status = $3, updated_at = now()
         WHERE id = $1::uuid
           AND organization_id = $2::uuid
           AND account_type = 'TENANT'`,
        [userId, organizationId, status]
      );

      if (status === "SUSPENDED") {
        await client.query(
          `UPDATE auth_sessions
           SET revoked_at = COALESCE(revoked_at, now())
           WHERE user_id = $1::uuid
             AND organization_id = $2::uuid
             AND revoked_at IS NULL`,
          [userId, organizationId]
        );
      }

      await this.audit(client, principal, {
        action: status === "ACTIVE"
          ? "TENANT_ACCOUNT_REACTIVATED"
          : "TENANT_ACCOUNT_SUSPENDED",
        organizationId,
        targetKey: userId,
        before,
        after: { ...before, userStatus: status },
        reason: auditReason
      });

      return { userId, organizationId, status };
    });
  }

  async resetPassword(
    principal: PlatformPrincipal,
    organizationId: string,
    userId: string,
    temporaryPassword: string,
    reason: string
  ) {
    this.requirePermission(principal, "platform.accounts.manage");
    const auditReason = this.required(reason, "reason");
    let credential;
    try {
      credential = await hashPassword(temporaryPassword);
    } catch (error) {
      if (error instanceof InvalidPasswordPolicyError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }

    return this.db.withTransaction(async (client) => {
      const account = await this.accountForUpdate(client, organizationId, userId);

      await client.query(
        `INSERT INTO user_password_credentials (
           user_id, password_hash, password_salt, scrypt_n, scrypt_r, scrypt_p,
           password_changed_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, now(), now())
         ON CONFLICT (user_id) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               password_salt = EXCLUDED.password_salt,
               scrypt_n = EXCLUDED.scrypt_n,
               scrypt_r = EXCLUDED.scrypt_r,
               scrypt_p = EXCLUDED.scrypt_p,
               password_changed_at = now(),
               updated_at = now()`,
        [
          userId,
          credential.hash,
          credential.salt,
          credential.n,
          credential.r,
          credential.p
        ]
      );
      await client.query(
        `UPDATE users
         SET auth_version = auth_version + 1, updated_at = now()
         WHERE id = $1::uuid AND organization_id = $2::uuid`,
        [userId, organizationId]
      );
      await this.revokeSessions(client, organizationId, userId);

      await this.audit(client, principal, {
        action: "TENANT_ACCOUNT_PASSWORD_RESET",
        organizationId,
        targetKey: userId,
        before: { email: account.email },
        after: { passwordReset: true, sessionsRevoked: true },
        reason: auditReason
      });

      return { userId, passwordReset: true, sessionsRevoked: true };
    });
  }

  async revokeAllSessions(
    principal: PlatformPrincipal,
    organizationId: string,
    userId: string,
    reason: string
  ) {
    this.requirePermission(principal, "platform.accounts.manage");
    const auditReason = this.required(reason, "reason");

    return this.db.withTransaction(async (client) => {
      const account = await this.accountForUpdate(client, organizationId, userId);
      const revoked = await this.revokeSessions(client, organizationId, userId);

      await this.audit(client, principal, {
        action: "TENANT_ACCOUNT_SESSIONS_REVOKED",
        organizationId,
        targetKey: userId,
        before: { email: account.email },
        after: { revokedSessions: revoked },
        reason: auditReason
      });

      return { userId, revokedSessions: revoked };
    });
  }

  private async assertNotLastActiveOwner(
    client: PoolClient,
    organizationId: string,
    userId: string
  ): Promise<void> {
    const result = await client.query<QueryResultRow & { count: number }>(
      `SELECT count(*)::int AS count
       FROM organization_memberships om
       JOIN users u
         ON u.id = om.user_id
        AND u.organization_id = om.organization_id
       WHERE om.organization_id = $1::uuid
         AND om.role = 'OWNER'
         AND om.status = 'ACTIVE'
         AND u.status = 'ACTIVE'
         AND u.id <> $2::uuid`,
      [organizationId, userId]
    );

    if ((result.rows[0]?.count ?? 0) === 0) {
      throw new ConflictException(
        "Tenant phải luôn còn ít nhất một OWNER đang hoạt động."
      );
    }
  }

  private async revokeSessions(
    client: PoolClient,
    organizationId: string,
    userId: string
  ): Promise<number> {
    const result = await client.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE user_id = $1::uuid
         AND organization_id = $2::uuid
         AND revoked_at IS NULL`,
      [userId, organizationId]
    );
    return result.rowCount ?? 0;
  }

  private async accountForUpdate(
    client: PoolClient,
    organizationId: string,
    userId: string
  ) {
    const result = await client.query<AccountRow>(
      `SELECT
         u.id::text,
         u.email,
         u.display_name,
         u.status AS user_status,
         om.role,
         om.status AS membership_status,
         u.created_at,
         u.updated_at
       FROM users u
       JOIN organization_memberships om
         ON om.organization_id = u.organization_id
        AND om.user_id = u.id
       WHERE u.id = $1::uuid
         AND u.organization_id = $2::uuid
         AND u.account_type = 'TENANT'
       FOR UPDATE OF u, om`,
      [userId, organizationId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Tenant account was not found.");
    return this.mapAccount(row);
  }

  private mapAccount(row: AccountRow) {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      userStatus: row.user_status,
      role: row.role,
      membershipStatus: row.membership_status,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  }

  private role(value: string): Role {
    if (!roles.includes(value as Role)) {
      throw new ConflictException("Role không hợp lệ.");
    }
    return value as Role;
  }

  private email(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new ConflictException("Email không hợp lệ.");
    }
    return normalized;
  }

  private required(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized) throw new ConflictException(field + " is required.");
    return normalized;
  }

  private requirePermission(
    principal: PlatformPrincipal,
    permission: PlatformPermission
  ) {
    if (!platformRoleHasPermission(principal.role, permission)) {
      throw new ForbiddenException("Platform permission is required.");
    }
  }

  private async audit(
    client: PoolClient,
    principal: PlatformPrincipal,
    event: {
      action: string;
      organizationId: string;
      targetKey: string;
      before: unknown;
      after: unknown;
      reason: string;
    }
  ) {
    await client.query(
      `INSERT INTO platform_audit_events (
         actor_user_id, action, target_type, target_key, organization_id,
         before_state, after_state, reason
       )
       VALUES ($1, $2, 'TENANT_ACCOUNT', $3, $4, $5::jsonb, $6::jsonb, $7)`,
      [
        principal.userId,
        event.action,
        event.targetKey,
        event.organizationId,
        JSON.stringify(event.before),
        JSON.stringify(event.after),
        event.reason
      ]
    );
  }
}
