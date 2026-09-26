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

type MeterTerminationContextRow = QueryResultRow & {
  lease_id: string;
  lease_status: string;
  room_id: string;
  property_id: string;
  termination_id: string | null;
  effective_date: Date | string | null;
  meter_readiness: ReadinessState | null;
  operational_group_ids: string[];
};

type FinalMeterRow = QueryResultRow & {
  meter_id: string;
  meter_type: "ELECTRICITY" | "WATER";
  unit: "KWH" | "M3";
  label: string | null;
  reading_id: string | null;
  reading_value: string | null;
  reading_source: "ADMIN" | "STAFF" | "IMPORT" | null;
};

type FinancialTerminationContextRow = QueryResultRow & {
  lease_id: string;
  lease_status: string;
  room_id: string;
  property_id: string;
  termination_id: string | null;
  effective_date: Date | string | null;
  financial_readiness: ReadinessState | null;
  operational_group_ids: string[];
};

type TerminationInvoiceRow = QueryResultRow & {
  id: string;
  invoice_number: string;
  status: "DRAFT" | "ISSUED" | "VOID";
  collection_status: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  period_start: Date | string;
  period_end: Date | string;
  due_date: Date | string;
  total_vnd: string;
  paid_vnd: string;
  remaining_vnd: string;
};

export interface LeaseTerminationFinancialReadiness {
  leaseId: string;
  terminationId: string | null;
  effectiveDate: string | null;
  state: ReadinessState | null;
  summary: {
    totalInvoicedVnd: number;
    totalPaidVnd: number;
    outstandingDebtVnd: number;
    hasDraftInvoices: boolean;
    invoiceCount: number;
  };
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    status: "DRAFT" | "ISSUED" | "VOID";
    collectionStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    totalVnd: number;
    paidVnd: number;
    remainingVnd: number;
  }>;
}

export async function syncLeaseTerminationFinancialReadiness(
  client: { query: DatabaseService["query"] },
  input: {
    organizationId: string;
    leaseId: string;
    actorUserId?: string | null;
    trigger: string;
  }
): Promise<Array<{ leaseId: string; financialReadiness: ReadinessState }>> {
  const updated = await client.query<QueryResultRow & {
    lease_id: string;
    financial_readiness: ReadinessState;
  }>(
    `WITH target AS (
       SELECT
         t.id,
         t.lease_id,
         t.financial_readiness
       FROM lease_terminations t
       JOIN leases l
         ON l.organization_id = t.organization_id
        AND l.id = t.lease_id
       WHERE t.organization_id = $1::uuid
         AND t.lease_id = $2::uuid
         AND l.status = 'TERMINATION_SCHEDULED'
         AND t.status IN ('SCHEDULED', 'READY')
       FOR UPDATE OF t
     ),
     computed AS (
       SELECT
         target.id,
         target.lease_id,
         target.financial_readiness,
         CASE
           WHEN count(i.id) = 0 THEN 'NOT_REQUIRED'
           WHEN count(i.id) FILTER (WHERE i.status = 'DRAFT') > 0 THEN 'PENDING'
           WHEN coalesce(sum(i.remaining_vnd) FILTER (WHERE i.status = 'ISSUED'), 0) > 0 THEN 'PENDING'
           ELSE 'READY'
         END AS next_readiness
       FROM target
       LEFT JOIN renter_invoices i
         ON i.organization_id = $1::uuid
        AND i.lease_id = target.lease_id
        AND i.status IN ('DRAFT', 'ISSUED')
       GROUP BY
         target.id,
         target.lease_id,
         target.financial_readiness
     ),
     changed AS (
       UPDATE lease_terminations t
       SET financial_readiness = computed.next_readiness,
           status = CASE
             WHEN t.meter_readiness <> 'PENDING'
              AND computed.next_readiness <> 'PENDING'
              AND t.deposit_readiness <> 'PENDING'
             THEN 'READY'
             ELSE 'SCHEDULED'
           END,
           updated_at = now()
       FROM computed
       WHERE t.id = computed.id
         AND t.financial_readiness IS DISTINCT FROM computed.next_readiness
       RETURNING
         t.lease_id::text,
         t.financial_readiness
     )
     SELECT lease_id, financial_readiness
     FROM changed`,
    [input.organizationId, input.leaseId]
  );

  for (const row of updated.rows) {
    await client.query(
      `INSERT INTO audit_events (
         organization_id, actor_user_id, action, resource_type, resource_id, metadata
       )
       VALUES ($1, $2, 'LEASE_TERMINATION_FINANCIAL_READINESS_SYNCED', 'LEASE', $3, $4::jsonb)`,
      [
        input.organizationId,
        input.actorUserId ?? null,
        row.lease_id,
        JSON.stringify({
          leaseId: row.lease_id,
          financialReadiness: row.financial_readiness,
          trigger: input.trigger,
          source: "RENTER_BILLING"
        })
      ]
    );
  }

  return updated.rows.map((r) => ({
    leaseId: r.lease_id,
    financialReadiness: r.financial_readiness
  }));
}

@Injectable()
export class LeaseTerminationReadinessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async meterReadiness(
    principal: TenantPrincipal,
    leaseId: string
  ) {
    const contextResult = await this.db.query<MeterTerminationContextRow>(
      `SELECT
         l.id::text AS lease_id,
         l.status AS lease_status,
         r.id::text AS room_id,
         p.id::text AS property_id,
         t.id::text AS termination_id,
         t.effective_date,
         t.meter_readiness,
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
       GROUP BY
         l.id,
         l.status,
         r.id,
         p.id,
         t.id,
         t.effective_date,
         t.meter_readiness
       LIMIT 1`,
      [principal.organizationId, leaseId]
    );

    const context = contextResult.rows[0];
    if (!context) {
      throw new NotFoundException("Lease was not found.");
    }

    const resource = {
      organizationId: principal.organizationId,
      propertyId: context.property_id,
      operationalGroupIds: context.operational_group_ids
    };
    if (
      !this.accessControl.can(
        principal.membership,
        "lease.read",
        resource
      ) ||
      !this.accessControl.can(
        principal.membership,
        "meter.read",
        resource
      )
    ) {
      throw new ForbiddenException(
        "Lease termination meter permission denied."
      );
    }

    if (
      context.lease_status !== "TERMINATION_SCHEDULED" ||
      !context.termination_id ||
      !context.effective_date ||
      !context.meter_readiness
    ) {
      return {
        leaseId,
        terminationId: null,
        effectiveDate: null,
        state: null,
        meters: []
      };
    }

    const effectiveDate = this.dateOnly(context.effective_date);
    const meters = await this.db.query<FinalMeterRow>(
      `SELECT
         m.id::text AS meter_id,
         m.meter_type,
         m.unit,
         m.label,
         mr.id::text AS reading_id,
         mr.reading_value::text,
         mr.source AS reading_source
       FROM meters m
       LEFT JOIN meter_readings mr
         ON mr.organization_id = m.organization_id
        AND mr.meter_id = m.id
        AND mr.reading_date = $3::date
       WHERE m.organization_id = $1::uuid
         AND m.room_id = $2::uuid
         AND m.is_active = true
       ORDER BY m.meter_type, m.created_at, m.id`,
      [
        principal.organizationId,
        context.room_id,
        effectiveDate
      ]
    );

    return {
      leaseId,
      terminationId: context.termination_id,
      effectiveDate,
      state: context.meter_readiness,
      meters: meters.rows.map((meter) => ({
        id: meter.meter_id,
        meterType: meter.meter_type,
        unit: meter.unit,
        label: meter.label,
        finalReading: meter.reading_id
          ? {
              id: meter.reading_id,
              readingDate: effectiveDate,
              readingValue: this.decimal3(
                meter.reading_value ?? "0"
              ),
              source: meter.reading_source
            }
          : null
      }))
    };
  }

  async financialReadiness(
    principal: TenantPrincipal,
    leaseId: string
  ): Promise<LeaseTerminationFinancialReadiness> {
    const contextResult = await this.db.query<FinancialTerminationContextRow>(
      `SELECT
         l.id::text AS lease_id,
         l.status AS lease_status,
         r.id::text AS room_id,
         p.id::text AS property_id,
         t.id::text AS termination_id,
         t.effective_date,
         t.financial_readiness,
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
       GROUP BY
         l.id,
         l.status,
         r.id,
         p.id,
         t.id,
         t.effective_date,
         t.financial_readiness
       LIMIT 1`,
      [principal.organizationId, leaseId]
    );

    const context = contextResult.rows[0];
    if (!context) {
      throw new NotFoundException("Lease was not found.");
    }

    const resource = {
      organizationId: principal.organizationId,
      propertyId: context.property_id,
      operationalGroupIds: context.operational_group_ids
    };
    if (
      !this.accessControl.can(
        principal.membership,
        "lease.read",
        resource
      ) ||
      !this.accessControl.can(
        principal.membership,
        "billing.read",
        resource
      )
    ) {
      throw new ForbiddenException(
        "Lease termination financial permission denied."
      );
    }

    if (
      context.lease_status !== "TERMINATION_SCHEDULED" ||
      !context.termination_id
    ) {
      return {
        leaseId,
        terminationId: null,
        effectiveDate: null,
        state: null,
        summary: {
          totalInvoicedVnd: 0,
          totalPaidVnd: 0,
          outstandingDebtVnd: 0,
          hasDraftInvoices: false,
          invoiceCount: 0
        },
        invoices: []
      };
    }

    await syncLeaseTerminationFinancialReadiness(this.db, {
      organizationId: principal.organizationId,
      leaseId,
      actorUserId: principal.userId,
      trigger: "READINESS_QUERY"
    });

    const refreshedContext = await this.db.query<QueryResultRow & {
      financial_readiness: ReadinessState;
      effective_date: Date | string | null;
    }>(
      `SELECT financial_readiness, effective_date
       FROM lease_terminations
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
       LIMIT 1`,
      [principal.organizationId, context.termination_id]
    );

    const invoices = await this.db.query<TerminationInvoiceRow>(
      `SELECT
         id::text,
         invoice_number,
         status,
         collection_status,
         period_start,
         period_end,
         due_date,
         total_vnd::text,
         paid_vnd::text,
         remaining_vnd::text
       FROM renter_invoices
       WHERE organization_id = $1::uuid
         AND lease_id = $2::uuid
       ORDER BY period_start DESC, invoice_number DESC, id`,
      [principal.organizationId, leaseId]
    );

    const nonVoidInvoices = invoices.rows.filter((inv) => inv.status !== "VOID");
    const totalInvoicedVnd = nonVoidInvoices.reduce(
      (sum, inv) => sum + Number(inv.total_vnd),
      0
    );
    const totalPaidVnd = nonVoidInvoices.reduce(
      (sum, inv) => sum + Number(inv.paid_vnd),
      0
    );
    const outstandingDebtVnd = nonVoidInvoices
      .filter((inv) => inv.status === "ISSUED")
      .reduce((sum, inv) => sum + Number(inv.remaining_vnd), 0);
    const hasDraftInvoices = nonVoidInvoices.some((inv) => inv.status === "DRAFT");

    const effectiveDate = refreshedContext.rows[0]?.effective_date
      ? this.dateOnly(refreshedContext.rows[0].effective_date)
      : context.effective_date
        ? this.dateOnly(context.effective_date)
        : null;

    return {
      leaseId,
      terminationId: context.termination_id,
      effectiveDate,
      state: refreshedContext.rows[0]?.financial_readiness ?? context.financial_readiness,
      summary: {
        totalInvoicedVnd,
        totalPaidVnd,
        outstandingDebtVnd,
        hasDraftInvoices,
        invoiceCount: nonVoidInvoices.length
      },
      invoices: invoices.rows.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        status: inv.status,
        collectionStatus: inv.collection_status,
        periodStart: this.dateOnly(inv.period_start),
        periodEnd: this.dateOnly(inv.period_end),
        dueDate: this.dateOnly(inv.due_date),
        totalVnd: Number(inv.total_vnd),
        paidVnd: Number(inv.paid_vnd),
        remainingVnd: Number(inv.remaining_vnd)
      }))
    };
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
    if (
      input.kind === "meter" ||
      input.kind === "deposit" ||
      input.kind === "financial"
    ) {
      throw new ConflictException(
        input.kind +
          " readiness is module-owned and cannot be manually overridden."
      );
    }

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

  private dateOnly(value: Date | string): string {
    return value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value.slice(0, 10);
  }

  private decimal3(value: string): string {
    const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim());
    if (!match) {
      throw new ConflictException(
        "Stored meter reading has invalid decimal precision."
      );
    }
    return match[1] + "." + (match[2] ?? "").padEnd(3, "0");
  }
}
