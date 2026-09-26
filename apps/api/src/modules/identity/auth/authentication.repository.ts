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
  credential: PasswordCredential;
}

export interface SessionIdentity {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  csrfHash: Buffer;
  expiresAt: Date;
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
  password_hash: Buffer;
  password_salt: Buffer;
  scrypt_n: number;
  scrypt_r: number;
  scrypt_p: number;
};

type SessionRow = QueryResultRow & {
  session_id: string;
  user_id: string;
  email: string;
  display_name: string;
  csrf_hash: Buffer;
  expires_at: Date;
};

type MembershipRow = QueryResultRow & {
  organization_id: string;
  organization_name: string;
  role: string;
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
         c.password_hash,
         c.password_salt,
         c.scrypt_n,
         c.scrypt_r,
         c.scrypt_p
       FROM users u
       JOIN user_password_credentials c ON c.user_id = u.id
       WHERE lower(u.email) = lower($1)
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
      credential: {
        hash: row.password_hash,
        salt: row.password_salt,
        n: row.scrypt_n,
        r: row.scrypt_r,
        p: row.scrypt_p
      }
    };
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

  async createSession(input: {
    userId: string;
    authVersion: number;
    tokenHash: Buffer;
    csrfHash: Buffer;
    expiresAt: Date;
  }): Promise<string> {
    const result = await this.db.query<QueryResultRow & { id: string }>(
      `INSERT INTO auth_sessions (
         user_id, auth_version, token_hash, csrf_hash, expires_at
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id::text`,
      [
        input.userId,
        input.authVersion,
        input.tokenHash,
        input.csrfHash,
        input.expiresAt
      ]
    );
    return result.rows[0]!.id;
  }

  async findSessionByTokenHash(
    tokenHash: Buffer
  ): Promise<SessionIdentity | null> {
    const result = await this.db.query<SessionRow>(
      `SELECT
         s.id::text AS session_id,
         s.user_id::text,
         u.email,
         u.display_name,
         s.csrf_hash,
         s.expires_at
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND u.status = 'ACTIVE'
         AND u.auth_version = s.auth_version
       LIMIT 1`,
      [tokenHash]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      sessionId: row.session_id,
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      csrfHash: row.csrf_hash,
      expiresAt: row.expires_at
    };
  }

  async revokeSessionByTokenHash(tokenHash: Buffer): Promise<void> {
    await this.db.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE token_hash = $1`,
      [tokenHash]
    );
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
