import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";
import type { PlatformPrincipal } from "./cms.types.js";
import {
  platformRoleHasPermission
} from "./domain/platform-access.js";

type InvoiceDetailRow = QueryResultRow & {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  subscription_id: string;
  plan_id: string;
  plan_version_id: string;
  plan_code: string;
  billing_interval: "MONTHLY" | "YEARLY";
  period_start: Date;
  period_end: Date;
  amount_vnd: string;
  payment_reference: string;
  status: "OPEN" | "PARTIALLY_PAID" | "PAID" | "VOID";
  issued_at: Date;
  due_at: Date;
  paid_at: Date | null;
  created_at: Date;
  updated_at: Date;
  paid_amount_vnd: string;
  remaining_amount_vnd: string;
  is_overdue: boolean;
};

type AllocationDetailRow = QueryResultRow & {
  allocation_id: string;
  organization_id: string;
  payment_id: string;
  invoice_id: string;
  allocated_amount_vnd: string;
  allocated_by_user_id: string | null;
  allocated_by_name: string | null;
  reason: string;
  allocation_created_at: Date;
  payment_amount_vnd: string;
  payment_status: "SUCCEEDED" | "FAILED" | "REFUNDED";
  reconciliation_status: "UNALLOCATED" | "ALLOCATED" | "REVIEW_REQUIRED";
  source: "MANUAL" | "PROVIDER";
  provider: string | null;
  provider_transaction_id: string | null;
  occurred_at: Date;
};

type InvoiceAuditRow = QueryResultRow & {
  id: string;
  occurred_at: Date;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_key: string;
  reason: string;
};

@Injectable()
export class CmsBillingDetailService {
  constructor(private readonly db: DatabaseService) {}

  async getInvoiceDetail(
    principal: PlatformPrincipal,
    invoiceId: string
  ) {
    this.requireBillingRead(principal);
    this.requireUuid(invoiceId, "invoiceId");

    const invoiceResult = await this.db.query<InvoiceDetailRow>(
      `SELECT
         i.id::text,
         i.organization_id::text,
         o.name AS organization_name,
         o.slug AS organization_slug,
         i.subscription_id::text,
         i.plan_id::text,
         i.plan_version_id::text,
         p.code AS plan_code,
         i.billing_interval,
         i.period_start,
         i.period_end,
         i.amount_vnd::text,
         i.payment_reference,
         i.status,
         i.issued_at,
         i.due_at,
         i.paid_at,
         i.created_at,
         i.updated_at,
         COALESCE(alloc.paid_amount_vnd, 0)::text AS paid_amount_vnd,
         GREATEST(
           i.amount_vnd - COALESCE(alloc.paid_amount_vnd, 0),
           0
         )::text AS remaining_amount_vnd,
         (
           i.due_at <= now()
           AND i.status IN ('OPEN', 'PARTIALLY_PAID')
         ) AS is_overdue
       FROM saas_subscription_invoices i
       JOIN organizations o ON o.id = i.organization_id
       JOIN saas_plans p ON p.id = i.plan_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(a.amount_vnd), 0)::bigint AS paid_amount_vnd
         FROM saas_subscription_payment_allocations a
         JOIN saas_subscription_payments pay
           ON pay.organization_id = a.organization_id
          AND pay.id = a.payment_id
         WHERE a.organization_id = i.organization_id
           AND a.invoice_id = i.id
           AND pay.status = 'SUCCEEDED'
       ) alloc ON true
       WHERE i.id = $1::uuid
       LIMIT 1`,
      [invoiceId]
    );

    const invoice = invoiceResult.rows[0];
    if (!invoice) {
      throw new NotFoundException("SaaS subscription invoice was not found.");
    }

    const canReadAudit = platformRoleHasPermission(
      principal.role,
      "platform.audit.read"
    );

    const [allocationResult, auditResult] = await Promise.all([
      this.db.query<AllocationDetailRow>(
        `SELECT
           a.id::text AS allocation_id,
           a.organization_id::text,
           a.payment_id::text,
           a.invoice_id::text,
           a.amount_vnd::text AS allocated_amount_vnd,
           a.allocated_by_user_id::text,
           u.display_name AS allocated_by_name,
           a.reason,
           a.created_at AS allocation_created_at,
           pay.amount_vnd::text AS payment_amount_vnd,
           pay.status AS payment_status,
           pay.reconciliation_status,
           pay.source,
           pay.provider,
           pay.provider_transaction_id,
           pay.occurred_at
         FROM saas_subscription_payment_allocations a
         JOIN saas_subscription_payments pay
           ON pay.organization_id = a.organization_id
          AND pay.id = a.payment_id
         LEFT JOIN users u ON u.id = a.allocated_by_user_id
         WHERE a.organization_id = $1::uuid
           AND a.invoice_id = $2::uuid
         ORDER BY a.created_at, a.id`,
        [invoice.organization_id, invoice.id]
      ),
      canReadAudit
        ? this.db.query<InvoiceAuditRow>(
            `SELECT
               e.id::text,
               e.occurred_at,
               u.display_name AS actor_name,
               u.email AS actor_email,
               e.action,
               e.target_type,
               e.target_key,
               e.reason
             FROM platform_audit_events e
             LEFT JOIN users u ON u.id = e.actor_user_id
             WHERE e.organization_id = $1::uuid
               AND (
                 e.target_key = $2
                 OR e.before_state ->> 'invoiceId' = $2
                 OR e.after_state ->> 'invoiceId' = $2
               )
             ORDER BY e.occurred_at DESC, e.id DESC
             LIMIT 100`,
            [invoice.organization_id, invoice.id]
          )
        : Promise.resolve({ rows: [] } as { rows: InvoiceAuditRow[] })
    ]);

    return {
      organization: {
        id: invoice.organization_id,
        name: invoice.organization_name,
        slug: invoice.organization_slug
      },
      invoice: {
        id: invoice.id,
        organizationId: invoice.organization_id,
        subscriptionId: invoice.subscription_id,
        planId: invoice.plan_id,
        planVersionId: invoice.plan_version_id,
        planCode: invoice.plan_code,
        billingInterval: invoice.billing_interval,
        periodStart: invoice.period_start.toISOString(),
        periodEnd: invoice.period_end.toISOString(),
        amountVnd: Number(invoice.amount_vnd),
        paymentReference: invoice.payment_reference,
        paidAmountVnd: Number(invoice.paid_amount_vnd),
        remainingAmountVnd: Number(invoice.remaining_amount_vnd),
        status: invoice.status,
        isOverdue: invoice.is_overdue,
        issuedAt: invoice.issued_at.toISOString(),
        dueAt: invoice.due_at.toISOString(),
        paidAt: invoice.paid_at?.toISOString() ?? null,
        createdAt: invoice.created_at.toISOString(),
        updatedAt: invoice.updated_at.toISOString()
      },
      allocations: allocationResult.rows.map((row) => ({
        allocation: {
          id: row.allocation_id,
          organizationId: row.organization_id,
          paymentId: row.payment_id,
          invoiceId: row.invoice_id,
          amountVnd: Number(row.allocated_amount_vnd),
          allocatedByUserId: row.allocated_by_user_id,
          allocatedByName: row.allocated_by_name,
          reason: row.reason,
          createdAt: row.allocation_created_at.toISOString()
        },
        payment: {
          id: row.payment_id,
          amountVnd: Number(row.payment_amount_vnd),
          status: row.payment_status,
          reconciliationStatus: row.reconciliation_status,
          source: row.source,
          provider: row.provider,
          providerTransactionId: row.provider_transaction_id,
          occurredAt: row.occurred_at.toISOString()
        }
      })),
      auditEvents: canReadAudit
        ? auditResult.rows.map((row) => ({
            id: row.id,
            at: row.occurred_at.toISOString(),
            actor: row.actor_name ?? row.actor_email ?? "SYSTEM",
            action: row.action,
            targetType: row.target_type,
            target: row.target_key,
            reason: row.reason
          }))
        : null
    };
  }

  private requireBillingRead(principal: PlatformPrincipal): void {
    if (!platformRoleHasPermission(principal.role, "platform.billing.read")) {
      throw new ForbiddenException("Platform permission denied.");
    }
  }

  private requireUuid(value: string, name: string): void {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
      )
    ) {
      throw new BadRequestException(name + " must be a valid UUID.");
    }
  }
}
