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
    actorUserId: string
  ): Promise<void> {
    const result = await this.client.query(
      `UPDATE leases
       SET status = $3,
           termination_effective_date = $4,
           termination_reason = $5,
           version = $6,
           activated_at = CASE
             WHEN $3 = 'ACTIVE' AND activated_at IS NULL THEN now()
             ELSE activated_at
           END,
           terminated_at = CASE
             WHEN $3 = 'TERMINATED' THEN now()
             ELSE terminated_at
           END,
           updated_by_user_id = $7,
           updated_at = now()
       WHERE organization_id = $1
         AND id = $2
         AND version = $8`,
      [
        lease.organizationId,
        lease.id,
        lease.status,
        lease.terminationEffectiveDate,
        lease.terminationReason,
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
      `WITH lease_info AS (
         SELECT room_id, deposit_required_vnd
         FROM leases
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
       ),
       meter_state AS (
         SELECT
           count(m.id)::int AS active_meter_count,
           count(m.id) FILTER (
             WHERE EXISTS (
               SELECT 1
               FROM meter_readings mr
               WHERE mr.organization_id = $1::uuid
                 AND mr.meter_id = m.id
                 AND mr.reading_date = $3::date
             )
           )::int AS final_reading_count
         FROM lease_info li
         LEFT JOIN meters m
           ON m.organization_id = $1::uuid
          AND m.room_id = li.room_id
          AND m.is_active = true
       ),
       financial_state AS (
         SELECT
           count(i.id)::int AS invoice_count,
           count(i.id) FILTER (WHERE i.status = 'DRAFT')::int AS draft_count,
           coalesce(sum(i.remaining_vnd) FILTER (WHERE i.status = 'ISSUED'), 0)::bigint AS remaining_debt_vnd
         FROM renter_invoices i
         WHERE i.organization_id = $1::uuid
           AND i.lease_id = $2::uuid
           AND i.status IN ('DRAFT', 'ISSUED')
       ),
       deposit_state AS (
         SELECT
           li.deposit_required_vnd,
           coalesce(sum(de.amount_vnd) FILTER (WHERE de.entry_type = 'COLLECTION'), 0)::bigint AS collected_vnd,
           coalesce(sum(de.amount_vnd) FILTER (WHERE de.entry_type = 'REFUND'), 0)::bigint AS refunded_vnd,
           coalesce(sum(de.amount_vnd) FILTER (WHERE de.entry_type = 'DEDUCTION'), 0)::bigint AS deducted_vnd
         FROM lease_info li
         LEFT JOIN lease_deposit_entries de
           ON de.organization_id = $1::uuid
          AND de.lease_id = $2::uuid
         GROUP BY li.deposit_required_vnd
       )
       INSERT INTO lease_terminations (
         organization_id,
         lease_id,
         status,
         effective_date,
         reason,
         meter_readiness,
         financial_readiness,
         deposit_readiness,
         initiated_by_user_id
       )
       SELECT
         $1,
         $2,
         CASE
           WHEN (
             (CASE WHEN ms.active_meter_count = 0 THEN 'NOT_REQUIRED' WHEN ms.final_reading_count = ms.active_meter_count THEN 'READY' ELSE 'PENDING' END) <> 'PENDING'
             AND (CASE WHEN fs.invoice_count = 0 THEN 'NOT_REQUIRED' WHEN fs.draft_count > 0 THEN 'PENDING' WHEN fs.remaining_debt_vnd > 0 THEN 'PENDING' ELSE 'READY' END) <> 'PENDING'
             AND (CASE WHEN ds.deposit_required_vnd = 0 AND ds.collected_vnd = 0 THEN 'NOT_REQUIRED' WHEN (ds.collected_vnd - ds.refunded_vnd - ds.deducted_vnd) = 0 AND ds.collected_vnd > 0 THEN 'READY' ELSE 'PENDING' END) <> 'PENDING'
           ) THEN 'READY'
           ELSE 'SCHEDULED'
         END,
         $3,
         $4,
         CASE
           WHEN ms.active_meter_count = 0 THEN 'NOT_REQUIRED'
           WHEN ms.final_reading_count = ms.active_meter_count THEN 'READY'
           ELSE 'PENDING'
         END,
         CASE
           WHEN fs.invoice_count = 0 THEN 'NOT_REQUIRED'
           WHEN fs.draft_count > 0 THEN 'PENDING'
           WHEN fs.remaining_debt_vnd > 0 THEN 'PENDING'
           ELSE 'READY'
         END,
         CASE
           WHEN ds.deposit_required_vnd = 0 AND ds.collected_vnd = 0 THEN 'NOT_REQUIRED'
           WHEN (ds.collected_vnd - ds.refunded_vnd - ds.deducted_vnd) = 0 AND ds.collected_vnd > 0 THEN 'READY'
           ELSE 'PENDING'
         END,
         $5
       FROM meter_state ms, financial_state fs, deposit_state ds`,
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
      `WITH target AS (
         SELECT id, lease_id
         FROM lease_terminations
         WHERE organization_id = $1::uuid
           AND lease_id = $2::uuid
           AND status IN ('SCHEDULED', 'READY')
         FOR UPDATE
       ),
       financial_calc AS (
         SELECT
           CASE
             WHEN count(i.id) = 0 THEN 'NOT_REQUIRED'
             WHEN count(i.id) FILTER (WHERE i.status = 'DRAFT') > 0 THEN 'PENDING'
             WHEN coalesce(sum(i.remaining_vnd) FILTER (WHERE i.status = 'ISSUED'), 0) > 0 THEN 'PENDING'
             ELSE 'READY'
           END AS current_financial_readiness
         FROM target t
         LEFT JOIN renter_invoices i
           ON i.organization_id = $1::uuid
          AND i.lease_id = t.lease_id
          AND i.status IN ('DRAFT', 'ISSUED')
       ),
       synced AS (
         UPDATE lease_terminations t
         SET financial_readiness = fc.current_financial_readiness,
             status = CASE
               WHEN t.meter_readiness <> 'PENDING'
                AND fc.current_financial_readiness <> 'PENDING'
                AND t.deposit_readiness <> 'PENDING'
               THEN 'READY'
               ELSE 'SCHEDULED'
             END,
             updated_at = now()
         FROM target, financial_calc fc
         WHERE t.id = target.id
           AND t.financial_readiness IS DISTINCT FROM fc.current_financial_readiness
         RETURNING t.meter_readiness, t.financial_readiness, t.deposit_readiness
       )
       SELECT meter_readiness, financial_readiness, deposit_readiness
       FROM synced
       UNION ALL
       SELECT t.meter_readiness, t.financial_readiness, t.deposit_readiness
       FROM lease_terminations t
       WHERE t.organization_id = $1::uuid
         AND t.lease_id = $2::uuid
         AND t.status IN ('SCHEDULED', 'READY')
         AND NOT EXISTS (SELECT 1 FROM synced)`,
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
