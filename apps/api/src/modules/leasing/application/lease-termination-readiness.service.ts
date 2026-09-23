import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";

export type ReadinessState = "PENDING" | "READY" | "NOT_REQUIRED";
export type ReadinessKind = "meter" | "financial" | "deposit";

type ContextRow = QueryResultRow & {
  lease_id: string;
  property_id: string;
  lease_status: string;
  termination_id: string | null;
  operational_group_ids: string[];
};

@Injectable()
export class LeaseTerminationReadinessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async setManualReadiness(
    principal: TenantPrincipal,
    leaseId: string,
    input: {
      kind: ReadinessKind;
      state: ReadinessState;
      reason: string;
    }
  ) {
    const reason = input.reason.trim();
    if (!reason) {
      throw new ConflictException("A reason is required for a manual readiness override.");
    }

    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const contextResult = await client.query<ContextRow>(
        `SELECT
           l.id::text AS lease_id,
           l.status AS lease_status,
           p.id::text AS property_id,
           t.id::text AS termination_id,
           COALESCE(
             array_agg(DISTINCT pog.operational_group_id::text)
               FILTER (WHERE pog.operational_group_id IS NOT NULL),
             '{}'::text[]
           ) AS operational_group_ids
         FROM leases l
         JOIN rooms r
           ON r.organization_id = l.organization_id
          AND r.id = l.room_id
         JOIN properties p
           ON p.organization_id = r.organization_id
          AND p.id = r.property_id
         LEFT JOIN property_operational_groups pog
           ON pog.organization_id = p.organization_id
          AND pog.property_id = p.id
         LEFT JOIN lease_terminations t
           ON t.organization_id = l.organization_id
          AND t.lease_id = l.id
          AND t.status IN ('SCHEDULED', 'READY')
         WHERE l.organization_id = $1::uuid
           AND l.id = $2::uuid
         GROUP BY l.id, l.status, p.id, t.id
         LIMIT 1`,
        [principal.organizationId, leaseId]
      );

      const context = contextResult.rows[0];
      if (!context) {
        throw new NotFoundException("Lease was not found.");
      }
      if (
        !this.accessControl.can(principal.membership, "lease.terminate", {
          organizationId: principal.organizationId,
          propertyId: context.property_id,
          operationalGroupIds: context.operational_group_ids
        })
      ) {
        throw new ForbiddenException("Lease termination permission denied.");
      }
      if (
        context.lease_status !== "TERMINATION_SCHEDULED" ||
        !context.termination_id
      ) {
        throw new ConflictException(
          "Lease does not have an open termination workflow."
        );
      }

      const column =
        input.kind === "meter"
          ? "meter_readiness"
          : input.kind === "financial"
            ? "financial_readiness"
            : "deposit_readiness";

      const updated = await client.query<QueryResultRow & {
        meter_readiness: ReadinessState;
        financial_readiness: ReadinessState;
        deposit_readiness: ReadinessState;
      }>(
        `UPDATE lease_terminations
         SET ${column} = $3,
             status = CASE
               WHEN (
                 (CASE WHEN $4 = 'meter' THEN $3 ELSE meter_readiness END) <> 'PENDING'
                 AND (CASE WHEN $4 = 'financial' THEN $3 ELSE financial_readiness END) <> 'PENDING'
                 AND (CASE WHEN $4 = 'deposit' THEN $3 ELSE deposit_readiness END) <> 'PENDING'
               ) THEN 'READY'
               ELSE 'SCHEDULED'
             END,
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
           AND status IN ('SCHEDULED', 'READY')
         RETURNING meter_readiness, financial_readiness, deposit_readiness`,
        [
          principal.organizationId,
          context.termination_id,
          input.state,
          input.kind
        ]
      );

      if (updated.rowCount !== 1) {
        throw new ConflictException("Termination workflow changed concurrently.");
      }

      await client.query(
        `INSERT INTO audit_events (
           organization_id, actor_user_id, action, resource_type, resource_id, metadata
         )
         VALUES ($1, $2, 'LEASE_TERMINATION_READINESS_OVERRIDE', 'LEASE', $3, $4::jsonb)`,
        [
          principal.organizationId,
          principal.userId,
          leaseId,
          JSON.stringify({
            kind: input.kind,
            state: input.state,
            reason,
            source: "MANUAL_OPERATOR"
          })
        ]
      );

      const row = updated.rows[0]!;
      return {
        meter: row.meter_readiness,
        financial: row.financial_readiness,
        deposit: row.deposit_readiness
      };
    });
  }
}
