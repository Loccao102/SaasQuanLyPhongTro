import { Injectable } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import {
  hashPassword,
  type PasswordCredential
} from "../auth/password.js";
import {
  generateOpaqueToken,
  hashOpaqueToken,
  safeTokenHash
} from "../auth/session-token.js";
import type { Role } from "../domain/access-control.js";

type InvitationRow = QueryResultRow & {
  invitation_id: string;
  organization_id: string;
  membership_id: string;
  user_id: string;
  organization_name: string;
  organization_status: string;
  email: string;
  display_name: string;
  user_status: string;
  role: Role;
  membership_status: string;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  has_password: boolean;
};

export class MembershipInvitationUnavailableError extends Error {
  constructor() {
    super("Invitation is invalid, expired, revoked or already used.");
    this.name = "MembershipInvitationUnavailableError";
  }
}

export class MembershipInvitationPasswordRequiredError extends Error {
  constructor() {
    super("A password is required to activate this new account.");
    this.name = "MembershipInvitationPasswordRequiredError";
  }
}

@Injectable()
export class MembershipInvitationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async issueInTransaction(
    client: PoolClient,
    input: {
      organizationId: string;
      membershipId: string;
      createdByUserId: string;
    }
  ) {
    await client.query(
      `UPDATE membership_invitations
       SET revoked_at = now(),
           updated_at = now()
       WHERE organization_id = $1::uuid
         AND membership_id = $2::uuid
         AND accepted_at IS NULL
         AND revoked_at IS NULL`,
      [input.organizationId, input.membershipId]
    );

    const token = generateOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.ttlHours() * 60 * 60 * 1000
    );

    const result = await client.query<QueryResultRow & { id: string }>(
      `INSERT INTO membership_invitations (
         organization_id,
         membership_id,
         token_hash,
         created_by_user_id,
         expires_at
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id::text`,
      [
        input.organizationId,
        input.membershipId,
        hashOpaqueToken(token),
        input.createdByUserId,
        expiresAt
      ]
    );

    return {
      id: result.rows[0]!.id,
      token,
      expiresAt: expiresAt.toISOString()
    };
  }

  async revokeInTransaction(
    client: PoolClient,
    input: {
      organizationId: string;
      membershipId: string;
    }
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE membership_invitations
       SET revoked_at = now(),
           updated_at = now()
       WHERE organization_id = $1::uuid
         AND membership_id = $2::uuid
         AND accepted_at IS NULL
         AND revoked_at IS NULL`,
      [input.organizationId, input.membershipId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async inspect(token: string) {
    const tokenHash = safeTokenHash(token);
    if (!tokenHash) throw new MembershipInvitationUnavailableError();

    const result = await this.db.query<InvitationRow>(
      this.invitationSelect(false),
      [tokenHash]
    );
    const row = result.rows[0];
    this.assertAvailable(row);

    return {
      organizationName: row.organization_name,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      expiresAt: row.expires_at.toISOString(),
      requiresPassword: !row.has_password
    };
  }

  async accept(input: { token: string; password?: string }) {
    const tokenHash = safeTokenHash(input.token);
    if (!tokenHash) throw new MembershipInvitationUnavailableError();

    const previewResult = await this.db.query<InvitationRow>(
      this.invitationSelect(false),
      [tokenHash]
    );
    const preview = previewResult.rows[0];
    this.assertAvailable(preview);

    let newCredential: PasswordCredential | null = null;
    if (!preview.has_password) {
      if (!input.password) {
        throw new MembershipInvitationPasswordRequiredError();
      }
      newCredential = await hashPassword(input.password);
    }

    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.lockOrganizationForMutation(
        client,
        preview.organization_id
      );
      const policy = await this.commercialPolicy.loadPolicy(
        client,
        preview.organization_id
      );
      this.commercialPolicy.assertWriteAllowed(policy);

      const lockedResult = await client.query<InvitationRow>(
        this.invitationSelect(true),
        [tokenHash]
      );
      const locked = lockedResult.rows[0];
      this.assertAvailable(locked);

      const usageResult = await client.query<QueryResultRow & { count: number }>(
        `SELECT count(*)::int AS count
         FROM organization_memberships
         WHERE organization_id = $1::uuid
           AND status = 'ACTIVE'`,
        [locked.organization_id]
      );
      this.commercialPolicy.assertResourceIncreaseAllowed(
        policy,
        "STAFF",
        usageResult.rows[0]?.count ?? 0,
        1
      );

      const credentialResult = await client.query(
        `SELECT 1
         FROM user_password_credentials
         WHERE user_id = $1::uuid
         LIMIT 1`,
        [locked.user_id]
      );
      if ((credentialResult.rowCount ?? 0) === 0) {
        if (!newCredential) {
          throw new MembershipInvitationPasswordRequiredError();
        }
        await client.query(
          `INSERT INTO user_password_credentials (
             user_id,
             password_hash,
             password_salt,
             scrypt_n,
             scrypt_r,
             scrypt_p
           )
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id) DO NOTHING`,
          [
            locked.user_id,
            newCredential.hash,
            newCredential.salt,
            newCredential.n,
            newCredential.r,
            newCredential.p
          ]
        );
      }

      await client.query(
        `UPDATE organization_memberships
         SET status = 'ACTIVE',
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid`,
        [locked.organization_id, locked.membership_id]
      );
      await client.query(
        `UPDATE membership_invitations
         SET accepted_at = now(),
             updated_at = now()
         WHERE id = $1::uuid`,
        [locked.invitation_id]
      );
      await client.query(
        `INSERT INTO audit_events (
           organization_id,
           actor_user_id,
           action,
           resource_type,
           resource_id,
           metadata
         )
         VALUES (
           $1,
           $2,
           'MEMBERSHIP_INVITATION_ACCEPTED',
           'MEMBERSHIP',
           $3,
           $4::jsonb
         )`,
        [
          locked.organization_id,
          locked.user_id,
          locked.membership_id,
          JSON.stringify({
            role: locked.role,
            invitationId: locked.invitation_id,
            planVersionId: policy.planVersionId,
            staffLimit: policy.entitlements.staffLimit
          })
        ]
      );

      return {
        organizationId: locked.organization_id,
        organizationName: locked.organization_name,
        membershipId: locked.membership_id,
        role: locked.role,
        status: "ACTIVE" as const,
        email: locked.email
      };
    });
  }

  private invitationSelect(lock: boolean): string {
    return `SELECT
       mi.id::text AS invitation_id,
       mi.organization_id::text,
       mi.membership_id::text,
       om.user_id::text,
       o.name AS organization_name,
       o.status AS organization_status,
       u.email,
       u.display_name,
       u.status AS user_status,
       om.role,
       om.status AS membership_status,
       mi.expires_at,
       mi.accepted_at,
       mi.revoked_at,
       EXISTS (
         SELECT 1
         FROM user_password_credentials credential
         WHERE credential.user_id = om.user_id
       ) AS has_password
     FROM membership_invitations mi
     JOIN organization_memberships om
       ON om.organization_id = mi.organization_id
      AND om.id = mi.membership_id
     JOIN organizations o ON o.id = mi.organization_id
     JOIN users u ON u.id = om.user_id
     WHERE mi.token_hash = $1
     LIMIT 1${lock ? " FOR UPDATE OF mi, om, u" : ""}`;
  }

  private assertAvailable(
    row: InvitationRow | undefined
  ): asserts row is InvitationRow {
    if (
      !row ||
      row.accepted_at !== null ||
      row.revoked_at !== null ||
      row.expires_at.getTime() <= Date.now() ||
      row.membership_status !== "INVITED" ||
      row.organization_status !== "ACTIVE" ||
      row.user_status !== "ACTIVE"
    ) {
      throw new MembershipInvitationUnavailableError();
    }
  }

  private ttlHours(): number {
    const value = Number(process.env.TEAM_INVITATION_TTL_HOURS ?? "168");
    if (!Number.isInteger(value) || value < 1 || value > 720) {
      throw new Error(
        "TEAM_INVITATION_TTL_HOURS must be an integer between 1 and 720."
      );
    }
    return value;
  }
}
