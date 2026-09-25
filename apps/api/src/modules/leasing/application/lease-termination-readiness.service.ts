import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";

export type ReadinessState = "PENDING" | "READY" | "NOT_REQUIRED";
export type ReadinessKind = "meter" | "financial" | "deposit";

type ContextRow = QueryResultRow & {
  lease_id: string;
  room_id: string;
  property_id: string;
  lease_status: string;
  termination_id: string | null;
  termination_effective_date: Date | string | null;
  operational_group_ids: string[];
};

@Injectable()
export class LeaseTerminationReadinessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  private async requireTerminationContext(
    client: PoolClient,
    principal: TenantPrincipal,
    leaseId: string
  ): Promise<ContextRow> {
    const contextResult = await client.query<ContextRow>(
      `SELECT
         l.id::text AS lease_id,
         l.room_id::text AS room_id,
         l.status AS lease_status,
         p.id::text AS property_id,
         t.id::text AS termination_id,
         t.effective_date AS termination_effective_date,
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
       GROUP BY l.id, l.room_id, l.status, p.id, t.id, t.effective_date
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
    return context;
  }

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

      const context = await this.requireTerminationContext(client, principal, leaseId);

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

  async syncReadinessFromSystem(
    principal: TenantPrincipal,
    leaseId: string
  ) {
    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const context = await this.requireTerminationContext(client, principal, leaseId);

      // 1. Check deposit
      const depositResult = await client.query<{
        remaining_held_vnd: string;
        deposit_required_vnd: string;
      }>(
        `SELECT
           ld.remaining_held_vnd::text,
           ld.deposit_required_vnd::text
         FROM lease_deposits ld
         WHERE ld.organization_id = $1::uuid
           AND ld.lease_id = $2::uuid`,
        [principal.organizationId, leaseId]
      );
      const remainingHeld = depositResult.rows[0] ? Number(depositResult.rows[0].remaining_held_vnd) : 0;
      const depositRequired = depositResult.rows[0] ? Number(depositResult.rows[0].deposit_required_vnd) : 0;
      const depositReady: ReadinessState = remainingHeld <= 0 ? (depositRequired === 0 ? "NOT_REQUIRED" : "READY") : "PENDING";

      // 2. Check financial (unpaid issued invoices)
      const financialResult = await client.query<{
        unpaid_count: string;
      }>(
        `SELECT
           COUNT(*)::text AS unpaid_count
         FROM renter_invoices
         WHERE organization_id = $1::uuid
           AND lease_id = $2::uuid
           AND status = 'ISSUED'
           AND collection_status IN ('UNPAID', 'PARTIALLY_PAID')`,
        [principal.organizationId, leaseId]
      );
      const unpaidInvoices = Number(financialResult.rows[0]?.unpaid_count ?? 0);
      const financialReady: ReadinessState = unpaidInvoices === 0 ? "READY" : "PENDING";

      // 3. Check meters
      const metersResult = await client.query<{
        meter_id: string;
        max_reading_date: string | null;
      }>(
        `SELECT
           m.id::text AS meter_id,
           MAX(mr.reading_date)::text AS max_reading_date
         FROM meters m
         LEFT JOIN meter_readings mr
           ON mr.organization_id = m.organization_id
          AND mr.meter_id = m.id
         WHERE m.organization_id = $1::uuid
           AND m.room_id = $2::uuid
           AND m.is_active = true
         GROUP BY m.id`,
        [principal.organizationId, context.room_id]
      );

      let meterReady: ReadinessState = "PENDING";
      if (metersResult.rows.length === 0) {
        meterReady = "NOT_REQUIRED";
      } else {
        const effectiveDateStr = context.termination_effective_date
          ? (typeof context.termination_effective_date === "string"
              ? context.termination_effective_date.slice(0, 10)
              : context.termination_effective_date.toISOString().slice(0, 10))
          : null;
        const allMetersHaveReadings = metersResult.rows.every((m) => {
          if (!m.max_reading_date) return false;
          if (effectiveDateStr) {
            return m.max_reading_date >= effectiveDateStr;
          }
          return true;
        });
        if (allMetersHaveReadings) {
          meterReady = "READY";
        }
      }

      // Update termination readiness: only update fields currently PENDING
      const updated = await client.query<QueryResultRow & {
        meter_readiness: ReadinessState;
        financial_readiness: ReadinessState;
        deposit_readiness: ReadinessState;
        status: string;
      }>(
        `UPDATE lease_terminations
         SET
           meter_readiness = CASE WHEN meter_readiness = 'PENDING' AND $3 <> 'PENDING' THEN $3 ELSE meter_readiness END,
           financial_readiness = CASE WHEN financial_readiness = 'PENDING' AND $4 <> 'PENDING' THEN $4 ELSE financial_readiness END,
           deposit_readiness = CASE WHEN deposit_readiness = 'PENDING' AND $5 <> 'PENDING' THEN $5 ELSE deposit_readiness END,
           status = CASE
             WHEN (
               (CASE WHEN meter_readiness = 'PENDING' AND $3 <> 'PENDING' THEN $3 ELSE meter_readiness END) <> 'PENDING'
               AND (CASE WHEN financial_readiness = 'PENDING' AND $4 <> 'PENDING' THEN $4 ELSE financial_readiness END) <> 'PENDING'
               AND (CASE WHEN deposit_readiness = 'PENDING' AND $5 <> 'PENDING' THEN $5 ELSE deposit_readiness END) <> 'PENDING'
             ) THEN 'READY'
             ELSE status
           END,
           updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
           AND status IN ('SCHEDULED', 'READY')
         RETURNING meter_readiness, financial_readiness, deposit_readiness, status`,
        [
          principal.organizationId,
          context.termination_id,
          meterReady,
          financialReady,
          depositReady
        ]
      );

      if (updated.rowCount !== 1) {
        throw new ConflictException("Termination workflow changed concurrently.");
      }

      await client.query(
        `INSERT INTO audit_events (
           organization_id, actor_user_id, action, resource_type, resource_id, metadata
         )
         VALUES ($1, $2, 'LEASE_TERMINATION_READINESS_SYNCED', 'LEASE', $3, $4::jsonb)`,
        [
          principal.organizationId,
          principal.userId,
          leaseId,
          JSON.stringify({
            meterReady,
            financialReady,
            depositReady,
            source: "SYSTEM_SYNC"
          })
        ]
      );

      const row = updated.rows[0]!;
      return {
        meter: row.meter_readiness,
        financial: row.financial_readiness,
        deposit: row.deposit_readiness,
        status: row.status
      };
    });
  }

  async recordFinalMeterReading(
    principal: TenantPrincipal,
    leaseId: string,
    input: {
      meterId: string;
      readingDate: string;
      readingValue: string | number;
    }
  ) {
    const readingDate = input.readingDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(readingDate)) {
      throw new ConflictException("readingDate must be in YYYY-MM-DD format.");
    }
    const val = Number(input.readingValue);
    if (isNaN(val) || val < 0) {
      throw new ConflictException("readingValue must be a non-negative number.");
    }
    const readingValueStr = val.toFixed(3);

    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const context = await this.requireTerminationContext(client, principal, leaseId);

      // Verify meter belongs to room
      const meterCheck = await client.query<{ id: string; meter_type: string; unit: string }>(
        `SELECT id::text, meter_type, unit
         FROM meters
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
           AND room_id = $3::uuid
           AND is_active = true`,
        [principal.organizationId, input.meterId, context.room_id]
      );
      if (!meterCheck.rows[0]) {
        throw new NotFoundException("Meter was not found for this room.");
      }

      // Upsert meter reading
      const readingId = crypto.randomUUID();
      await client.query(
        `INSERT INTO meter_readings (
           id, organization_id, meter_id, reading_date, reading_value, source, created_by_user_id
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::numeric(18, 3), 'ADMIN', $6::uuid)
         ON CONFLICT (organization_id, meter_id, reading_date)
         DO UPDATE SET
           reading_value = EXCLUDED.reading_value,
           source = EXCLUDED.source,
           created_by_user_id = EXCLUDED.created_by_user_id`,
        [
          readingId,
          principal.organizationId,
          input.meterId,
          readingDate,
          readingValueStr,
          principal.userId
        ]
      );

      await client.query(
        `INSERT INTO audit_events (
           organization_id, actor_user_id, action, resource_type, resource_id, metadata
         )
         VALUES ($1, $2, 'METER_READING_RECORDED', 'METER', $3, $4::jsonb)`,
        [
          principal.organizationId,
          principal.userId,
          input.meterId,
          JSON.stringify({
            leaseId,
            readingDate,
            readingValue: readingValueStr,
            source: "TERMINATION_FINAL_READING"
          })
        ]
      );

      // Check if all active meters for this room now have readings >= termination effective_date
      const effectiveDateStr = context.termination_effective_date
        ? (typeof context.termination_effective_date === "string"
            ? context.termination_effective_date.slice(0, 10)
            : context.termination_effective_date.toISOString().slice(0, 10))
        : readingDate;

      const remainingMetersWithoutReading = await client.query<{ id: string }>(
        `SELECT m.id::text
         FROM meters m
         WHERE m.organization_id = $1::uuid
           AND m.room_id = $2::uuid
           AND m.is_active = true
           AND NOT EXISTS (
             SELECT 1 FROM meter_readings mr
             WHERE mr.organization_id = m.organization_id
               AND mr.meter_id = m.id
               AND mr.reading_date >= $3::date
           )`,
        [principal.organizationId, context.room_id, effectiveDateStr]
      );

      let meterReadiness: ReadinessState = "PENDING";
      if (remainingMetersWithoutReading.rows.length === 0) {
        meterReadiness = "READY";
      }

      // Update lease termination
      const updated = await client.query<QueryResultRow & {
        meter_readiness: ReadinessState;
        financial_readiness: ReadinessState;
        deposit_readiness: ReadinessState;
        status: string;
      }>(
        `UPDATE lease_terminations
         SET
           meter_readiness = CASE WHEN $3 = 'READY' THEN 'READY' ELSE meter_readiness END,
           status = CASE
             WHEN (
               (CASE WHEN $3 = 'READY' THEN 'READY' ELSE meter_readiness END) <> 'PENDING'
               AND financial_readiness <> 'PENDING'
               AND deposit_readiness <> 'PENDING'
             ) THEN 'READY'
             ELSE status
           END,
           updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
           AND status IN ('SCHEDULED', 'READY')
         RETURNING meter_readiness, financial_readiness, deposit_readiness, status`,
        [principal.organizationId, context.termination_id, meterReadiness]
      );

      const row = updated.rows[0]!;
      return {
        meter: row.meter_readiness,
        financial: row.financial_readiness,
        deposit: row.deposit_readiness,
        status: row.status,
        reading: {
          meterId: input.meterId,
          readingDate,
          readingValue: readingValueStr
        }
      };
    });
  }
}
