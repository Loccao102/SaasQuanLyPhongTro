import { Injectable } from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../access-control.service.js";
import type {
  MembershipAccess,
  MembershipStatus,
  Role
} from "../domain/access-control.js";

export interface IdentityActor {
  userId: string;
  membership: MembershipAccess;
}

export interface MembershipView {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
  status: MembershipStatus;
}

type MembershipRow = QueryResultRow & {
  id: string;
  organization_id: string;
  user_id: string;
  role: Role;
  status: MembershipStatus;
};

export class MembershipAuthorizationError extends Error {
  constructor() {
    super("Principal is not authorized to manage organization memberships.");
    this.name = "MembershipAuthorizationError";
  }
}

export class MembershipNotFoundError extends Error {
  constructor() {
    super("Membership was not found in the current organization.");
    this.name = "MembershipNotFoundError";
  }
}

@Injectable()
export class MembershipApplicationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async activate(input: {
    actor: IdentityActor;
    organizationId: string;
    membershipId: string;
  }): Promise<MembershipView> {
    return this.database.withTransaction(async (client) => {
      await this.commercialPolicy.lockOrganizationForMutation(
        client,
        input.organizationId
      );
      const policy = await this.commercialPolicy.loadPolicy(
        client,
        input.organizationId
      );

      if (
        !this.accessControl.can(input.actor.membership, "membership.manage", {
          organizationId: input.organizationId
        })
      ) {
        throw new MembershipAuthorizationError();
      }

      const targetResult = await client.query<MembershipRow>(
        `SELECT
           id::text,
           organization_id::text,
           user_id::text,
           role,
           status
         FROM organization_memberships
         WHERE organization_id = $1
           AND id = $2
         FOR UPDATE`,
        [input.organizationId, input.membershipId]
      );
      const target = targetResult.rows[0];
      if (!target) {
        throw new MembershipNotFoundError();
      }

      if (target.status === "ACTIVE") {
        return this.mapMembership(target);
      }

      this.commercialPolicy.assertWriteAllowed(policy);

      const usageResult = await client.query<QueryResultRow & { count: number }>(
        `SELECT count(*)::int AS count
         FROM organization_memberships
         WHERE organization_id = $1
           AND status = 'ACTIVE'`,
        [input.organizationId]
      );
      const current = usageResult.rows[0]?.count ?? 0;

      this.commercialPolicy.assertResourceIncreaseAllowed(
        policy,
        "STAFF",
        current,
        1
      );

      const updatedResult = await client.query<MembershipRow>(
        `UPDATE organization_memberships
         SET status = 'ACTIVE',
             updated_at = now()
         WHERE organization_id = $1
           AND id = $2
         RETURNING
           id::text,
           organization_id::text,
           user_id::text,
           role,
           status`,
        [input.organizationId, input.membershipId]
      );
      const updated = updatedResult.rows[0]!;

      await client.query(
        `INSERT INTO audit_events (
           organization_id,
           actor_user_id,
           action,
           resource_type,
           resource_id,
           metadata
         )
         VALUES ($1, $2, 'MEMBERSHIP_ACTIVATED', 'MEMBERSHIP', $3, $4::jsonb)`,
        [
          input.organizationId,
          input.actor.userId,
          input.membershipId,
          JSON.stringify({
            role: updated.role,
            planVersionId: policy.planVersionId,
            staffLimit: policy.entitlements.staffLimit
          })
        ]
      );

      return this.mapMembership(updated);
    });
  }

  private mapMembership(row: MembershipRow): MembershipView {
    return {
      id: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      role: row.role,
      status: row.status
    };
  }
}
