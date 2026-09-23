import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { CommercialPolicyService } from "../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import { roleHasPermission } from "../identity/domain/access-control.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";
import { MeteringService } from "../metering/metering.service.js";
import {
  PricingService,
  type ResolvedPricingItem,
  type ResolvedPricingPolicy
} from "../pricing/pricing.service.js";
import {
  normalizeQuantity3,
  quantityTimesUnitPriceVnd
} from "./domain/quantity-money.js";

type CycleRow = QueryResultRow & {
  id: string;
  property_id: string;
  property_code: string;
  property_name: string;
  cycle_code: string;
  period_start: Date | string;
  period_end: Date | string;
  due_date: Date | string;
  status: "OPEN" | "FINALIZED" | "CANCELLED";
  finalized_at: Date | string | null;
  operational_group_ids: string[];
  invoice_count: number;
  draft_count: number;
  issued_count: number;
  total_vnd: string;
};

type InvoiceRow = QueryResultRow & {
  id: string;
  invoice_number: string;
  status: "DRAFT" | "ISSUED" | "VOID";
  room_id: string;
  room_code_snapshot: string;
  lease_id: string;
  lease_code_snapshot: string;
  primary_resident_name_snapshot: string;
  subtotal_vnd: string;
  adjustment_vnd: string;
  previous_balance_vnd: string;
  total_vnd: string;
  calculation_status: "READY" | "REVIEW_REQUIRED";
  review_reasons: unknown;
  calculated_at: Date | string | null;
  issued_at: Date | string | null;
};

type LineRow = QueryResultRow & {
  invoice_id: string;
  id: string;
  line_type: string;
  description: string;
  quantity: string;
  unit_price_vnd: string;
  amount_vnd: string;
  sort_order: number;
  snapshot: unknown;
};

type PropertyContext = {
  propertyId: string;
  propertyCode: string;
  propertyName: string;
  operationalGroupIds: string[];
};

type CycleContext = {
  id: string;
  propertyId: string;
  propertyCode: string;
  propertyName: string;
  code: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: "OPEN" | "FINALIZED" | "CANCELLED";
  operationalGroupIds: string[];
};

type LeaseCandidateRow = QueryResultRow & {
  id: string;
  lease_code: string;
  start_date: Date | string;
  termination_effective_date: Date | string | null;
  base_rent_vnd: string;
  room_id: string;
  room_code: string;
  primary_resident_name: string | null;
};

export interface CreateRenterBillingCycleInput {
  id: string;
  propertyId: string;
  code: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
}

@Injectable()
export class RenterBillingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService,
    private readonly pricing: PricingService,
    private readonly metering: MeteringService
  ) {}

  async list(principal: TenantPrincipal) {
    if (!roleHasPermission(principal.role, "billing.read")) {
      throw new ForbiddenException("Billing read permission denied.");
    }

    const result = await this.db.query<CycleRow>(
      `SELECT
         c.id::text,
         c.property_id::text,
         p.code AS property_code,
         p.name AS property_name,
         c.cycle_code,
         c.period_start,
         c.period_end,
         c.due_date,
         c.status,
         c.finalized_at,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids,
         COALESCE(invoice_stats.invoice_count, 0)::int AS invoice_count,
         COALESCE(invoice_stats.draft_count, 0)::int AS draft_count,
         COALESCE(invoice_stats.issued_count, 0)::int AS issued_count,
         COALESCE(invoice_stats.total_vnd, 0)::text AS total_vnd
       FROM renter_billing_cycles c
       JOIN properties p
         ON p.organization_id = c.organization_id
        AND p.id = c.property_id
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = c.organization_id
        AND pog.property_id = c.property_id
       LEFT JOIN LATERAL (
         SELECT
           count(*)::int AS invoice_count,
           count(*) FILTER (WHERE i.status = 'DRAFT')::int AS draft_count,
           count(*) FILTER (WHERE i.status = 'ISSUED')::int AS issued_count,
           COALESCE(sum(i.total_vnd), 0) AS total_vnd
         FROM renter_invoices i
         WHERE i.organization_id = c.organization_id
           AND i.billing_cycle_id = c.id
           AND i.status <> 'VOID'
       ) invoice_stats ON true
       WHERE c.organization_id = $1::uuid
       GROUP BY c.id, p.code, p.name,
         invoice_stats.invoice_count,
         invoice_stats.draft_count,
         invoice_stats.issued_count,
         invoice_stats.total_vnd
       ORDER BY c.period_start DESC, c.id DESC`,
      [principal.organizationId]
    );

    return {
      organization: {
        id: principal.organizationId,
        name: principal.organizationName
      },
      cycles: result.rows
        .filter((row) =>
          this.accessControl.can(principal.membership, "billing.read", {
            organizationId: principal.organizationId,
            propertyId: row.property_id,
            operationalGroupIds: row.operational_group_ids
          })
        )
        .map((row) => this.mapCycle(row))
    };
  }

  async detail(principal: TenantPrincipal, cycleId: string) {
    const cycle = await this.loadCycle(principal, cycleId, "billing.read");

    const [invoiceResult, lineResult] = await Promise.all([
      this.db.query<InvoiceRow>(
        `SELECT
           id::text,
           invoice_number,
           status,
           room_id::text,
           room_code_snapshot,
           lease_id::text,
           lease_code_snapshot,
           primary_resident_name_snapshot,
           subtotal_vnd::text,
           adjustment_vnd::text,
           previous_balance_vnd::text,
           total_vnd::text,
           calculation_status,
           review_reasons,
           calculated_at,
           issued_at
         FROM renter_invoices
         WHERE organization_id = $1::uuid
           AND billing_cycle_id = $2::uuid
         ORDER BY room_code_snapshot, invoice_number, id`,
        [principal.organizationId, cycleId]
      ),
      this.db.query<LineRow>(
        `SELECT
           invoice_id::text,
           id::text,
           line_type,
           description,
           quantity::text,
           unit_price_vnd::text,
           amount_vnd::text,
           sort_order,
           snapshot
         FROM renter_invoice_lines
         WHERE organization_id = $1::uuid
           AND invoice_id IN (
             SELECT id
             FROM renter_invoices
             WHERE organization_id = $1::uuid
               AND billing_cycle_id = $2::uuid
           )
         ORDER BY invoice_id, sort_order, id`,
        [principal.organizationId, cycleId]
      )
    ]);

    const lines = new Map<string, Array<Record<string, unknown>>>();
    for (const row of lineResult.rows) {
      const bucket = lines.get(row.invoice_id) ?? [];
      bucket.push({
        id: row.id,
        type: row.line_type,
        description: row.description,
        quantity: row.quantity,
        unitPriceVnd: Number(row.unit_price_vnd),
        amountVnd: Number(row.amount_vnd),
        sortOrder: row.sort_order,
        snapshot: row.snapshot
      });
      lines.set(row.invoice_id, bucket);
    }

    return {
      organization: {
        id: principal.organizationId,
        name: principal.organizationName
      },
      cycle,
      invoices: invoiceResult.rows.map((row) => ({
        id: row.id,
        number: row.invoice_number,
        status: row.status,
        room: { id: row.room_id, code: row.room_code_snapshot },
        lease: { id: row.lease_id, code: row.lease_code_snapshot },
        primaryResidentName: row.primary_resident_name_snapshot,
        subtotalVnd: Number(row.subtotal_vnd),
        adjustmentVnd: Number(row.adjustment_vnd),
        previousBalanceVnd: Number(row.previous_balance_vnd),
        totalVnd: Number(row.total_vnd),
        calculationStatus: row.calculation_status,
        reviewReasons: Array.isArray(row.review_reasons) ? row.review_reasons : [],
        calculatedAt: row.calculated_at
          ? this.isoTimestamp(row.calculated_at)
          : null,
        issuedAt: row.issued_at ? this.isoTimestamp(row.issued_at) : null,
        lines: lines.get(row.id) ?? []
      }))
    };
  }

  async createCycle(
    principal: TenantPrincipal,
    input: CreateRenterBillingCycleInput
  ) {
    const code = this.required(input.code, "code");
    const periodStart = this.isoDate(input.periodStart, "periodStart");
    const periodEnd = this.isoDate(input.periodEnd, "periodEnd");
    const dueDate = this.isoDate(input.dueDate, "dueDate");
    if (periodEnd < periodStart) {
      throw new ConflictException("periodEnd cannot be earlier than periodStart.");
    }
    if (dueDate < periodStart) {
      throw new ConflictException("dueDate cannot be earlier than periodStart.");
    }

    return this.db.withTransaction(async (client) => {
      const property = await this.requireProperty(
        client,
        principal,
        input.propertyId,
        "billing.manage"
      );
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const existing = await client.query<QueryResultRow & {
        property_id: string;
        cycle_code: string;
        period_start: Date | string;
        period_end: Date | string;
        due_date: Date | string;
        status: string;
      }>(
        `SELECT
           property_id::text,
           cycle_code,
           period_start,
           period_end,
           due_date,
           status
         FROM renter_billing_cycles
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
         LIMIT 1`,
        [principal.organizationId, input.id]
      );

      const row = existing.rows[0];
      if (row) {
        if (
          row.property_id !== input.propertyId ||
          row.cycle_code !== code ||
          this.dateOnly(row.period_start) !== periodStart ||
          this.dateOnly(row.period_end) !== periodEnd ||
          this.dateOnly(row.due_date) !== dueDate
        ) {
          throw new ConflictException(
            "Billing cycle id was already used with different data."
          );
        }
        return {
          id: input.id,
          property: {
            id: property.propertyId,
            code: property.propertyCode,
            name: property.propertyName
          },
          code,
          periodStart,
          periodEnd,
          dueDate,
          status: row.status
        };
      }

      const conflict = await client.query(
        `SELECT id
         FROM renter_billing_cycles
         WHERE organization_id = $1::uuid
           AND (
             cycle_code = $2
             OR (
               property_id = $3::uuid
               AND period_start = $4::date
               AND period_end = $5::date
             )
           )
         LIMIT 1`,
        [
          principal.organizationId,
          code,
          input.propertyId,
          periodStart,
          periodEnd
        ]
      );
      if ((conflict.rowCount ?? 0) > 0) {
        throw new ConflictException(
          "Billing cycle code or property period already exists."
        );
      }

      await client.query(
        `INSERT INTO renter_billing_cycles (
           id,
           organization_id,
           property_id,
           cycle_code,
           period_start,
           period_end,
           due_date,
           created_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          input.id,
          principal.organizationId,
          input.propertyId,
          code,
          periodStart,
          periodEnd,
          dueDate,
          principal.userId
        ]
      );

      await this.audit(
        client,
        principal,
        "RENTER_BILLING_CYCLE_CREATED",
        "RENTER_BILLING_CYCLE",
        input.id,
        {
          propertyId: input.propertyId,
          code,
          periodStart,
          periodEnd,
          dueDate
        }
      );

      return {
        id: input.id,
        property: {
          id: property.propertyId,
          code: property.propertyCode,
          name: property.propertyName
        },
        code,
        periodStart,
        periodEnd,
        dueDate,
        status: "OPEN" as const
      };
    });
  }

  async generateRentDrafts(principal: TenantPrincipal, cycleId: string) {
    return this.db.withTransaction(async (client) => {
      const cycle = await this.requireCycleForUpdate(
        client,
        principal,
        cycleId,
        "billing.manage"
      );
      if (cycle.status !== "OPEN") {
        throw new ConflictException(
          "Renter invoice drafts can only be generated for an OPEN billing cycle."
        );
      }
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const pricingPolicy = await this.pricing.resolvePolicy(
        client,
        principal.organizationId,
        cycle.propertyId,
        cycle.periodStart,
        cycle.periodEnd
      );
      const candidates = await this.findLeaseCandidates(
        client,
        principal.organizationId,
        cycle
      );
      const fullPeriod = candidates.filter(
        (lease) =>
          this.dateOnly(lease.start_date) <= cycle.periodStart &&
          (lease.termination_effective_date === null ||
            this.dateOnly(lease.termination_effective_date) >= cycle.periodEnd)
      );
      const partialLeaseCount = candidates.length - fullPeriod.length;

      let created = 0;
      let refreshed = 0;
      let reviewRequiredInvoiceCount = 0;

      for (const lease of fullPeriod) {
        const existing = await client.query<
          QueryResultRow & { id: string; status: "DRAFT" | "ISSUED" | "VOID" }
        >(
          `SELECT id::text, status
           FROM renter_invoices
           WHERE organization_id = $1::uuid
             AND billing_cycle_id = $2::uuid
             AND lease_id = $3::uuid
           LIMIT 1`,
          [principal.organizationId, cycle.id, lease.id]
        );

        let invoiceId: string;
        const existingInvoice = existing.rows[0];
        if (existingInvoice) {
          if (existingInvoice.status !== "DRAFT") {
            throw new ConflictException(
              "Issued or void renter invoices cannot be regenerated."
            );
          }
          invoiceId = existingInvoice.id;
          refreshed += 1;
        } else {
          const invoiceNumber =
            cycle.code +
            "-" +
            lease.room_code +
            "-" +
            lease.id.slice(0, 8).toUpperCase();

          const inserted = await client.query<QueryResultRow & { id: string }>(
            `INSERT INTO renter_invoices (
               organization_id,
               billing_cycle_id,
               property_id,
               room_id,
               lease_id,
               invoice_number,
               status,
               period_start,
               period_end,
               due_date,
               property_name_snapshot,
               room_code_snapshot,
               lease_code_snapshot,
               primary_resident_name_snapshot,
               subtotal_vnd,
               adjustment_vnd,
               previous_balance_vnd,
               total_vnd,
               calculation_status,
               review_reasons
             )
             VALUES (
               $1, $2, $3, $4, $5, $6, 'DRAFT',
               $7, $8, $9, $10, $11, $12, $13,
               0, 0, 0, 0, 'REVIEW_REQUIRED', '[]'::jsonb
             )
             RETURNING id::text`,
            [
              principal.organizationId,
              cycle.id,
              cycle.propertyId,
              lease.room_id,
              lease.id,
              invoiceNumber,
              cycle.periodStart,
              cycle.periodEnd,
              cycle.dueDate,
              cycle.propertyName,
              lease.room_code,
              lease.lease_code,
              lease.primary_resident_name ?? "Chưa cập nhật"
            ]
          );
          invoiceId = inserted.rows[0]!.id;
          created += 1;
        }

        await client.query(
          `DELETE FROM renter_invoice_lines
           WHERE organization_id = $1::uuid
             AND invoice_id = $2::uuid
             AND line_type IN ('RENT', 'ELECTRICITY', 'WATER', 'SERVICE')`,
          [principal.organizationId, invoiceId]
        );

        await client.query(
          `INSERT INTO renter_invoice_lines (
             organization_id,
             invoice_id,
             line_type,
             description,
             quantity,
             unit_price_vnd,
             amount_vnd,
             sort_order,
             snapshot
           )
           VALUES (
             $1, $2, 'RENT', 'Tiền phòng kỳ thuê', 1, $3, $3, 10, $4::jsonb
           )`,
          [
            principal.organizationId,
            invoiceId,
            Number(lease.base_rent_vnd),
            JSON.stringify({
              leaseId: lease.id,
              leaseCode: lease.lease_code,
              pricingPolicy: "FULL_PERIOD_BASE_RENT_V1",
              baseRentVnd: Number(lease.base_rent_vnd)
            })
          ]
        );

        const reviewReasons: Array<Record<string, unknown>> = [];
        if (!pricingPolicy) {
          reviewReasons.push({
            code: "MISSING_PRICING_POLICY",
            propertyId: cycle.propertyId,
            periodStart: cycle.periodStart,
            periodEnd: cycle.periodEnd
          });
        } else {
          for (const item of pricingPolicy.items) {
            const reason = await this.appendPricingItem(
              client,
              principal.organizationId,
              invoiceId,
              lease,
              cycle,
              pricingPolicy,
              item
            );
            if (reason) reviewReasons.push(reason);
          }
        }

        const subtotal = await client.query<
          QueryResultRow & { subtotal_vnd: string }
        >(
          `SELECT COALESCE(sum(amount_vnd), 0)::text AS subtotal_vnd
           FROM renter_invoice_lines
           WHERE organization_id = $1::uuid
             AND invoice_id = $2::uuid
             AND line_type IN ('RENT', 'ELECTRICITY', 'WATER', 'SERVICE')`,
          [principal.organizationId, invoiceId]
        );
        const subtotalVnd = subtotal.rows[0]?.subtotal_vnd ?? "0";
        const calculationStatus =
          reviewReasons.length === 0 ? "READY" : "REVIEW_REQUIRED";
        if (calculationStatus === "REVIEW_REQUIRED") {
          reviewRequiredInvoiceCount += 1;
        }

        await client.query(
          `UPDATE renter_invoices
           SET subtotal_vnd = $3::bigint,
               total_vnd = $3::bigint + adjustment_vnd + previous_balance_vnd,
               calculation_status = $4,
               review_reasons = $5::jsonb,
               calculated_at = now(),
               updated_at = now()
           WHERE organization_id = $1::uuid
             AND id = $2::uuid
             AND status = 'DRAFT'`,
          [
            principal.organizationId,
            invoiceId,
            subtotalVnd,
            calculationStatus,
            JSON.stringify(reviewReasons)
          ]
        );
      }

      await this.audit(
        client,
        principal,
        "RENTER_RENT_DRAFTS_GENERATED",
        "RENTER_BILLING_CYCLE",
        cycle.id,
        {
          created,
          refreshed,
          fullPeriodLeaseCount: fullPeriod.length,
          partialLeaseCount,
          reviewRequiredInvoiceCount,
          rentPricingPolicy: "FULL_PERIOD_BASE_RENT_V1",
          utilityPricingPolicyId: pricingPolicy?.id ?? null
        }
      );

      return {
        cycleId: cycle.id,
        created,
        refreshed,
        eligibleLeaseCount: fullPeriod.length,
        partialLeaseCount,
        reviewRequiredInvoiceCount,
        requiresReview:
          partialLeaseCount > 0 || reviewRequiredInvoiceCount > 0
      };
    });
  }

  private async appendPricingItem(
    client: PoolClient,
    organizationId: string,
    invoiceId: string,
    lease: LeaseCandidateRow,
    cycle: CycleContext,
    policy: ResolvedPricingPolicy,
    item: ResolvedPricingItem
  ): Promise<Record<string, unknown> | null> {
    const meterType =
      item.itemType === "ELECTRICITY_PER_KWH"
        ? "ELECTRICITY"
        : item.itemType === "WATER_PER_M3"
          ? "WATER"
          : null;

    if (meterType) {
      const usage = await this.metering.resolveUsage(
        client,
        organizationId,
        lease.room_id,
        meterType,
        cycle.periodStart,
        cycle.periodEnd
      );
      if (usage.status !== "READY") {
        return {
          code: usage.status,
          pricingItemId: item.id,
          itemType: item.itemType,
          meterType,
          meterId: usage.meterId ?? null
        };
      }

      const amountVnd = quantityTimesUnitPriceVnd(
        usage.quantity,
        item.unitPriceVnd
      );
      await client.query(
        `INSERT INTO renter_invoice_lines (
           organization_id,
           invoice_id,
           line_type,
           description,
           quantity,
           unit_price_vnd,
           amount_vnd,
           sort_order,
           snapshot
         )
         VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8, $9::jsonb)`,
        [
          organizationId,
          invoiceId,
          meterType === "ELECTRICITY" ? "ELECTRICITY" : "WATER",
          item.description,
          usage.quantity,
          item.unitPriceVnd,
          amountVnd,
          item.sortOrder,
          JSON.stringify({
            pricingPolicyId: policy.id,
            pricingPolicyName: policy.name,
            pricingItemId: item.id,
            itemType: item.itemType,
            effectiveFrom: policy.effectiveFrom,
            effectiveTo: policy.effectiveTo,
            quantitySource: "METER_DELTA",
            meter: {
              id: usage.meterId,
              type: usage.meterType,
              unit: usage.unit,
              previous: usage.previous,
              current: usage.current
            }
          })
        ]
      );
      return null;
    }

    const quantity = normalizeQuantity3(item.fixedQuantity, "fixedQuantity");
    const amountVnd = quantityTimesUnitPriceVnd(
      quantity,
      item.unitPriceVnd
    );
    await client.query(
      `INSERT INTO renter_invoice_lines (
         organization_id,
         invoice_id,
         line_type,
         description,
         quantity,
         unit_price_vnd,
         amount_vnd,
         sort_order,
         snapshot
       )
       VALUES ($1, $2, 'SERVICE', $3, $4::numeric, $5, $6, $7, $8::jsonb)`,
      [
        organizationId,
        invoiceId,
        item.description,
        quantity,
        item.unitPriceVnd,
        amountVnd,
        item.sortOrder,
        JSON.stringify({
          pricingPolicyId: policy.id,
          pricingPolicyName: policy.name,
          pricingItemId: item.id,
          itemType: item.itemType,
          effectiveFrom: policy.effectiveFrom,
          effectiveTo: policy.effectiveTo,
          quantitySource: "FIXED"
        })
      ]
    );
    return null;
  }

  async finalizeCycle(principal: TenantPrincipal, cycleId: string) {
    return this.db.withTransaction(async (client) => {
      const cycle = await this.requireCycleForUpdate(
        client,
        principal,
        cycleId,
        "billing.manage"
      );

      if (cycle.status === "FINALIZED") {
        return this.finalizedSummary(client, principal.organizationId, cycle.id);
      }
      if (cycle.status !== "OPEN") {
        throw new ConflictException("Billing cycle is not open.");
      }

      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const candidates = await this.findLeaseCandidates(
        client,
        principal.organizationId,
        cycle
      );
      const partialLeaseCount = candidates.filter(
        (lease) =>
          this.dateOnly(lease.start_date) > cycle.periodStart ||
          (lease.termination_effective_date !== null &&
            this.dateOnly(lease.termination_effective_date) < cycle.periodEnd)
      ).length;
      if (partialLeaseCount > 0) {
        throw new ConflictException(
          "Billing cycle has partial-period leases requiring proration or manual adjustment."
        );
      }

      const reviewRequired = await client.query<
        QueryResultRow & { count: number }
      >(
        `SELECT count(*)::int AS count
         FROM renter_invoices
         WHERE organization_id = $1::uuid
           AND billing_cycle_id = $2::uuid
           AND status = 'DRAFT'
           AND calculation_status <> 'READY'`,
        [principal.organizationId, cycle.id]
      );
      if ((reviewRequired.rows[0]?.count ?? 0) > 0) {
        throw new ConflictException(
          "Billing cycle has invoices requiring pricing or meter review."
        );
      }

      const invoiceCountResult = await client.query<QueryResultRow & { count: number }>(
        `SELECT count(*)::int AS count
         FROM renter_invoices
         WHERE organization_id = $1::uuid
           AND billing_cycle_id = $2::uuid
           AND status = 'DRAFT'`,
        [principal.organizationId, cycle.id]
      );
      const invoiceCount = invoiceCountResult.rows[0]?.count ?? 0;
      if (invoiceCount === 0) {
        throw new ConflictException(
          "Generate renter invoice drafts before finalizing the billing cycle."
        );
      }

      await client.query(
        `UPDATE renter_invoices
         SET status = 'ISSUED',
             issued_at = now(),
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND billing_cycle_id = $2::uuid
           AND status = 'DRAFT'`,
        [principal.organizationId, cycle.id]
      );

      await client.query(
        `UPDATE renter_billing_cycles
         SET status = 'FINALIZED',
             finalized_by_user_id = $3,
             finalized_at = now(),
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
           AND status = 'OPEN'`,
        [principal.organizationId, cycle.id, principal.userId]
      );

      const summary = await this.finalizedSummary(
        client,
        principal.organizationId,
        cycle.id
      );

      await this.audit(
        client,
        principal,
        "RENTER_BILLING_CYCLE_FINALIZED",
        "RENTER_BILLING_CYCLE",
        cycle.id,
        summary
      );

      return summary;
    });
  }

  private async loadCycle(
    principal: TenantPrincipal,
    cycleId: string,
    permission: "billing.read" | "billing.manage"
  ) {
    const result = await this.db.query<CycleRow>(
      `SELECT
         c.id::text,
         c.property_id::text,
         p.code AS property_code,
         p.name AS property_name,
         c.cycle_code,
         c.period_start,
         c.period_end,
         c.due_date,
         c.status,
         c.finalized_at,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids,
         COALESCE(invoice_stats.invoice_count, 0)::int AS invoice_count,
         COALESCE(invoice_stats.draft_count, 0)::int AS draft_count,
         COALESCE(invoice_stats.issued_count, 0)::int AS issued_count,
         COALESCE(invoice_stats.total_vnd, 0)::text AS total_vnd
       FROM renter_billing_cycles c
       JOIN properties p
         ON p.organization_id = c.organization_id
        AND p.id = c.property_id
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = c.organization_id
        AND pog.property_id = c.property_id
       LEFT JOIN LATERAL (
         SELECT
           count(*)::int AS invoice_count,
           count(*) FILTER (WHERE i.status = 'DRAFT')::int AS draft_count,
           count(*) FILTER (WHERE i.status = 'ISSUED')::int AS issued_count,
           COALESCE(sum(i.total_vnd), 0) AS total_vnd
         FROM renter_invoices i
         WHERE i.organization_id = c.organization_id
           AND i.billing_cycle_id = c.id
           AND i.status <> 'VOID'
       ) invoice_stats ON true
       WHERE c.organization_id = $1::uuid
         AND c.id = $2::uuid
       GROUP BY c.id, p.code, p.name,
         invoice_stats.invoice_count,
         invoice_stats.draft_count,
         invoice_stats.issued_count,
         invoice_stats.total_vnd
       LIMIT 1`,
      [principal.organizationId, cycleId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Renter billing cycle was not found.");
    if (
      !this.accessControl.can(principal.membership, permission, {
        organizationId: principal.organizationId,
        propertyId: row.property_id,
        operationalGroupIds: row.operational_group_ids
      })
    ) {
      throw new ForbiddenException("Renter billing cycle scope denied.");
    }
    return this.mapCycle(row);
  }

  private async requireProperty(
    client: PoolClient,
    principal: TenantPrincipal,
    propertyId: string,
    permission: "billing.read" | "billing.manage"
  ): Promise<PropertyContext> {
    const result = await client.query<QueryResultRow & {
      id: string;
      code: string;
      name: string;
      operational_group_ids: string[];
    }>(
      `SELECT
         p.id::text,
         p.code,
         p.name,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids
       FROM properties p
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       WHERE p.organization_id = $1::uuid
         AND p.id = $2::uuid
         AND p.is_active = true
       GROUP BY p.id
       LIMIT 1`,
      [principal.organizationId, propertyId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Property was not found.");
    if (
      !this.accessControl.can(principal.membership, permission, {
        organizationId: principal.organizationId,
        propertyId,
        operationalGroupIds: row.operational_group_ids
      })
    ) {
      throw new ForbiddenException("Billing permission denied for this property.");
    }
    return {
      propertyId: row.id,
      propertyCode: row.code,
      propertyName: row.name,
      operationalGroupIds: row.operational_group_ids
    };
  }

  private async requireCycleForUpdate(
    client: PoolClient,
    principal: TenantPrincipal,
    cycleId: string,
    permission: "billing.manage"
  ): Promise<CycleContext> {
    const result = await client.query<QueryResultRow & {
      id: string;
      property_id: string;
      cycle_code: string;
      period_start: Date | string;
      period_end: Date | string;
      due_date: Date | string;
      status: "OPEN" | "FINALIZED" | "CANCELLED";
      property_code: string;
      property_name: string;
    }>(
      `SELECT
         c.id::text,
         c.property_id::text,
         c.cycle_code,
         c.period_start,
         c.period_end,
         c.due_date,
         c.status,
         p.code AS property_code,
         p.name AS property_name
       FROM renter_billing_cycles c
       JOIN properties p
         ON p.organization_id = c.organization_id
        AND p.id = c.property_id
       WHERE c.organization_id = $1::uuid
         AND c.id = $2::uuid
       FOR UPDATE OF c`,
      [principal.organizationId, cycleId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Renter billing cycle was not found.");

    const groups = await client.query<QueryResultRow & { id: string }>(
      `SELECT operational_group_id::text AS id
       FROM property_operational_groups
       WHERE organization_id = $1::uuid
         AND property_id = $2::uuid
       ORDER BY operational_group_id`,
      [principal.organizationId, row.property_id]
    );
    const operationalGroupIds = groups.rows.map((item) => item.id);
    if (
      !this.accessControl.can(principal.membership, permission, {
        organizationId: principal.organizationId,
        propertyId: row.property_id,
        operationalGroupIds
      })
    ) {
      throw new ForbiddenException("Billing permission denied for this property.");
    }

    return {
      id: row.id,
      propertyId: row.property_id,
      propertyCode: row.property_code,
      propertyName: row.property_name,
      code: row.cycle_code,
      periodStart: this.dateOnly(row.period_start),
      periodEnd: this.dateOnly(row.period_end),
      dueDate: this.dateOnly(row.due_date),
      status: row.status,
      operationalGroupIds
    };
  }

  private async findLeaseCandidates(
    client: PoolClient,
    organizationId: string,
    cycle: CycleContext
  ): Promise<LeaseCandidateRow[]> {
    const result = await client.query<LeaseCandidateRow>(
      `SELECT
         l.id::text,
         l.lease_code,
         l.start_date,
         l.termination_effective_date,
         l.base_rent_vnd::text,
         r.id::text AS room_id,
         r.code AS room_code,
         primary_party.full_name AS primary_resident_name
       FROM leases l
       JOIN rooms r
         ON r.organization_id = l.organization_id
        AND r.id = l.room_id
       LEFT JOIN LATERAL (
         SELECT res.full_name
         FROM lease_residents lr
         JOIN residents res
           ON res.organization_id = lr.organization_id
          AND res.id = lr.resident_id
         WHERE lr.organization_id = l.organization_id
           AND lr.lease_id = l.id
           AND lr.party_role = 'PRIMARY_TENANT'
           AND lr.left_on IS NULL
         LIMIT 1
       ) primary_party ON true
       WHERE l.organization_id = $1::uuid
         AND r.property_id = $2::uuid
         AND l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED', 'TERMINATED')
         AND l.start_date <= $4::date
         AND (
           l.termination_effective_date IS NULL
           OR l.termination_effective_date >= $3::date
         )
       ORDER BY r.code, l.start_date, l.id`,
      [
        organizationId,
        cycle.propertyId,
        cycle.periodStart,
        cycle.periodEnd
      ]
    );
    return result.rows;
  }

  private async finalizedSummary(
    client: PoolClient,
    organizationId: string,
    cycleId: string
  ) {
    const result = await client.query<QueryResultRow & {
      invoice_count: number;
      total_vnd: string;
    }>(
      `SELECT
         count(*)::int AS invoice_count,
         COALESCE(sum(total_vnd), 0)::text AS total_vnd
       FROM renter_invoices
       WHERE organization_id = $1::uuid
         AND billing_cycle_id = $2::uuid
         AND status = 'ISSUED'`,
      [organizationId, cycleId]
    );
    return {
      cycleId,
      status: "FINALIZED" as const,
      invoiceCount: result.rows[0]?.invoice_count ?? 0,
      totalVnd: Number(result.rows[0]?.total_vnd ?? 0)
    };
  }

  private mapCycle(row: CycleRow) {
    return {
      id: row.id,
      property: {
        id: row.property_id,
        code: row.property_code,
        name: row.property_name
      },
      code: row.cycle_code,
      periodStart: this.dateOnly(row.period_start),
      periodEnd: this.dateOnly(row.period_end),
      dueDate: this.dateOnly(row.due_date),
      status: row.status,
      finalizedAt: row.finalized_at ? this.isoTimestamp(row.finalized_at) : null,
      invoiceCount: row.invoice_count,
      draftCount: row.draft_count,
      issuedCount: row.issued_count,
      totalVnd: Number(row.total_vnd)
    };
  }

  private async audit(
    client: PoolClient,
    principal: TenantPrincipal,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Readonly<Record<string, unknown>>
  ) {
    await client.query(
      `INSERT INTO audit_events (
         organization_id, actor_user_id, action, resource_type, resource_id, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        principal.organizationId,
        principal.userId,
        action,
        resourceType,
        resourceId,
        JSON.stringify(metadata)
      ]
    );
  }

  private required(value: string, field: string) {
    const normalized = value.trim();
    if (!normalized) throw new ConflictException(field + " is required.");
    return normalized;
  }

  private isoDate(value: string, field: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new ConflictException(field + " must use YYYY-MM-DD.");
    }
    const date = new Date(value + "T00:00:00.000Z");
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new ConflictException(field + " is not a valid calendar date.");
    }
    return value;
  }

  private dateOnly(value: Date | string) {
    return value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value.slice(0, 10);
  }

  private isoTimestamp(value: Date | string) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
