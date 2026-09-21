import { Injectable } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import {
  transitionSubscription,
  type SubscriptionStatus
} from "../domain/subscription-lifecycle.js";

type SubscriptionBillingRow = QueryResultRow & {
  id: string;
  organization_id: string;
  plan_id: string;
  plan_version_id: string;
  plan_code: string;
  status: SubscriptionStatus;
  version: number;
  billing_interval: "MONTHLY" | "YEARLY";
  trial_ends_at: Date | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
  grace_ends_at: Date | null;
  past_due_at: Date | null;
  cancel_at_period_end: boolean;
  monthly_price_vnd: string;
  yearly_price_vnd: string | null;
};

type InvoiceRow = QueryResultRow & {
  id: string;
  organization_id: string;
  subscription_id: string;
  plan_id: string;
  plan_version_id: string;
  billing_interval: "MONTHLY" | "YEARLY";
  period_start: Date;
  period_end: Date;
  amount_vnd: string;
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

type PaymentRow = QueryResultRow & {
  id: string;
  organization_id: string;
  subscription_id: string;
  amount_vnd: string;
  status: "SUCCEEDED" | "FAILED" | "REFUNDED";
  reconciliation_status: "UNALLOCATED" | "ALLOCATED" | "REVIEW_REQUIRED";
  source: "MANUAL" | "PROVIDER";
  provider: string | null;
  provider_transaction_id: string | null;
  idempotency_key: string;
  occurred_at: Date;
  recorded_by_user_id: string | null;
  metadata: unknown;
  created_at: Date;
  allocated_amount_vnd: string;
  unallocated_amount_vnd: string;
};

type AllocationRow = QueryResultRow & {
  id: string;
  organization_id: string;
  payment_id: string;
  invoice_id: string;
  amount_vnd: string;
  allocated_by_user_id: string | null;
  reason: string;
  created_at: Date;
};

type SettingRow = QueryResultRow & { value: unknown };

export interface SubscriptionInvoiceView {
  id: string;
  organizationId: string;
  subscriptionId: string;
  planId: string;
  planVersionId: string;
  billingInterval: "MONTHLY" | "YEARLY";
  periodStart: string;
  periodEnd: string;
  amountVnd: number;
  paidAmountVnd: number;
  remainingAmountVnd: number;
  status: "OPEN" | "PARTIALLY_PAID" | "PAID" | "VOID";
  isOverdue: boolean;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionPaymentView {
  id: string;
  organizationId: string;
  subscriptionId: string;
  amountVnd: number;
  allocatedAmountVnd: number;
  unallocatedAmountVnd: number;
  status: "SUCCEEDED" | "FAILED" | "REFUNDED";
  reconciliationStatus: "UNALLOCATED" | "ALLOCATED" | "REVIEW_REQUIRED";
  source: "MANUAL" | "PROVIDER";
  provider: string | null;
  providerTransactionId: string | null;
  idempotencyKey: string;
  occurredAt: string;
  recordedByUserId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface SubscriptionPaymentAllocationView {
  id: string;
  organizationId: string;
  paymentId: string;
  invoiceId: string;
  amountVnd: number;
  allocatedByUserId: string | null;
  reason: string;
  createdAt: string;
}

export interface BillingSettlementView {
  invoice: SubscriptionInvoiceView;
  payment: SubscriptionPaymentView;
  allocation: SubscriptionPaymentAllocationView;
  subscription: {
    organizationId: string;
    status: SubscriptionStatus;
    version: number;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
  };
}

export class SubscriptionBillingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionBillingConflictError";
  }
}

export class SubscriptionBillingNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionBillingNotFoundError";
  }
}

export class SubscriptionBillingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionBillingConfigurationError";
  }
}

@Injectable()
export class SubscriptionBillingService {
  constructor(private readonly database: DatabaseService) {}

  ensureRenewalInvoice(
    organizationId: string
  ): Promise<SubscriptionInvoiceView | null> {
    return this.database.withTransaction((client) =>
      this.ensureRenewalInvoiceInTransaction(client, organizationId)
    );
  }

  async ensureRenewalInvoiceInTransaction(
    client: PoolClient,
    organizationId: string
  ): Promise<SubscriptionInvoiceView | null> {
    await this.lockOrganization(client, organizationId);
    const subscription = await this.loadSubscriptionForUpdate(
      client,
      organizationId
    );

    if (subscription.status === "CANCELLED") {
      return null;
    }

    const periodStart =
      subscription.status === "TRIALING"
        ? subscription.trial_ends_at
        : subscription.current_period_end;

    if (!periodStart) {
      return null;
    }

    const leadDays = await this.positiveIntegerSetting(
      client,
      "renewal_invoice_lead_days"
    );
    const dueWindow = new Date(Date.now() + leadDays * 86_400_000);
    if (periodStart.getTime() > dueWindow.getTime()) {
      return null;
    }

    const periodEndResult = await client.query<
      QueryResultRow & { period_end: Date }
    >(
      `SELECT CASE
         WHEN $2 = 'YEARLY'
           THEN $1::timestamptz + interval '1 year'
         ELSE $1::timestamptz + interval '1 month'
       END AS period_end`,
      [periodStart, subscription.billing_interval]
    );
    const periodEnd = periodEndResult.rows[0]!.period_end;

    const amount =
      subscription.billing_interval === "YEARLY"
        ? subscription.yearly_price_vnd
        : subscription.monthly_price_vnd;

    if (amount === null) {
      throw new SubscriptionBillingConfigurationError(
        "Selected plan version has no yearly price."
      );
    }

    const existing = await client.query<InvoiceRow>(
      this.invoiceSelectSql(
        "WHERE i.subscription_id = $1 AND i.period_start = $2 AND i.period_end = $3"
      ),
      [subscription.id, periodStart, periodEnd]
    );
    if (existing.rows[0]) {
      return this.mapInvoice(existing.rows[0]);
    }

    const inserted = await client.query<InvoiceRow>(
      `WITH inserted AS (
         INSERT INTO saas_subscription_invoices (
           organization_id,
           subscription_id,
           plan_id,
           plan_version_id,
           billing_interval,
           period_start,
           period_end,
           amount_vnd,
           status,
           due_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::bigint, 'OPEN', $6)
         RETURNING *
       )
       SELECT
         i.id::text,
         i.organization_id::text,
         i.subscription_id::text,
         i.plan_id::text,
         i.plan_version_id::text,
         i.billing_interval,
         i.period_start,
         i.period_end,
         i.amount_vnd::text,
         i.status,
         i.issued_at,
         i.due_at,
         i.paid_at,
         i.created_at,
         i.updated_at,
         '0'::text AS paid_amount_vnd,
         i.amount_vnd::text AS remaining_amount_vnd,
         (i.due_at <= now()) AS is_overdue
       FROM inserted i`,
      [
        subscription.organization_id,
        subscription.id,
        subscription.plan_id,
        subscription.plan_version_id,
        subscription.billing_interval,
        periodStart,
        periodEnd,
        amount
      ]
    );

    return this.mapInvoice(inserted.rows[0]!);
  }

  async recordManualPaymentInTransaction(
    client: PoolClient,
    input: {
      organizationId: string;
      invoiceId: string;
      amountVnd: number;
      idempotencyKey: string;
      recordedByUserId: string;
      reason: string;
      metadata?: unknown;
    }
  ): Promise<BillingSettlementView> {
    const idempotencyKey = input.idempotencyKey.trim();
    const reason = input.reason.trim();

    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new SubscriptionBillingConflictError(
        "Payment idempotency key must be between 8 and 200 characters."
      );
    }
    if (!Number.isInteger(input.amountVnd) || input.amountVnd <= 0) {
      throw new SubscriptionBillingConflictError(
        "Payment amount must be a positive integer VND amount."
      );
    }
    if (reason.length < 3) {
      throw new SubscriptionBillingConflictError(
        "Manual payment allocation reason is required."
      );
    }

    await this.lockOrganization(client, input.organizationId);

    const existingPayment = await client.query<PaymentRow>(
      this.paymentSelectSql(
        "WHERE p.organization_id = $1 AND p.idempotency_key = $2"
      ),
      [input.organizationId, idempotencyKey]
    );
    if (existingPayment.rows[0]) {
      const payment = existingPayment.rows[0];
      if (
        Number(payment.amount_vnd) !== input.amountVnd ||
        payment.source !== "MANUAL"
      ) {
        throw new SubscriptionBillingConflictError(
          "Payment idempotency key was reused with different settlement input."
        );
      }

      const allocationResult = await client.query<AllocationRow>(
        this.allocationSelectSql(
          "WHERE a.payment_id = $1 AND a.invoice_id = $2"
        ),
        [payment.id, input.invoiceId]
      );
      const allocation = allocationResult.rows[0];
      if (
        !allocation ||
        Number(allocation.amount_vnd) !== input.amountVnd
      ) {
        throw new SubscriptionBillingConflictError(
          "Payment idempotency key was reused for a different invoice allocation."
        );
      }

      return this.settlementView(
        client,
        payment,
        allocation,
        input.invoiceId
      );
    }

    const invoiceResult = await client.query<InvoiceRow>(
      this.invoiceSelectSql(
        "WHERE i.organization_id = $1 AND i.id = $2 FOR UPDATE OF i"
      ),
      [input.organizationId, input.invoiceId]
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice) {
      throw new SubscriptionBillingNotFoundError(
        "Subscription invoice was not found."
      );
    }
    if (invoice.status === "VOID") {
      throw new SubscriptionBillingConflictError(
        "Void subscription invoice cannot receive payment."
      );
    }
    if (invoice.status === "PAID" || Number(invoice.remaining_amount_vnd) <= 0) {
      throw new SubscriptionBillingConflictError(
        "Subscription invoice is already paid."
      );
    }
    if (input.amountVnd > Number(invoice.remaining_amount_vnd)) {
      throw new SubscriptionBillingConflictError(
        "Payment exceeds the remaining subscription invoice amount."
      );
    }

    const subscription = await this.loadSubscriptionForUpdate(
      client,
      input.organizationId
    );
    if (subscription.id !== invoice.subscription_id) {
      throw new SubscriptionBillingConflictError(
        "Invoice does not belong to the current organization subscription."
      );
    }
    if (subscription.status === "CANCELLED") {
      throw new SubscriptionBillingConflictError(
        "Cancelled subscription cannot receive payment allocation."
      );
    }

    const paymentResult = await client.query<PaymentRow>(
      `WITH inserted AS (
         INSERT INTO saas_subscription_payments (
           organization_id,
           subscription_id,
           amount_vnd,
           status,
           reconciliation_status,
           source,
           idempotency_key,
           occurred_at,
           recorded_by_user_id,
           metadata
         )
         VALUES (
           $1, $2, $3, 'SUCCEEDED', 'ALLOCATED', 'MANUAL',
           $4, now(), $5, $6::jsonb
         )
         RETURNING *
       )
       SELECT
         p.id::text,
         p.organization_id::text,
         p.subscription_id::text,
         p.amount_vnd::text,
         p.status,
         p.reconciliation_status,
         p.source,
         p.provider,
         p.provider_transaction_id,
         p.idempotency_key,
         p.occurred_at,
         p.recorded_by_user_id::text,
         p.metadata,
         p.created_at,
         p.amount_vnd::text AS allocated_amount_vnd,
         '0'::text AS unallocated_amount_vnd
       FROM inserted p`,
      [
        input.organizationId,
        invoice.subscription_id,
        input.amountVnd,
        idempotencyKey,
        input.recordedByUserId,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    const payment = paymentResult.rows[0]!;

    const allocationResult = await client.query<AllocationRow>(
      `INSERT INTO saas_subscription_payment_allocations (
         organization_id,
         payment_id,
         invoice_id,
         amount_vnd,
         allocated_by_user_id,
         reason
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING
         id::text,
         organization_id::text,
         payment_id::text,
         invoice_id::text,
         amount_vnd::text,
         allocated_by_user_id::text,
         reason,
         created_at`,
      [
        input.organizationId,
        payment.id,
        invoice.id,
        input.amountVnd,
        input.recordedByUserId,
        reason
      ]
    );
    const allocation = allocationResult.rows[0]!;

    const paidAfter = Number(invoice.paid_amount_vnd) + input.amountVnd;
    const remainingAfter = Number(invoice.amount_vnd) - paidAfter;
    const invoiceStatus =
      remainingAfter === 0 ? "PAID" : "PARTIALLY_PAID";

    await client.query(
      `UPDATE saas_subscription_invoices
       SET status = $3,
           paid_at = CASE
             WHEN $3 = 'PAID' THEN COALESCE(paid_at, now())
             ELSE NULL
           END,
           updated_at = now()
       WHERE organization_id = $1
         AND id = $2`,
      [input.organizationId, invoice.id, invoiceStatus]
    );

    if (invoiceStatus === "PAID") {
      await this.activatePaidPeriodInTransaction(
        client,
        input.organizationId
      );
    }

    const refreshedInvoiceResult = await client.query<InvoiceRow>(
      this.invoiceSelectSql(
        "WHERE i.organization_id = $1 AND i.id = $2"
      ),
      [input.organizationId, invoice.id]
    );
    const refreshedInvoice = refreshedInvoiceResult.rows[0]!;

    await this.insertSystemAudit(client, {
      organizationId: input.organizationId,
      action: "SUBSCRIPTION_PAYMENT_ALLOCATED",
      targetType: "SAAS_SUBSCRIPTION_INVOICE",
      targetKey: invoice.id,
      beforeState: {
        invoiceStatus: invoice.status,
        paidAmountVnd: Number(invoice.paid_amount_vnd),
        remainingAmountVnd: Number(invoice.remaining_amount_vnd),
        subscriptionStatus: subscription.status,
        subscriptionVersion: subscription.version
      },
      afterState: {
        invoiceStatus: refreshedInvoice.status,
        paidAmountVnd: refreshedInvoice.paid_amount_vnd,
        remainingAmountVnd: refreshedInvoice.remaining_amount_vnd,
        paymentId: payment.id,
        allocationId: allocation.id
      },
      reason
    });

    return this.settlementView(
      client,
      payment,
      allocation,
      invoice.id
    );
  }

  async processDueBatch(
    limit = 100
  ): Promise<{
    processed: number;
    results: Array<{
      organizationId: string;
      ok: boolean;
      invoiceId?: string | null;
      activatedPaidPeriod?: boolean;
      transition?: string | null;
      error?: string;
    }>;
  }> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const candidates = await this.database.query<
      QueryResultRow & { organization_id: string }
    >(
      `WITH billing_settings AS (
         SELECT (value #>> '{}')::int AS lead_days
         FROM system_settings
         WHERE key = 'renewal_invoice_lead_days'
       )
       SELECT s.organization_id::text
       FROM organization_subscriptions s
       CROSS JOIN billing_settings bs
       WHERE s.status <> 'CANCELLED'
         AND (
           (
             s.status = 'TRIALING'
             AND s.trial_ends_at IS NOT NULL
             AND s.trial_ends_at <=
               now() + make_interval(days => bs.lead_days)
           )
           OR (
             s.status <> 'TRIALING'
             AND s.current_period_end IS NOT NULL
             AND s.current_period_end <=
               now() + make_interval(days => bs.lead_days)
           )
           OR (
             s.status = 'PAST_DUE'
             AND s.past_due_at IS NOT NULL
           )
           OR (
             s.status = 'GRACE_PERIOD'
             AND s.grace_ends_at IS NOT NULL
           )
         )
       ORDER BY
         COALESCE(
           s.trial_ends_at,
           s.current_period_end,
           s.past_due_at,
           s.grace_ends_at
         ),
         s.organization_id
       LIMIT $1`,
      [safeLimit]
    );

    const results: Array<{
      organizationId: string;
      ok: boolean;
      invoiceId?: string | null;
      activatedPaidPeriod?: boolean;
      transition?: string | null;
      error?: string;
    }> = [];

    for (const candidate of candidates.rows) {
      try {
        const result = await this.processOrganizationBilling(
          candidate.organization_id
        );
        results.push({
          organizationId: candidate.organization_id,
          ok: true,
          invoiceId: result.invoice?.id ?? null,
          activatedPaidPeriod: result.activatedPaidPeriod,
          transition: result.transition
            ? result.transition.from + "->" + result.transition.to
            : null
        });
      } catch (error) {
        results.push({
          organizationId: candidate.organization_id,
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Unknown billing processing error"
        });
      }
    }

    return {
      processed: results.length,
      results
    };
  }

  processOrganizationBilling(
    organizationId: string
  ): Promise<{
    invoice: SubscriptionInvoiceView | null;
    activatedPaidPeriod: boolean;
    transition:
      | {
          from: SubscriptionStatus;
          to: SubscriptionStatus;
          version: number;
        }
      | null;
  }> {
    return this.database.withTransaction(async (client) => {
      await this.lockOrganization(client, organizationId);
      const invoice = await this.ensureRenewalInvoiceInTransaction(
        client,
        organizationId
      );
      const activatedPaidPeriod =
        await this.activatePaidPeriodInTransaction(
          client,
          organizationId
        );
      const transition = activatedPaidPeriod
        ? null
        : await this.advanceDelinquencyInTransaction(
            client,
            organizationId
          );
      return { invoice, activatedPaidPeriod, transition };
    });
  }

  async listInvoices(
    organizationId: string,
    limit = 50
  ): Promise<SubscriptionInvoiceView[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const result = await this.database.query<InvoiceRow>(
      this.invoiceSelectSql(
        "WHERE i.organization_id = $1 ORDER BY i.period_start DESC LIMIT $2"
      ),
      [organizationId, safeLimit]
    );
    return result.rows.map((row) => this.mapInvoice(row));
  }

  private async activatePaidPeriodInTransaction(
    client: PoolClient,
    organizationId: string
  ): Promise<boolean> {
    const subscription = await this.loadSubscriptionForUpdate(
      client,
      organizationId
    );
    if (subscription.status === "CANCELLED") {
      return false;
    }

    const paidInvoiceResult = await client.query<InvoiceRow>(
      this.invoiceSelectSql(
        `WHERE i.organization_id = $1
           AND i.status = 'PAID'
           AND i.period_start <= now()
           AND i.period_end > now()
         ORDER BY i.period_start DESC
         LIMIT 1
         FOR UPDATE OF i`
      ),
      [organizationId]
    );
    const invoice = paidInvoiceResult.rows[0];
    if (!invoice) {
      return false;
    }

    const samePeriod =
      subscription.current_period_start?.getTime() ===
        invoice.period_start.getTime() &&
      subscription.current_period_end?.getTime() ===
        invoice.period_end.getTime();
    const alreadyActive =
      subscription.status === "ACTIVE" &&
      samePeriod &&
      subscription.trial_ends_at === null &&
      subscription.past_due_at === null &&
      subscription.grace_ends_at === null;

    if (alreadyActive) {
      return false;
    }

    await client.query(
      `UPDATE organization_subscriptions
       SET status = 'ACTIVE',
           current_period_start = $2,
           current_period_end = $3,
           trial_ends_at = NULL,
           past_due_at = NULL,
           grace_ends_at = NULL,
           version = version + 1,
           updated_at = now()
       WHERE organization_id = $1`,
      [organizationId, invoice.period_start, invoice.period_end]
    );

    await this.insertSystemAudit(client, {
      organizationId,
      action: "SUBSCRIPTION_PAID_PERIOD_ACTIVATED",
      targetType: "SAAS_SUBSCRIPTION",
      targetKey: subscription.id,
      beforeState: {
        status: subscription.status,
        version: subscription.version,
        currentPeriodStart:
          subscription.current_period_start?.toISOString() ?? null,
        currentPeriodEnd:
          subscription.current_period_end?.toISOString() ?? null
      },
      afterState: {
        status: "ACTIVE",
        version: subscription.version + 1,
        currentPeriodStart: invoice.period_start.toISOString(),
        currentPeriodEnd: invoice.period_end.toISOString(),
        invoiceId: invoice.id
      },
      reason: "Fully paid SaaS billing period became effective."
    });

    return true;
  }

  private async advanceDelinquencyInTransaction(
    client: PoolClient,
    organizationId: string
  ): Promise<{
    from: SubscriptionStatus;
    to: SubscriptionStatus;
    version: number;
  } | null> {
    const subscription = await this.loadSubscriptionForUpdate(
      client,
      organizationId
    );

    if (subscription.status === "CANCELLED") {
      return null;
    }

    const dueUnpaidInvoice = await client.query<InvoiceRow>(
      this.invoiceSelectSql(
        `WHERE i.organization_id = $1
           AND i.status IN ('OPEN', 'PARTIALLY_PAID')
           AND i.due_at <= now()
         ORDER BY i.due_at
         LIMIT 1
         FOR UPDATE OF i`
      ),
      [organizationId]
    );
    const invoice = dueUnpaidInvoice.rows[0];

    let target: SubscriptionStatus | null = null;
    let reason = "";

    if (
      invoice &&
      (subscription.status === "TRIALING" ||
        subscription.status === "ACTIVE")
    ) {
      target = "PAST_DUE";
      reason = "Renewal invoice reached due date with remaining balance.";
    } else if (
      subscription.status === "PAST_DUE" &&
      subscription.past_due_at
    ) {
      const warningDays = await this.positiveIntegerSetting(
        client,
        "past_due_warning_days"
      );
      if (
        subscription.past_due_at.getTime() +
          warningDays * 86_400_000 <=
        Date.now()
      ) {
        target = "GRACE_PERIOD";
        reason = "Past-due warning period expired.";
      }
    } else if (
      subscription.status === "GRACE_PERIOD" &&
      subscription.grace_ends_at &&
      subscription.grace_ends_at.getTime() <= Date.now()
    ) {
      target = "SUSPENDED";
      reason = "Subscription grace period expired.";
    }

    if (!target) {
      return null;
    }

    const transition = transitionSubscription(
      {
        id: subscription.id,
        organizationId: subscription.organization_id,
        planId: subscription.plan_id,
        planVersionId: subscription.plan_version_id,
        status: subscription.status,
        version: subscription.version
      },
      target,
      reason
    );

    let graceEndsAt = subscription.grace_ends_at;
    if (target === "GRACE_PERIOD") {
      const graceDays = await this.positiveIntegerSetting(
        client,
        "grace_period_days"
      );
      graceEndsAt = new Date(Date.now() + graceDays * 86_400_000);
    }

    await client.query(
      `UPDATE organization_subscriptions
       SET status = $2,
           version = $3,
           past_due_at = CASE
             WHEN $2 = 'PAST_DUE' THEN COALESCE(past_due_at, now())
             ELSE past_due_at
           END,
           grace_ends_at = $4,
           updated_at = now()
       WHERE organization_id = $1`,
      [
        organizationId,
        target,
        transition.subscription.version,
        graceEndsAt
      ]
    );

    await this.insertSystemAudit(client, {
      organizationId,
      action: "SUBSCRIPTION_BILLING_STATUS_CHANGED",
      targetType: "SAAS_SUBSCRIPTION",
      targetKey: subscription.id,
      beforeState: {
        status: subscription.status,
        version: subscription.version
      },
      afterState: {
        status: target,
        version: transition.subscription.version,
        invoiceId: invoice?.id ?? null,
        remainingAmountVnd:
          invoice === undefined
            ? null
            : Number(invoice.remaining_amount_vnd)
      },
      reason
    });

    return {
      from: subscription.status,
      to: target,
      version: transition.subscription.version
    };
  }

  private async settlementView(
    client: PoolClient,
    payment: PaymentRow,
    allocation: AllocationRow,
    invoiceId: string
  ): Promise<BillingSettlementView> {
    const invoiceResult = await client.query<InvoiceRow>(
      this.invoiceSelectSql(
        "WHERE i.organization_id = $1 AND i.id = $2"
      ),
      [payment.organization_id, invoiceId]
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice) {
      throw new SubscriptionBillingNotFoundError(
        "Settlement invoice was not found."
      );
    }

    const refreshedPaymentResult = await client.query<PaymentRow>(
      this.paymentSelectSql("WHERE p.id = $1"),
      [payment.id]
    );
    const refreshedPayment = refreshedPaymentResult.rows[0];
    if (!refreshedPayment) {
      throw new SubscriptionBillingNotFoundError(
        "Settlement payment was not found."
      );
    }

    const subscription = await client.query<
      QueryResultRow & {
        organization_id: string;
        status: SubscriptionStatus;
        version: number;
        current_period_start: Date | null;
        current_period_end: Date | null;
      }
    >(
      `SELECT
         organization_id::text,
         status,
         version,
         current_period_start,
         current_period_end
       FROM organization_subscriptions
       WHERE id = $1`,
      [payment.subscription_id]
    );
    const row = subscription.rows[0];
    if (!row) {
      throw new SubscriptionBillingNotFoundError(
        "Settlement subscription was not found."
      );
    }

    return {
      invoice: this.mapInvoice(invoice),
      payment: this.mapPayment(refreshedPayment),
      allocation: this.mapAllocation(allocation),
      subscription: {
        organizationId: row.organization_id,
        status: row.status,
        version: row.version,
        currentPeriodStart:
          row.current_period_start?.toISOString() ?? null,
        currentPeriodEnd:
          row.current_period_end?.toISOString() ?? null
      }
    };
  }

  private async lockOrganization(
    client: PoolClient,
    organizationId: string
  ): Promise<void> {
    const result = await client.query(
      "SELECT id FROM organizations WHERE id = $1 FOR UPDATE",
      [organizationId]
    );
    if (result.rowCount !== 1) {
      throw new SubscriptionBillingNotFoundError(
        "Organization was not found."
      );
    }
  }

  private async loadSubscriptionForUpdate(
    client: PoolClient,
    organizationId: string
  ): Promise<SubscriptionBillingRow> {
    const result = await client.query<SubscriptionBillingRow>(
      `SELECT
         s.id::text,
         s.organization_id::text,
         s.plan_id::text,
         s.plan_version_id::text,
         p.code AS plan_code,
         s.status,
         s.version,
         s.billing_interval,
         s.trial_ends_at,
         s.current_period_start,
         s.current_period_end,
         s.grace_ends_at,
         s.past_due_at,
         s.cancel_at_period_end,
         pv.monthly_price_vnd::text,
         pv.yearly_price_vnd::text
       FROM organization_subscriptions s
       JOIN saas_plans p ON p.id = s.plan_id
       JOIN saas_plan_versions pv
         ON pv.id = s.plan_version_id
        AND pv.plan_id = s.plan_id
       WHERE s.organization_id = $1
       FOR UPDATE OF s`,
      [organizationId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new SubscriptionBillingNotFoundError(
        "Organization SaaS subscription was not found."
      );
    }
    return row;
  }

  private async positiveIntegerSetting(
    client: PoolClient,
    key: string
  ): Promise<number> {
    const result = await client.query<SettingRow>(
      "SELECT value FROM system_settings WHERE key = $1",
      [key]
    );
    const raw = result.rows[0]?.value;
    const value = typeof raw === "number" ? raw : Number(raw);

    if (!Number.isInteger(value) || value < 1) {
      throw new SubscriptionBillingConfigurationError(
        "System setting " + key + " must be a positive integer."
      );
    }
    return value;
  }

  private invoiceSelectSql(whereClause: string): string {
    return `SELECT
       i.id::text,
       i.organization_id::text,
       i.subscription_id::text,
       i.plan_id::text,
       i.plan_version_id::text,
       i.billing_interval,
       i.period_start,
       i.period_end,
       i.amount_vnd::text,
       i.status,
       i.issued_at,
       i.due_at,
       i.paid_at,
       i.created_at,
       i.updated_at,
       COALESCE(alloc.paid_amount_vnd, 0)::text AS paid_amount_vnd,
       (i.amount_vnd - COALESCE(alloc.paid_amount_vnd, 0))::text
         AS remaining_amount_vnd,
       (
         i.due_at <= now()
         AND i.status IN ('OPEN', 'PARTIALLY_PAID')
       ) AS is_overdue
     FROM saas_subscription_invoices i
     LEFT JOIN LATERAL (
       SELECT COALESCE(sum(a.amount_vnd), 0)::bigint AS paid_amount_vnd
       FROM saas_subscription_payment_allocations a
       JOIN saas_subscription_payments p
         ON p.organization_id = a.organization_id
        AND p.id = a.payment_id
       WHERE a.organization_id = i.organization_id
         AND a.invoice_id = i.id
         AND p.status = 'SUCCEEDED'
     ) alloc ON true
     ${whereClause}`;
  }

  private paymentSelectSql(whereClause: string): string {
    return `SELECT
       p.id::text,
       p.organization_id::text,
       p.subscription_id::text,
       p.amount_vnd::text,
       p.status,
       p.reconciliation_status,
       p.source,
       p.provider,
       p.provider_transaction_id,
       p.idempotency_key,
       p.occurred_at,
       p.recorded_by_user_id::text,
       p.metadata,
       p.created_at,
       COALESCE(alloc.allocated_amount_vnd, 0)::text
         AS allocated_amount_vnd,
       (p.amount_vnd - COALESCE(alloc.allocated_amount_vnd, 0))::text
         AS unallocated_amount_vnd
     FROM saas_subscription_payments p
     LEFT JOIN LATERAL (
       SELECT COALESCE(sum(a.amount_vnd), 0)::bigint
         AS allocated_amount_vnd
       FROM saas_subscription_payment_allocations a
       WHERE a.organization_id = p.organization_id
         AND a.payment_id = p.id
     ) alloc ON true
     ${whereClause}`;
  }

  private allocationSelectSql(whereClause: string): string {
    return `SELECT
       a.id::text,
       a.organization_id::text,
       a.payment_id::text,
       a.invoice_id::text,
       a.amount_vnd::text,
       a.allocated_by_user_id::text,
       a.reason,
       a.created_at
     FROM saas_subscription_payment_allocations a
     ${whereClause}`;
  }

  private mapInvoice(row: InvoiceRow): SubscriptionInvoiceView {
    return {
      id: row.id,
      organizationId: row.organization_id,
      subscriptionId: row.subscription_id,
      planId: row.plan_id,
      planVersionId: row.plan_version_id,
      billingInterval: row.billing_interval,
      periodStart: row.period_start.toISOString(),
      periodEnd: row.period_end.toISOString(),
      amountVnd: Number(row.amount_vnd),
      paidAmountVnd: Number(row.paid_amount_vnd),
      remainingAmountVnd: Number(row.remaining_amount_vnd),
      status: row.status,
      isOverdue: row.is_overdue,
      issuedAt: row.issued_at.toISOString(),
      dueAt: row.due_at.toISOString(),
      paidAt: row.paid_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  }

  private mapPayment(row: PaymentRow): SubscriptionPaymentView {
    return {
      id: row.id,
      organizationId: row.organization_id,
      subscriptionId: row.subscription_id,
      amountVnd: Number(row.amount_vnd),
      allocatedAmountVnd: Number(row.allocated_amount_vnd),
      unallocatedAmountVnd: Number(row.unallocated_amount_vnd),
      status: row.status,
      reconciliationStatus: row.reconciliation_status,
      source: row.source,
      provider: row.provider,
      providerTransactionId: row.provider_transaction_id,
      idempotencyKey: row.idempotency_key,
      occurredAt: row.occurred_at.toISOString(),
      recordedByUserId: row.recorded_by_user_id,
      metadata: row.metadata,
      createdAt: row.created_at.toISOString()
    };
  }

  private mapAllocation(
    row: AllocationRow
  ): SubscriptionPaymentAllocationView {
    return {
      id: row.id,
      organizationId: row.organization_id,
      paymentId: row.payment_id,
      invoiceId: row.invoice_id,
      amountVnd: Number(row.amount_vnd),
      allocatedByUserId: row.allocated_by_user_id,
      reason: row.reason,
      createdAt: row.created_at.toISOString()
    };
  }

  private async insertSystemAudit(
    client: PoolClient,
    input: {
      organizationId: string;
      action: string;
      targetType: string;
      targetKey: string;
      beforeState: unknown;
      afterState: unknown;
      reason: string;
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO platform_audit_events (
         actor_user_id,
         action,
         target_type,
         target_key,
         organization_id,
         before_state,
         after_state,
         reason
       )
       VALUES (NULL, $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
      [
        input.action,
        input.targetType,
        input.targetKey,
        input.organizationId,
        JSON.stringify(input.beforeState),
        JSON.stringify(input.afterState),
        input.reason
      ]
    );
  }
}
