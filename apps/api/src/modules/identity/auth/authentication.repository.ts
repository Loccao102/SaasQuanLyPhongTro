import { Injectable } from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import type { PasswordCredential } from "./password.js";

export interface CredentialIdentity {
  userId: string;
  email: string;
  displayName: string;
  userStatus: string;
  authVersion: number;
  organizationId: string | null;
  accountType: "TENANT" | "PLATFORM";
  credential: PasswordCredential;
}

export interface AccountIdentity {
  userId: string;
  email: string;
  displayName: string;
  userStatus: string;
  authVersion: number;
  organizationId: string | null;
  accountType: "TENANT" | "PLATFORM";
}

export interface SessionIdentity {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  organizationId: string | null;
  accountType: "TENANT" | "PLATFORM";
  csrfHash: Buffer;
  expiresAt: Date;
  lastSeenAt: Date;
}

export interface MfaCredential {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  confirmed: boolean;
}

export interface AuthMembershipSummary {
  organizationId: string;
  organizationName: string;
  role: string;
}

type CredentialRow = QueryResultRow & {
  user_id: string;
  email: string;
  display_name: string;
  user_status: string;
  auth_version: number;
  organization_id: string | null;
  account_type: "TENANT" | "PLATFORM";
  password_hash: Buffer;
  password_salt: Buffer;
  scrypt_n: number;
  scrypt_r: number;
  scrypt_p: number;
};

type AccountRow = QueryResultRow & {
  user_id: string;
  email: string;
  display_name: string;
  user_status: string;
  auth_version: number;
  organization_id: string | null;
  account_type: "TENANT" | "PLATFORM";
};

type SessionRow = QueryResultRow & {
  session_id: string;
  user_id: string;
  email: string;
  display_name: string;
  organization_id: string | null;
  account_type: "TENANT" | "PLATFORM";
  csrf_hash: Buffer;
  expires_at: Date;
  last_seen_at: Date;
  user_agent: string | null;
  device_label: string | null;
};

type MembershipRow = QueryResultRow & {
  organization_id: string;
  organization_name: string;
  role: string;
};

type UserSessionRow = QueryResultRow & {
  id: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  user_agent: string | null;
  device_label: string | null;
};

@Injectable()
export class AuthenticationRepository {
  constructor(private readonly db: DatabaseService) {}

  async findCredentialByEmail(
    email: string
  ): Promise<CredentialIdentity | null> {
    const result = await this.db.query<CredentialRow>(
      `SELECT
         u.id::text AS user_id,
         u.email,
         u.display_name,
         u.status AS user_status,
         u.auth_version,
         u.organization_id::text,
         u.account_type,
         c.password_hash,
         c.password_salt,
         c.scrypt_n,
         c.scrypt_r,
         c.scrypt_p
       FROM users u
       JOIN user_password_credentials c ON c.user_id = u.id
       WHERE lower(u.email) = lower($1)
         AND u.email_verified_at IS NOT NULL
       LIMIT 1`,
      [email]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      userStatus: row.user_status,
      authVersion: row.auth_version,
      organizationId: row.organization_id,
      accountType: row.account_type,
      credential: {
        hash: row.password_hash,
        salt: row.password_salt,
        n: row.scrypt_n,
        r: row.scrypt_r,
        p: row.scrypt_p
      }
    };
  }

  async findCredentialByUserId(
    userId: string
  ): Promise<CredentialIdentity | null> {
    const result = await this.db.query<CredentialRow>(
      `SELECT
         u.id::text AS user_id,
         u.email,
         u.display_name,
         u.status AS user_status,
         u.auth_version,
         u.organization_id::text,
         u.account_type,
         c.password_hash,
         c.password_salt,
         c.scrypt_n,
         c.scrypt_r,
         c.scrypt_p
       FROM users u
       JOIN user_password_credentials c ON c.user_id = u.id
       WHERE u.id = $1::uuid
       LIMIT 1`,
      [userId]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      userStatus: row.user_status,
      authVersion: row.auth_version,
      organizationId: row.organization_id,
      accountType: row.account_type,
      credential: {
        hash: row.password_hash,
        salt: row.password_salt,
        n: row.scrypt_n,
        r: row.scrypt_r,
        p: row.scrypt_p
      }
    };
  }

  async findAccountByEmail(email: string): Promise<AccountIdentity | null> {
    const result = await this.db.query<AccountRow>(
      `SELECT
         id::text AS user_id,
         email,
         display_name,
         status AS user_status,
         auth_version,
         organization_id::text,
         account_type
       FROM users
       WHERE lower(email) = lower($1)
       LIMIT 1`,
      [email]
    );
    return result.rows[0] ? this.mapAccount(result.rows[0]) : null;
  }

  async findAccountByGoogleSubject(
    subject: string
  ): Promise<AccountIdentity | null> {
    const result = await this.db.query<AccountRow>(
      `SELECT
         u.id::text AS user_id,
         u.email,
         u.display_name,
         u.status AS user_status,
         u.auth_version,
         u.organization_id::text,
         u.account_type
       FROM user_auth_identities i
       JOIN users u ON u.id = i.user_id
       WHERE i.provider = 'GOOGLE'
         AND i.provider_subject = $1
       LIMIT 1`,
      [subject]
    );
    return result.rows[0] ? this.mapAccount(result.rows[0]) : null;
  }

  async linkGoogleIdentity(input: {
    userId: string;
    subject: string;
    providerEmail: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO user_auth_identities (
         user_id, provider, provider_subject, provider_email
       )
       VALUES ($1, 'GOOGLE', $2, $3)
       ON CONFLICT (user_id, provider) DO UPDATE
         SET provider_subject = EXCLUDED.provider_subject,
             provider_email = EXCLUDED.provider_email,
             updated_at = now()`,
      [input.userId, input.subject, input.providerEmail]
    );
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    credential: PasswordCredential
  ): Promise<void> {
    await this.db.withTransaction(async (client) => {
      const userResult = await client.query<{ auth_version: number }>(
        `UPDATE users
         SET auth_version = auth_version + 1, updated_at = now()
         WHERE id = $1::uuid
         RETURNING auth_version`,
        [userId]
      );
      const newVersion = userResult.rows[0]?.auth_version;
      if (!newVersion) {
        throw new Error("User was not found.");
      }

      await client.query(
        `UPDATE user_password_credentials
         SET password_hash = $2,
             password_salt = $3,
             scrypt_n = $4,
             scrypt_r = $5,
             scrypt_p = $6,
             password_changed_at = now(),
             updated_at = now()
         WHERE user_id = $1::uuid`,
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
        `UPDATE auth_sessions
         SET auth_version = $2, last_seen_at = now()
         WHERE id = $1::uuid`,
        [currentSessionId, newVersion]
      );
    });
  }

  async replacePasswordResetToken(input: {
    userId: string;
    tokenHash: Buffer;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.withTransaction(async (client) => {
      await client.query(
        `UPDATE auth_password_reset_tokens
         SET consumed_at = COALESCE(consumed_at, now())
         WHERE user_id = $1::uuid
           AND consumed_at IS NULL`,
        [input.userId]
      );
      await client.query(
        `INSERT INTO auth_password_reset_tokens (
           user_id, token_hash, expires_at
         )
         VALUES ($1::uuid, $2, $3)`,
        [input.userId, input.tokenHash, input.expiresAt]
      );
    });
  }

  async resetPasswordWithToken(
    tokenHash: Buffer,
    credential: PasswordCredential
  ): Promise<AccountIdentity | null> {
    return this.db.withTransaction(async (client) => {
      const token = await client.query<
        AccountRow & { token_id: string }
      >(
        `SELECT
           t.id::text AS token_id,
           u.id::text AS user_id,
           u.email,
           u.display_name,
           u.status AS user_status,
           u.auth_version,
           u.organization_id::text,
           u.account_type
         FROM auth_password_reset_tokens t
         JOIN users u ON u.id = t.user_id
         JOIN user_password_credentials c ON c.user_id = u.id
         WHERE t.token_hash = $1
           AND t.consumed_at IS NULL
           AND t.expires_at > now()
           AND u.status = 'ACTIVE'
           AND u.email_verified_at IS NOT NULL
         FOR UPDATE OF t, u, c
         LIMIT 1`,
        [tokenHash]
      );
      const row = token.rows[0];
      if (!row) return null;

      const userResult = await client.query<{ auth_version: number }>(
        `UPDATE users
         SET auth_version = auth_version + 1, updated_at = now()
         WHERE id = $1::uuid
         RETURNING auth_version`,
        [row.user_id]
      );
      const authVersion = userResult.rows[0]?.auth_version;
      if (!authVersion) {
        throw new Error("User was not found.");
      }

      await client.query(
        `UPDATE user_password_credentials
         SET password_hash = $2,
             password_salt = $3,
             scrypt_n = $4,
             scrypt_r = $5,
             scrypt_p = $6,
             password_changed_at = now(),
             updated_at = now()
         WHERE user_id = $1::uuid`,
        [
          row.user_id,
          credential.hash,
          credential.salt,
          credential.n,
          credential.r,
          credential.p
        ]
      );

      await client.query(
        `UPDATE auth_sessions
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE user_id = $1::uuid
           AND revoked_at IS NULL`,
        [row.user_id]
      );

      await client.query(
        `UPDATE auth_password_reset_tokens
         SET consumed_at = COALESCE(consumed_at, now())
         WHERE user_id = $1::uuid
           AND consumed_at IS NULL`,
        [row.user_id]
      );

      return this.mapAccount({
        ...row,
        auth_version: authVersion
      });
    });
  }

  async upsertMfaSetup(input: {
    userId: string;
    ciphertext: Buffer;
    iv: Buffer;
    tag: Buffer;
  }): Promise<void> {
    await this.db.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO user_totp_credentials (
           user_id, secret_ciphertext, secret_iv, secret_tag, confirmed_at
         )
         VALUES ($1::uuid, $2, $3, $4, NULL)
         ON CONFLICT (user_id) DO UPDATE SET
           secret_ciphertext = EXCLUDED.secret_ciphertext,
           secret_iv = EXCLUDED.secret_iv,
           secret_tag = EXCLUDED.secret_tag,
           confirmed_at = NULL,
           updated_at = now()`,
        [input.userId, input.ciphertext, input.iv, input.tag]
      );
      await client.query(
        "DELETE FROM user_mfa_recovery_codes WHERE user_id = $1::uuid",
        [input.userId]
      );
    });
  }

  async getMfaCredential(
    userId: string,
    confirmedOnly = true
  ): Promise<MfaCredential | null> {
    const result = await this.db.query<
      QueryResultRow & {
        secret_ciphertext: Buffer;
        secret_iv: Buffer;
        secret_tag: Buffer;
        confirmed_at: Date | null;
      }
    >(
      `SELECT secret_ciphertext, secret_iv, secret_tag, confirmed_at
       FROM user_totp_credentials
       WHERE user_id = $1::uuid
         AND ($2::boolean = false OR confirmed_at IS NOT NULL)
       LIMIT 1`,
      [userId, confirmedOnly]
    );
    const row = result.rows[0];
    return row
      ? {
          ciphertext: row.secret_ciphertext,
          iv: row.secret_iv,
          tag: row.secret_tag,
          confirmed: row.confirmed_at !== null
        }
      : null;
  }

  async confirmMfaSetup(
    userId: string,
    recoveryCodeHashes: readonly Buffer[]
  ): Promise<boolean> {
    return this.db.withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE user_totp_credentials
         SET confirmed_at = now(), updated_at = now()
         WHERE user_id = $1::uuid
           AND confirmed_at IS NULL`,
        [userId]
      );
      if ((updated.rowCount ?? 0) !== 1) return false;

      await client.query(
        "DELETE FROM user_mfa_recovery_codes WHERE user_id = $1::uuid",
        [userId]
      );
      for (const hash of recoveryCodeHashes) {
        await client.query(
          `INSERT INTO user_mfa_recovery_codes (user_id, code_hash)
           VALUES ($1::uuid, $2)`,
          [userId, hash]
        );
      }
      return true;
    });
  }

  async disableMfa(
    userId: string,
    currentSessionId: string
  ): Promise<void> {
    await this.db.withTransaction(async (client) => {
      await client.query(
        "DELETE FROM user_totp_credentials WHERE user_id = $1::uuid",
        [userId]
      );
      await client.query(
        "DELETE FROM user_mfa_recovery_codes WHERE user_id = $1::uuid",
        [userId]
      );
      await client.query(
        "DELETE FROM auth_mfa_challenges WHERE user_id = $1::uuid",
        [userId]
      );

      const user = await client.query<{ auth_version: number }>(
        `UPDATE users
         SET auth_version = auth_version + 1, updated_at = now()
         WHERE id = $1::uuid
         RETURNING auth_version`,
        [userId]
      );
      const version = user.rows[0]?.auth_version;
      if (!version) throw new Error("User was not found.");

      await client.query(
        `UPDATE auth_sessions
         SET auth_version = $2, last_seen_at = now()
         WHERE id = $1::uuid`,
        [currentSessionId, version]
      );
      await client.query(
        `UPDATE auth_sessions
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE user_id = $1::uuid
           AND id <> $2::uuid
           AND revoked_at IS NULL`,
        [userId, currentSessionId]
      );
    });
  }

  async createMfaChallenge(input: {
    userId: string;
    tokenHash: Buffer;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.withTransaction(async (client) => {
      await client.query(
        `UPDATE auth_mfa_challenges
         SET consumed_at = COALESCE(consumed_at, now())
         WHERE user_id = $1::uuid
           AND consumed_at IS NULL`,
        [input.userId]
      );
      await client.query(
        `INSERT INTO auth_mfa_challenges (user_id, token_hash, expires_at)
         VALUES ($1::uuid, $2, $3)`,
        [input.userId, input.tokenHash, input.expiresAt]
      );
    });
  }

  async findMfaChallenge(
    tokenHash: Buffer
  ): Promise<AccountIdentity | null> {
    const result = await this.db.query<AccountRow>(
      `SELECT
         u.id::text AS user_id,
         u.email,
         u.display_name,
         u.status AS user_status,
         u.auth_version,
         u.organization_id::text,
         u.account_type
       FROM auth_mfa_challenges c
       JOIN users u ON u.id = c.user_id
       JOIN user_totp_credentials m ON m.user_id = u.id
       WHERE c.token_hash = $1
         AND c.consumed_at IS NULL
         AND c.expires_at > now()
         AND m.confirmed_at IS NOT NULL
         AND u.status = 'ACTIVE'
       LIMIT 1`,
      [tokenHash]
    );
    return result.rows[0] ? this.mapAccount(result.rows[0]) : null;
  }

  async consumeMfaChallenge(
    userId: string,
    tokenHash: Buffer
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE auth_mfa_challenges
       SET consumed_at = now()
       WHERE user_id = $1::uuid
         AND token_hash = $2
         AND consumed_at IS NULL
         AND expires_at > now()`,
      [userId, tokenHash]
    );
    return (result.rowCount ?? 0) === 1;
  }

  async consumeRecoveryCode(
    userId: string,
    codeHash: Buffer
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE user_mfa_recovery_codes
       SET used_at = now()
       WHERE id = (
         SELECT id
         FROM user_mfa_recovery_codes
         WHERE user_id = $1::uuid
           AND code_hash = $2
           AND used_at IS NULL
         LIMIT 1
       )
       AND used_at IS NULL`,
      [userId, codeHash]
    );
    return (result.rowCount ?? 0) === 1;
  }

  async createSession(input: {
    userId: string;
    authVersion: number;
    organizationId: string | null;
    tokenHash: Buffer;
    csrfHash: Buffer;
    expiresAt: Date;
    userAgent?: string | null;
    deviceLabel?: string | null;
  }): Promise<string> {
    const result = await this.db.query<QueryResultRow & { id: string }>(
      `INSERT INTO auth_sessions (
         user_id,
         organization_id,
         auth_version,
         token_hash,
         csrf_hash,
         expires_at,
         user_agent,
         device_label
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id::text`,
      [
        input.userId,
        input.organizationId,
        input.authVersion,
        input.tokenHash,
        input.csrfHash,
        input.expiresAt,
        input.userAgent ?? null,
        input.deviceLabel ?? null
      ]
    );
    return result.rows[0]!.id;
  }

  async findSessionByTokenHash(
    tokenHash: Buffer,
    idleCutoff: Date
  ): Promise<SessionIdentity | null> {
    const result = await this.db.query<SessionRow>(
      `SELECT
         s.id::text AS session_id,
         s.user_id::text,
         u.email,
         u.display_name,
         u.organization_id::text,
         u.account_type,
         s.csrf_hash,
         s.expires_at,
         s.last_seen_at,
         s.user_agent,
         s.device_label
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND s.last_seen_at > $2
         AND u.status = 'ACTIVE'
         AND u.auth_version = s.auth_version
         AND s.organization_id IS NOT DISTINCT FROM u.organization_id
       LIMIT 1`,
      [tokenHash, idleCutoff]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      sessionId: row.session_id,
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      organizationId: row.organization_id,
      accountType: row.account_type,
      csrfHash: row.csrf_hash,
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at
    };
  }

  async touchSession(sessionId: string, touchBefore: Date): Promise<void> {
    await this.db.query(
      `UPDATE auth_sessions
       SET last_seen_at = now()
       WHERE id = $1::uuid
         AND revoked_at IS NULL
         AND last_seen_at < $2`,
      [sessionId, touchBefore]
    );
  }

  async revokeSessionByTokenHash(tokenHash: Buffer): Promise<void> {
    await this.db.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE token_hash = $1`,
      [tokenHash]
    );
  }

  async listActiveSessions(userId: string): Promise<Array<{
    id: string;
    createdAt: Date;
    lastSeenAt: Date;
    expiresAt: Date;
    userAgent: string | null;
    deviceLabel: string | null;
  }>> {
    const result = await this.db.query<UserSessionRow>(
      `SELECT
         id::text,
         created_at,
         last_seen_at,
         expires_at,
         user_agent,
         device_label
       FROM auth_sessions
       WHERE user_id = $1::uuid
         AND revoked_at IS NULL
         AND expires_at > now()
       ORDER BY last_seen_at DESC, created_at DESC`,
      [userId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      userAgent: row.user_agent,
      deviceLabel: row.device_label
    }));
  }

  async revokeSessionForUser(
    userId: string,
    sessionId: string
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE id = $1::uuid
         AND user_id = $2::uuid
         AND revoked_at IS NULL`,
      [sessionId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async revokeOtherSessions(
    userId: string,
    currentSessionId: string
  ): Promise<number> {
    const result = await this.db.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE user_id = $1::uuid
         AND id <> $2::uuid
         AND revoked_at IS NULL`,
      [userId, currentSessionId]
    );
    return result.rowCount ?? 0;
  }

  private mapAccount(row: AccountRow): AccountIdentity {
    return {
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      userStatus: row.user_status,
      authVersion: row.auth_version,
      organizationId: row.organization_id,
      accountType: row.account_type
    };
  }

  async listActiveMemberships(
    userId: string
  ): Promise<AuthMembershipSummary[]> {
    const result = await this.db.query<MembershipRow>(
      `SELECT
         om.organization_id::text,
         o.name AS organization_name,
         om.role
       FROM organization_memberships om
       JOIN organizations o ON o.id = om.organization_id
       WHERE om.user_id = $1
         AND om.status = 'ACTIVE'
         AND o.status = 'ACTIVE'
       ORDER BY lower(o.name), om.organization_id`,
      [userId]
    );

    return result.rows.map((row) => ({
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      role: row.role
    }));
  }
}
