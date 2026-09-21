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
  status: "OPEN" | "OVERDUE" | "PAID" | "VOID";
  issued_at: Date;
  due_at: Date;
  paid_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type PaymentRow = QueryResultRow & {
  id: string;
  organization_id: string;
  subscription_id: string;
  invoice_id: string;
  amount_vnd: string;
  status: "SUCCEEDED" | "FAILED" | "REFUNDED";
  source: "MANUAL" | "PROVIDER";
  provider: string | null;
  provider_transaction_id: string | null;
  idempotency_key: string;
  occurred_at: Date;
  recorded_by_user_id: string | null;
  metadata: unknown;
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
  status: "OPEN" | "OVERDUE" | "PAID" | "VOID";
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
  invoiceId: string;
  amountVnd: number;
  status: "SUCCEEDED" | "FAILED" | "REFUNDED";
  source: "MANUAL" | "PROVIDER";
  provider: string | null;
  providerTransactionId: string | null;
  idempotencyKey: string;
  occurredAt: string;
  recordedByUserId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface BillingSettlementView {
  invoice: SubscriptionInvoiceView;
  payment: SubscriptionPaymentView;
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
        "WHERE subscription_id = $1 AND period_start = $2 AND period_end = $3"
      ),
      [subscription.id, periodStart, periodEnd]
    );
    if (existing.rows[0]) {
      return this.mapInvoice(existing.rows[0]);
    }

    const inserted = await client.query<InvoiceRow>(
      `INSERT INTO saas_subscription_invoices (
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
       RETURNING
         id::text,
         organization_id::text,
         subscription_id::text,
         plan_id::text,
         plan_version_id::text,
         billing_interval,
         period_start,
         period_end,
         amount_vnd::text,
         status,
         issued_at,
         due_at,
         paid_at,
         created_at,
         updated_at`,
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

  recordSuccessfulPayment(input: {
    organizationId: string;
    invoiceId: string;
    amountVnd: number;
    source: "MANUAL" | "PROVIDER";
    provider?: string | null;
    providerTransactionId?: string | null;
    idempotencyKey: string;
    occurredAt?: string;
    recordedByUserId?: string | null;
    metadata?: unknown;
  }): Promise<BillingSettlementView> {
    return this.database.withTransaction((client) =>
      this.recordSuccessfulPaymentInTransaction(client, input)
    );
  }

  async recordSuccessfulPaymentInTransaction(
    client: PoolClient,
    input: {
      organizationId: string;
      invoiceId: string;
      amountVnd: number;
      source: "MANUAL" | "PROVIDER";
      provider?: string | null;
      providerTransactionId?: string | null;
      idempotencyKey: string;
      occurredAt?: string;
      recordedByUserId?: string | null;
      metadata?: unknown;
    }
  ): Promise<BillingSettlementView> {
    const idempotencyKey = input.idempotencyKey.trim();
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

    await this.lockOrganization(client, input.organizationId);

    const existingPayment = await client.query<PaymentRow>(
      this.paymentSelectSql(
        "WHERE organization_id = $1 AND idempotency_key = $2"
      ),
      [input.organizationId, idempotencyKey]
    );
    if (existingPayment.rows[0]) {
      const payment = existingPayment.rows[0];
      if (
        payment.invoice_id !== input.invoiceId ||
        Number(payment.amount_vnd) !== input.amountVnd ||
        payment.source !== input.source ||
        payment.provider !== (input.provider?.trim() || null) ||
        payment.provider_transaction_id !==
          (input.providerTransactionId?.trim() || null)
      ) {
        throw new SubscriptionBillingConflictError(
          "Payment idempotency key was reused with different settlement input."
        );
      }
      return this.settlementViewForPayment(client, payment);
    }

    const invoiceResult = await client.query<InvoiceRow>(
      this.invoiceSelectSql(
        "WHERE organization_id = $1 AND id = $2 FOR UPDATE"
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
        "Void subscription invoice cannot be paid."
      );
    }
    if (invoice.status === "PAID") {
      throw new SubscriptionBillingConflictError(
        "Subscription invoice is already paid."
      );
    }
    if (Number(invoice.amount_vnd) !== input.amountVnd) {
      throw new SubscriptionBillingConflictError(
        "Payment amount must exactly match the subscription invoice amount."
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
        "Cancelled subscription cannot be reactivated by payment."
      );
    }

    const provider = input.provider?.trim() || null;
    const providerTransactionId =
      input.providerTransactionId?.trim() || null;
    if (input.source === "PROVIDER" && !provider) {
      throw new SubscriptionBillingConflictError(
        "Provider payment source requires provider name."
      );
    }

    const occurredAt = input.occurredAt
      ? new Date(input.occurredAt)
      : new Date();
    if (Number.isNaN(occurredAt.getTime())) {
      throw new SubscriptionBillingConflictError(
        "Payment occurredAt must be a valid date-time."
      );
    }

    const paymentResult = await client.query<PaymentRow>(
      `INSERT INTO saas_subscription_payments (
         organization_id,
         subscription_id,
         invoice_id,
         amount_vnd,
         status,
         source,
         provider,
         provider_transaction_id,
         idempotency_key,
         occurred_at,
         recorded_by_user_id,
         metadata
       )
       VALUES (
         $1, $2, $3, $4, 'SUCCEEDED', $5, $6, $7, $8, $9, $10, $11::jsonb
       )
       RETURNING
         id::text,
         organization_id::text,
         subscription_id::text,
         invoice_id::text,
         amount_vnd::text,
         status,
         source,
         provider,
         provider_transaction_id,
         idempotency_key,
         occurred_at,
         recorded_by_user_id::text,
         metadata,
         created_at`,
      [
        input.organizationId,
        invoice.subscription_id,
        invoice.id,
        input.amountVnd,
        input.source,
        provider,
        providerTransactionId,
        idempotencyKey,
        occurredAt,
        input.recordedByUserId ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );

    await client.query(
      `UPDATE saas_subscription_invoices
       SET status = 'PAID',
           paid_at = COALESCE(paid_at, $3),
           updated_at = now()
       WHERE organization_id = $1
         AND id = $2`,
      [input.organizationId, invoice.id, occurredAt]
    );

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
      [input.organizationId, invoice.period_start, invoice.period_end]
    );

    await this.insertSystemAudit(client, {
      organizationId: input.organizationId,
      action: "SUBSCRIPTION_PAYMENT_SETTLED",
      targetType: "SAAS_SUBSCRIPTION_INVOICE",
      targetKey: invoice.id,
      beforeState: {
        invoiceStatus: invoice.status,
        subscriptionStatus: subscription.status,
        subscriptionVersion: subscription.version
      },
      afterState: {
        invoiceStatus: "PAID",
        subscriptionStatus: "ACTIVE",
        subscriptionVersion: subscription.version + 1,
        paymentId: paymentResult.rows[0]!.id
      },
      reason:
        input.source === "MANUAL"
          ? "Manual SaaS subscription payment recorded"
          : "Provider SaaS subscription payment settled"
    });

    return this.settlementViewForPayment(client, paymentResult.rows[0]!);
  }

  processOrganizationBilling(
    organizationId: string
  ): Promise<{
    invoice: SubscriptionInvoiceView | null;
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
      const transition = await this.advanceDelinquencyInTransaction(
        client,
        organizationId
      );
      return { invoice, transition };
    });
  }

  async listInvoices(
    organizationId: string,
    limit = 50
  ): Promise<SubscriptionInvoiceView[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const result = await this.database.query<InvoiceRow>(
      this.invoiceSelectSql(
        "WHERE organization_id = $1 ORDER BY period_start DESC LIMIT $2"
      ),
      [organizationId, safeLimit]
    );
    return result.rows.map((row) => this.mapInvoice(row));
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

    const overdueInvoice = await client.query<InvoiceRow>(
      this.invoiceSelectSql(
        `WHERE organization_id = $1
           AND status IN ('OPEN', 'OVERDUE')
           AND due_at <= now()
         ORDER BY due_at
         LIMIT 1
         FOR UPDATE`
      ),
      [organizationId]
    );
    const invoice = overdueInvoice.rows[0];

    if (invoice && invoice.status === "OPEN") {
      await client.query(
        `UPDATE saas_subscription_invoices
         SET status = 'OVERDUE',
             updated_at = now()
         WHERE organization_id = $1
           AND id = $2`,
        [organizationId, invoice.id]
      );
    }

    let target: SubscriptionStatus | null = null;
    let reason = "";

    if (
      invoice &&
      (subscription.status === "TRIALING" ||
        subscription.status === "ACTIVE")
    ) {
      target = "PAST_DUE";
      reason = "Renewal invoice reached due date without successful payment.";
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
        version: transition.subscription.version
      },
      reason
    });

    return {
      from: subscription.status,
      to: target,
      version: transition.subscription.version
    };
  }

  private async settlementViewForPayment(
    client: PoolClient,
    payment: PaymentRow
  ): Promise<BillingSettlementView> {
    const invoiceResult = await client.query<InvoiceRow>(
      this.invoiceSelectSql("WHERE id = $1"),
      [payment.invoice_id]
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice) {
      throw new SubscriptionBillingNotFoundError(
        "Settlement invoice was not found."
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
      payment: this.mapPayment(payment),
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
       id::text,
       organization_id::text,
       subscription_id::text,
       plan_id::text,
       plan_version_id::text,
       billing_interval,
       period_start,
       period_end,
       amount_vnd::text,
       status,
       issued_at,
       due_at,
       paid_at,
       created_at,
       updated_at
     FROM saas_subscription_invoices
     ${whereClause}`;
  }

  private paymentSelectSql(whereClause: string): string {
    return `SELECT
       id::text,
       organization_id::text,
       subscription_id::text,
       invoice_id::text,
       amount_vnd::text,
       status,
       source,
       provider,
       provider_transaction_id,
       idempotency_key,
       occurred_at,
       recorded_by_user_id::text,
       metadata,
       created_at
     FROM saas_subscription_payments
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
      status: row.status,
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
      invoiceId: row.invoice_id,
      amountVnd: Number(row.amount_vnd),
      status: row.status,
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
