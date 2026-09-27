import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { SubscriptionManagementService } from "../../commercial/application/subscription-management.service.js";
import { DatabaseService } from "../../database/database.service.js";
import type { PasswordCredential } from "./password.js";

export type TenantOnboardingResult = {
  userId: string;
  organizationId: string;
  email: string;
  displayName: string;
  authVersion: number;
};

@Injectable()
export class TenantOnboardingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly subscriptions: SubscriptionManagementService
  ) {}

  async registrationEnabled(): Promise<boolean> {
    const result = await this.db.query<QueryResultRow & { value: unknown }>(
      "SELECT value FROM system_settings WHERE key = 'registration_enabled'"
    );
    return result.rows[0]?.value === true;
  }

  async googleAuthEnabled(): Promise<boolean> {
    const result = await this.db.query<QueryResultRow & { value: unknown }>(
      "SELECT value FROM system_settings WHERE key = 'google_auth_enabled'"
    );
    return result.rows[0]?.value !== false;
  }

  async passwordRegistrationEnabled(): Promise<boolean> {
    const result = await this.db.query<QueryResultRow & { value: unknown }>(
      "SELECT value FROM system_settings WHERE key = 'password_registration_enabled'"
    );
    return result.rows[0]?.value !== false;
  }

  async beginPasswordRegistration(input: {
    email: string;
    displayName: string;
    organizationName: string;
    credential: PasswordCredential;
    tokenHash: Buffer;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.withTransaction(async (client) => {
      const registrationEnabled = await this.settingBoolean(
        client,
        "registration_enabled",
        true
      );
      const passwordRegistrationEnabled = await this.settingBoolean(
        client,
        "password_registration_enabled",
        true
      );
      if (!registrationEnabled || !passwordRegistrationEnabled) {
        throw new ConflictException(
          "Đăng ký bằng email/mật khẩu đang tắt."
        );
      }

      const email = input.email.trim().toLowerCase();
      const existing = await client.query(
        "SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1",
        [email]
      );
      if ((existing.rowCount ?? 0) > 0) {
        throw new ConflictException("Không thể sử dụng email này để đăng ký.");
      }

      this.validateProfile(input.displayName, input.organizationName);

      await client.query(
        "DELETE FROM auth_pending_registrations WHERE expires_at <= now() OR lower(email) = lower($1)",
        [email]
      );
      await client.query(
        `INSERT INTO auth_pending_registrations (
           email,
           display_name,
           organization_name,
           password_hash,
           password_salt,
           scrypt_n,
           scrypt_r,
           scrypt_p,
           token_hash,
           expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          email,
          input.displayName.trim(),
          input.organizationName.trim(),
          input.credential.hash,
          input.credential.salt,
          input.credential.n,
          input.credential.r,
          input.credential.p,
          input.tokenHash,
          input.expiresAt
        ]
      );
    });
  }

  async verifyPasswordRegistration(
    tokenHash: Buffer
  ): Promise<TenantOnboardingResult | null> {
    const pending = await this.db.query<
      QueryResultRow & {
        id: string;
        email: string;
        display_name: string;
        organization_name: string;
        password_hash: Buffer;
        password_salt: Buffer;
        scrypt_n: number;
        scrypt_r: number;
        scrypt_p: number;
      }
    >(
      `UPDATE auth_pending_registrations
       SET consumed_at = now(), updated_at = now()
       WHERE token_hash = $1
         AND consumed_at IS NULL
         AND expires_at > now()
       RETURNING
         id::text,
         email,
         display_name,
         organization_name,
         password_hash,
         password_salt,
         scrypt_n,
         scrypt_r,
         scrypt_p`,
      [tokenHash]
    );
    const row = pending.rows[0];
    if (!row) return null;

    try {
      const result = await this.register({
        email: row.email,
        displayName: row.display_name,
        organizationName: row.organization_name,
        credential: {
          hash: row.password_hash,
          salt: row.password_salt,
          n: row.scrypt_n,
          r: row.scrypt_r,
          p: row.scrypt_p
        },
        emailVerified: true
      });

      await this.db.query(
        "DELETE FROM auth_pending_registrations WHERE id = $1::uuid",
        [row.id]
      );
      return result;
    } catch (error) {
      await this.db.query(
        `UPDATE auth_pending_registrations
         SET consumed_at = NULL, updated_at = now()
         WHERE id = $1::uuid
           AND expires_at > now()`,
        [row.id]
      );
      throw error;
    }
  }

  async register(input: {
    email: string;
    displayName: string;
    organizationName: string;
    credential?: PasswordCredential;
    google?: { subject: string; providerEmail: string };
    emailVerified?: boolean;
  }): Promise<TenantOnboardingResult> {
    return this.db.withTransaction(async (client) => {
      const registrationEnabled = await this.settingBoolean(
        client,
        "registration_enabled",
        true
      );
      if (!registrationEnabled) {
        throw new ConflictException("Hệ thống đang tạm khóa đăng ký tài khoản mới.");
      }

      if (input.credential) {
        const passwordRegistrationEnabled = await this.settingBoolean(
          client,
          "password_registration_enabled",
          true
        );
        if (!passwordRegistrationEnabled) {
          throw new ConflictException(
            "Đăng ký bằng email/mật khẩu đang tắt. Hãy dùng Google hoặc liên hệ quản trị viên."
          );
        }
      }

      const email = input.email.trim().toLowerCase();
      const existing = await client.query(
        "SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1",
        [email]
      );
      if ((existing.rowCount ?? 0) > 0) {
        throw new ConflictException("Không thể sử dụng email này để đăng ký.");
      }

      const organizationName = input.organizationName.trim();
      const displayName = input.displayName.trim();
      this.validateProfile(displayName, organizationName);

      const slugBase = this.slug(organizationName);
      const slug = slugBase + "-" + randomBytes(4).toString("hex");

      const organization = await client.query<QueryResultRow & { id: string }>(
        `INSERT INTO organizations (slug, name, organization_type, status)
         VALUES ($1, $2, 'INDIVIDUAL', 'ACTIVE')
         RETURNING id::text`,
        [slug, organizationName]
      );
      const organizationId = organization.rows[0]!.id;

      const user = await client.query<
        QueryResultRow & { id: string; auth_version: number }
      >(
        `INSERT INTO users (
           organization_id,
           account_type,
           email,
           display_name,
           status,
           email_verified_at
         )
         VALUES ($1, 'TENANT', $2, $3, 'ACTIVE', $4)
         RETURNING id::text, auth_version`,
        [
          organizationId,
          email,
          displayName,
          input.emailVerified || input.google ? new Date() : null
        ]
      );
      const userId = user.rows[0]!.id;

      if (input.credential) {
        await client.query(
          `INSERT INTO user_password_credentials (
             user_id, password_hash, password_salt, scrypt_n, scrypt_r, scrypt_p
           )
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            userId,
            input.credential.hash,
            input.credential.salt,
            input.credential.n,
            input.credential.r,
            input.credential.p
          ]
        );
      }

      if (input.google) {
        await client.query(
          `INSERT INTO user_auth_identities (
             user_id, provider, provider_subject, provider_email
           )
           VALUES ($1, 'GOOGLE', $2, $3)`,
          [userId, input.google.subject, input.google.providerEmail]
        );
      }

      const membership = await client.query<QueryResultRow & { id: string }>(
        `INSERT INTO organization_memberships (
           organization_id, user_id, role, status
         )
         VALUES ($1, $2, 'OWNER', 'ACTIVE')
         RETURNING id::text`,
        [organizationId, userId]
      );

      await client.query(
        `INSERT INTO membership_scopes (
           organization_id, membership_id, scope_type
         )
         VALUES ($1, $2, 'ORGANIZATION')`,
        [organizationId, membership.rows[0]!.id]
      );

      await this.subscriptions.provision(client, {
        organizationId,
        planCode: "STARTER",
        status: "TRIALING",
        billingInterval: "MONTHLY"
      });

      await client.query(
        `INSERT INTO audit_events (
           organization_id,
           actor_user_id,
           action,
           resource_type,
           resource_id,
           metadata
         )
         VALUES ($1, $2, 'TENANT_SELF_REGISTERED', 'ORGANIZATION', $1, $3::jsonb)`,
        [
          organizationId,
          userId,
          JSON.stringify({
            email,
            registrationMethod: input.google ? "GOOGLE" : "PASSWORD"
          })
        ]
      );

      return {
        userId,
        organizationId,
        email,
        displayName,
        authVersion: user.rows[0]!.auth_version
      };
    });
  }

  private validateProfile(displayName: string, organizationName: string): void {
    if (!organizationName) {
      throw new BadRequestException("Tên tenant/cơ sở quản lý là bắt buộc.");
    }
    if (organizationName.length > 160) {
      throw new BadRequestException(
        "Tên tenant/cơ sở quản lý không được vượt quá 160 ký tự."
      );
    }
    if (!displayName || displayName.length > 120) {
      throw new BadRequestException(
        "Họ tên phải có từ 1 đến 120 ký tự."
      );
    }
  }

  private async settingBoolean(
    client: PoolClient,
    key: string,
    fallback: boolean
  ): Promise<boolean> {
    const result = await client.query<QueryResultRow & { value: unknown }>(
      "SELECT value FROM system_settings WHERE key = $1",
      [key]
    );
    const value = result.rows[0]?.value;
    return typeof value === "boolean" ? value : fallback;
  }

  private slug(value: string): string {
    const normalized = value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);

    return normalized || "tenant";
  }
}
