import type { PoolClient } from "pg";
import type {
  LeaseDomainEvent,
  LeaseState,
  LeaseStatus,
  ReadinessState,
  TerminationReadiness
} from "../domain/lease-lifecycle.js";
import type { StoredCommandReceipt } from "../application/idempotent-command.js";

export interface LeaseResourceContext {
  lease: LeaseState;
  propertyId: string;
  operationalGroupIds: readonly string[];
}

export class ConcurrentLeaseUpdateError extends Error {
  constructor() {
    super("Lease was changed by another transaction.");
    this.name = "ConcurrentLeaseUpdateError";
  }
}

export class PostgresLeaseRepository {
  constructor(private readonly client: PoolClient) {}

  async findLeaseForUpdate(
    organizationId: string,
    leaseId: string
  ): Promise<LeaseResourceContext | null> {
    const leaseResult = await this.client.query(
      `SELECT
         l.id,
         l.organization_id,
         l.room_id,
         r.property_id,
         l.status,
         l.start_date::text,
         l.planned_end_date::text,
         l.termination_effective_date::text,
         l.termination_reason,
         l.version
       FROM leases l
       JOIN rooms r
         ON r.organization_id = l.organization_id
        AND r.id = l.room_id
       WHERE l.organization_id = $1
         AND l.id = $2
       FOR UPDATE OF l`,
      [organizationId, leaseId]
    );

    const row = leaseResult.rows[0] as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    const groupResult = await this.client.query(
      `SELECT operational_group_id
       FROM property_operational_groups
       WHERE organization_id = $1
         AND property_id = $2
       ORDER BY operational_group_id`,
      [organizationId, row.property_id]
    );

    return {
      lease: {
        id: String(row.id),
        organizationId: String(row.organization_id),
        roomId: String(row.room_id),
        status: row.status as LeaseStatus,
        startDate: String(row.start_date),
        plannedEndDate:
          row.planned_end_date === null ? null : String(row.planned_end_date),
        terminationEffectiveDate:
          row.termination_effective_date === null
            ? null
            : String(row.termination_effective_date),
        terminationReason:
          row.termination_reason === null
            ? null
            : String(row.termination_reason),
        version: Number(row.version)
      },
      propertyId: String(row.property_id),
      operationalGroupIds: groupResult.rows.map((groupRow) =>
        String((groupRow as Record<string, unknown>).operational_group_id)
      )
    };
  }

  async updateLease(
    lease: LeaseState,
    expectedVersion: number,
    actorUserId: string,
    baseRentVnd?: number
  ): Promise<void> {
    const result = await this.client.query(
      `UPDATE leases
       SET status = $3,
           planned_end_date = $4,
           termination_effective_date = $5,
           termination_reason = $6,
           base_rent_vnd = CASE
             WHEN $7::bigint IS NOT NULL THEN $7::bigint
             ELSE base_rent_vnd
           END,
           version = $8,
           activated_at = CASE
             WHEN $3 = 'ACTIVE' AND activated_at IS NULL THEN now()
             ELSE activated_at
           END,
           terminated_at = CASE
             WHEN $3 = 'TERMINATED' THEN now()
             ELSE terminated_at
           END,
           updated_by_user_id = $9,
           updated_at = now()
       WHERE organization_id = $1
         AND id = $2
         AND version = $10`,
      [
        lease.organizationId,
        lease.id,
        lease.status,
        lease.plannedEndDate,
        lease.terminationEffectiveDate,
        lease.terminationReason,
        baseRentVnd !== undefined ? baseRentVnd : null,
        lease.version,
        actorUserId,
        expectedVersion
      ]
    );

    if (result.rowCount !== 1) {
      throw new ConcurrentLeaseUpdateError();
    }
  }

  async findCommandReceipt(
    organizationId: string,
    idempotencyKey: string
  ): Promise<StoredCommandReceipt | null> {
    const result = await this.client.query(
      `SELECT command_type, lease_id, response_payload
       FROM lease_command_receipts
       WHERE organization_id = $1
         AND idempotency_key = $2`,
      [organizationId, idempotencyKey]
    );

    const row = result.rows[0] as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      commandType: String(row.command_type),
      leaseId: row.lease_id === null ? null : String(row.lease_id),
      response: row.response_payload
    };
  }

  async saveCommandReceipt(input: {
    organizationId: string;
    idempotencyKey: string;
    commandType: string;
    leaseId: string;
    response: unknown;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO lease_command_receipts (
         organization_id,
         idempotency_key,
         command_type,
         lease_id,
         response_payload
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        input.organizationId,
        input.idempotencyKey,
        input.commandType,
        input.leaseId,
        input.response
      ]
    );
  }

  async createTermination(input: {
    organizationId: string;
    leaseId: string;
    effectiveDate: string;
    reason: string;
    actorUserId: string;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO lease_terminations (
         organization_id,
         lease_id,
         status,
         effective_date,
         reason,
         initiated_by_user_id
       ) VALUES ($1, $2, 'SCHEDULED', $3, $4, $5)`,
      [
        input.organizationId,
        input.leaseId,
        input.effectiveDate,
        input.reason,
        input.actorUserId
      ]
    );
  }

  async cancelOpenTermination(
    organizationId: string,
    leaseId: string,
    actorUserId: string
  ): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE lease_terminations
       SET status = 'CANCELLED',
           cancelled_by_user_id = $3,
           cancelled_at = now(),
           updated_at = now()
       WHERE organization_id = $1
         AND lease_id = $2
         AND status IN ('SCHEDULED', 'READY')`,
      [organizationId, leaseId, actorUserId]
    );

    return result.rowCount === 1;
  }

  async getOpenTerminationReadinessForUpdate(
    organizationId: string,
    leaseId: string
  ): Promise<TerminationReadiness | null> {
    const result = await this.client.query(
      `SELECT meter_readiness, financial_readiness, deposit_readiness
       FROM lease_terminations
       WHERE organization_id = $1
         AND lease_id = $2
         AND status IN ('SCHEDULED', 'READY')
       FOR UPDATE`,
      [organizationId, leaseId]
    );

    const row = result.rows[0] as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      meter: row.meter_readiness as ReadinessState,
      financial: row.financial_readiness as ReadinessState,
      deposit: row.deposit_readiness as ReadinessState
    };
  }

  async completeOpenTermination(
    organizationId: string,
    leaseId: string,
    actorUserId: string
  ): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE lease_terminations
       SET status = 'COMPLETED',
           completed_by_user_id = $3,
           completed_at = now(),
           updated_at = now()
       WHERE organization_id = $1
         AND lease_id = $2
         AND status IN ('SCHEDULED', 'READY')`,
      [organizationId, leaseId, actorUserId]
    );

    return result.rowCount === 1;
  }

  async appendAuditEvents(
    actorUserId: string,
    leaseVersion: number,
    events: readonly LeaseDomainEvent[]
  ): Promise<void> {
    for (const domainEvent of events) {
      await this.client.query(
        `INSERT INTO audit_events (
           organization_id,
           actor_user_id,
           action,
           resource_type,
           resource_id,
           metadata
         ) VALUES ($1, $2, $3, 'LEASE', $4, $5)`,
        [
          domainEvent.organizationId,
          actorUserId,
          domainEvent.type,
          domainEvent.leaseId,
          {
            ...domainEvent.payload,
            roomId: domainEvent.roomId,
            leaseVersion
          }
        ]
      );
    }
  }
}
