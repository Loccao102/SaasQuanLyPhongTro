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

type PaymentRow = QueryResultRow & {
  id: string;
  organization_id: string | null;
  subscription_id: string | null;
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
  paymentReference: string;
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
  organizationId: string | null;
  subscriptionId: string | null;
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

export interface ProviderPaymentReviewView {
  payment: SubscriptionPaymentView;
  paymentReference: string | null;
}

export type ProviderPaymentReconciliationStatus =
  | "UNALLOCATED"
  | "ALLOCATED"
  | "REVIEW_REQUIRED";

export interface ProviderPaymentSearchResult {
  items: ProviderPaymentReviewView[];
  nextCursor: string | null;
}

export interface ProviderPaymentIngestionView {
  payment: SubscriptionPaymentView;
  invoice: SubscriptionInvoiceView | null;
  allocation: SubscriptionPaymentAllocationView | null;
  matchedBy: "PAYMENT_REFERENCE" | null;
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

export interface SubscriptionCancellationScheduleView {
  organizationId: string;
  subscriptionId: string;
  status: SubscriptionStatus;
  version: number;
  cancelAtPeriodEnd: boolean;
  effectiveAt: string | null;
  voidedInvoiceIds: string[];
  reopenedInvoiceIds: string[];
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

    if (
      subscription.status === "CANCELLED" ||
      subscription.cancel_at_period_end
    ) {
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
         i.payment_reference,
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

  async searchProviderPayments(input?: {
    query?: string | null;
    provider?: string | null;
    reconciliationStatus?: ProviderPaymentReconciliationStatus | null;
    limit?: number;
    cursor?: string | null;
  }): Promise<ProviderPaymentSearchResult> {
    const limit = input?.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new SubscriptionBillingConflictError(
        "Provider payment search limit must be between 1 and 100."
      );
    }

    const query = input?.query?.trim() || null;
    const provider = input?.provider?.trim() || null;
    const reconciliationStatus =
      input?.reconciliationStatus ?? null;

    if (query && query.length > 200) {
      throw new SubscriptionBillingConflictError(
        "Provider payment search query is too long."
      );
    }
    if (provider && provider.length > 100) {
      throw new SubscriptionBillingConflictError(
        "Provider filter is too long."
      );
    }
    if (
      reconciliationStatus !== null &&
      reconciliationStatus !== "UNALLOCATED" &&
      reconciliationStatus !== "ALLOCATED" &&
      reconciliationStatus !== "REVIEW_REQUIRED"
    ) {
      throw new SubscriptionBillingConflictError(
        "Invalid provider payment reconciliation status."
      );
    }

    const clauses = ["p.source = 'PROVIDER'"];
    const params: unknown[] = [];

    if (query) {
      const escapedQuery = query.replace(
        /[\\%_]/g,
        (match) => "\\" + match
      );
      params.push("%" + escapedQuery + "%");
      const placeholder = "$" + String(params.length);
      clauses.push(
        "(" +
          "p.id::text ILIKE " +
          placeholder +
          " ESCAPE '\\\\' OR " +
          "p.provider_transaction_id ILIKE " +
          placeholder +
          " ESCAPE '\\\\' OR " +
          "COALESCE(p.metadata ->> 'paymentReference', '') ILIKE " +
          placeholder +
          " ESCAPE '\\\\'" +
          ")"
      );
    }

    if (provider) {
      params.push(provider);
      clauses.push(
        "upper(COALESCE(p.provider, '')) = upper($" +
          String(params.length) +
          ")"
      );
    }

    if (reconciliationStatus) {
      params.push(reconciliationStatus);
      clauses.push(
        "p.reconciliation_status = $" + String(params.length)
      );
    }

    if (input?.cursor) {
      const cursor = this.decodeProviderPaymentCursor(input.cursor);
      params.push(cursor.occurredAt);
      const occurredPlaceholder = "$" + String(params.length);
      params.push(cursor.id);
      const idPlaceholder = "$" + String(params.length);
      clauses.push(
        "(" +
          "p.occurred_at < " +
          occurredPlaceholder +
          "::timestamptz OR (" +
          "p.occurred_at = " +
          occurredPlaceholder +
          "::timestamptz AND p.id < " +
          idPlaceholder +
          "::uuid))"
      );
    }

    params.push(limit + 1);
    const limitPlaceholder = "$" + String(params.length);
    const result = await this.database.query<PaymentRow>(
      this.paymentSelectSql(
        "WHERE " +
          clauses.join(" AND ") +
          " ORDER BY p.occurred_at DESC, p.id DESC LIMIT " +
          limitPlaceholder
      ),
      params
    );

    const hasMore = result.rows.length > limit;
    const pageRows = result.rows.slice(0, limit);
    const items = pageRows.map((row) => {
      const metadata =
        typeof row.metadata === "object" &&
        row.metadata !== null &&
        !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : null;

      return {
        payment: this.mapPayment(row),
        paymentReference:
          typeof metadata?.paymentReference === "string"
            ? metadata.paymentReference
            : null
      };
    });

    const lastRow = pageRows.at(-1);
    return {
      items,
      nextCursor:
        hasMore && lastRow
          ? this.encodeProviderPaymentCursor(lastRow)
          : null
    };
  }

  async listProviderPaymentReviews(") + "%";
      params.push(pattern);
      const index = params.length;
      clauses.push(
        `(
          p.id::text ILIKE ${index} ESCAPE '\\'
          OR p.provider_transaction_id ILIKE ${index} ESCAPE '\\'
          OR COALESCE(p.metadata ->> 'paymentReference', '')
            ILIKE ${index} ESCAPE '\\'
        )`
      );
    }

    if (provider) {
      params.push(provider);
      clauses.push(
        "upper(COALESCE(p.provider, '')) = upper($" +
          String(params.length) +
          ")"
      );
    }

    if (reconciliationStatus) {
      params.push(reconciliationStatus);
      clauses.push(
        "p.reconciliation_status = $" + String(params.length)
      );
    }

    if (input?.cursor) {
      const cursor = this.decodeProviderPaymentCursor(input.cursor);
      params.push(cursor.occurredAt);
      const occurredIndex = params.length;
      params.push(cursor.id);
      const idIndex = params.length;
      clauses.push(
        `(
          p.occurred_at < ${occurredIndex}::timestamptz
          OR (
            p.occurred_at = ${occurredIndex}::timestamptz
            AND p.id < ${idIndex}::uuid
          )
        )`
      );
    }

    params.push(limit + 1);
    const result = await this.database.query<PaymentRow>(
      this.paymentSelectSql(
        "WHERE " +
          clauses.join(" AND ") +
          " ORDER BY p.occurred_at DESC, p.id DESC LIMIT $" +
          String(params.length)
      ),
      params
    );

    const hasMore = result.rows.length > limit;
    const pageRows = result.rows.slice(0, limit);
    const items = pageRows.map((row) => {
      const metadata =
        typeof row.metadata === "object" &&
        row.metadata !== null &&
        !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : null;

      return {
        payment: this.mapPayment(row),
        paymentReference:
          typeof metadata?.paymentReference === "string"
            ? metadata.paymentReference
            : null
      };
    });

    const lastRow = pageRows.at(-1);
    return {
      items,
      nextCursor:
        hasMore && lastRow
          ? this.encodeProviderPaymentCursor(lastRow)
          : null
    };
  }

  async listProviderPaymentReviews(
    limit = 200
  ): Promise<ProviderPaymentReviewView[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const result = await this.database.query<PaymentRow>(
      this.paymentSelectSql(
        `WHERE p.source = 'PROVIDER'
           AND p.status = 'SUCCEEDED'
           AND p.reconciliation_status = 'REVIEW_REQUIRED'
         ORDER BY p.occurred_at DESC, p.id DESC
         LIMIT $1`
      ),
      [safeLimit]
    );

    return result.rows.map((row) => {
      const metadata =
        typeof row.metadata === "object" &&
        row.metadata !== null &&
        !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : null;
      return {
        payment: this.mapPayment(row),
        paymentReference:
          typeof metadata?.paymentReference === "string"
            ? metadata.paymentReference
            : null
      };
    });
  }

  async listReconciliationInvoices(
    limit = 300
  ): Promise<SubscriptionInvoiceView[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const result = await this.database.query<InvoiceRow>(
      this.invoiceSelectSql(
        `WHERE i.status IN ('OPEN', 'PARTIALLY_PAID')
         ORDER BY i.due_at, i.period_start, i.id
         LIMIT $1`
      ),
      [safeLimit]
    );

    return result.rows
      .map((row) => this.mapInvoice(row))
      .filter((invoice) => invoice.remainingAmountVnd > 0);
  }

  ingestProviderPayment(input: {
    provider: string;
    providerTransactionId: string;
    amountVnd: number;
    occurredAt: string;
    paymentReference?: string | null;
    metadata?: unknown;
  }): Promise<ProviderPaymentIngestionView> {
    return this.database.withTransaction((client) =>
      this.ingestProviderPaymentInTransaction(client, input)
    );
  }

  async ingestProviderPaymentInTransaction(
    client: PoolClient,
    input: {
      provider: string;
      providerTransactionId: string;
      amountVnd: number;
      occurredAt: string;
      paymentReference?: string | null;
      metadata?: unknown;
    }
  ): Promise<ProviderPaymentIngestionView> {
    const provider = input.provider.trim();
    const providerTransactionId = input.providerTransactionId.trim();
    const paymentReference =
      input.paymentReference?.trim().toUpperCase() || null;

    if (!provider || !providerTransactionId) {
      throw new SubscriptionBillingConflictError(
        "Provider and providerTransactionId are required."
      );
    }
    if (!Number.isInteger(input.amountVnd) || input.amountVnd <= 0) {
      throw new SubscriptionBillingConflictError(
        "Provider payment amount must be a positive integer VND amount."
      );
    }

    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new SubscriptionBillingConflictError(
        "Provider payment occurredAt must be a valid date-time."
      );
    }

    const existingResult = await client.query<PaymentRow>(
      this.paymentSelectSql(
        "WHERE p.provider = $1 AND p.provider_transaction_id = $2"
      ),
      [provider, providerTransactionId]
    );
    const existing = existingResult.rows[0];
    if (existing) {
      const metadata =
        typeof existing.metadata === "object" &&
        existing.metadata !== null &&
        !Array.isArray(existing.metadata)
          ? (existing.metadata as Record<string, unknown>)
          : null;
      const existingReference =
        typeof metadata?.paymentReference === "string"
          ? metadata.paymentReference
          : null;

      if (
        Number(existing.amount_vnd) !== input.amountVnd ||
        existing.source !== "PROVIDER" ||
        existing.occurred_at.getTime() !== occurredAt.getTime() ||
        existingReference !== paymentReference
      ) {
        throw new SubscriptionBillingConflictError(
          "Provider transaction id was reused with different payment content."
        );
      }
      return this.providerIngestionViewForPayment(client, existing);
    }

    let invoice: InvoiceRow | null = null;
    if (paymentReference) {
      const lookupResult = await client.query<InvoiceRow>(
        this.invoiceSelectSql(
          "WHERE i.payment_reference = $1"
        ),
        [paymentReference]
      );
      const lookup = lookupResult.rows[0] ?? null;

      if (lookup) {
        await this.lockOrganization(client, lookup.organization_id);
        const invoiceResult = await client.query<InvoiceRow>(
          this.invoiceSelectSql(
            "WHERE i.organization_id = $1 AND i.id = $2 FOR UPDATE OF i"
          ),
          [lookup.organization_id, lookup.id]
        );
        invoice = invoiceResult.rows[0] ?? null;
      }
    }

    const safeToAllocate =
      invoice !== null &&
      invoice.status !== "VOID" &&
      invoice.status !== "PAID" &&
      Number(invoice.remaining_amount_vnd) > 0 &&
      input.amountVnd <= Number(invoice.remaining_amount_vnd);

    const organizationId = invoice?.organization_id ?? null;
    const subscriptionId = invoice?.subscription_id ?? null;
    const reconciliationStatus = safeToAllocate
      ? "ALLOCATED"
      : "REVIEW_REQUIRED";

    const paymentResult = await client.query<PaymentRow>(
      `WITH inserted AS (
         INSERT INTO saas_subscription_payments (
           organization_id,
           subscription_id,
           amount_vnd,
           status,
           reconciliation_status,
           source,
           provider,
           provider_transaction_id,
           idempotency_key,
           occurred_at,
           metadata
         )
         VALUES (
           $1,
           $2,
           $3,
           'SUCCEEDED',
           $4,
           'PROVIDER',
           $5,
           $6,
           $7,
           $8,
           $9::jsonb
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
         '0'::text AS allocated_amount_vnd,
         p.amount_vnd::text AS unallocated_amount_vnd
       FROM inserted p`,
      [
        organizationId,
        subscriptionId,
        input.amountVnd,
        reconciliationStatus,
        provider,
        providerTransactionId,
        "provider:" + provider + ":" + providerTransactionId,
        occurredAt,
        JSON.stringify({
          ...(typeof input.metadata === "object" &&
          input.metadata !== null &&
          !Array.isArray(input.metadata)
            ? input.metadata
            : {}),
          paymentReference
        })
      ]
    );
    const payment = paymentResult.rows[0]!;

    if (!safeToAllocate || !invoice) {
      return {
        payment: this.mapPayment(payment),
        invoice: invoice ? this.mapInvoice(invoice) : null,
        allocation: null,
        matchedBy: invoice ? "PAYMENT_REFERENCE" : null
      };
    }

    const allocationResult = await client.query<AllocationRow>(
      `INSERT INTO saas_subscription_payment_allocations (
         organization_id,
         payment_id,
         invoice_id,
         amount_vnd,
         allocated_by_user_id,
         reason
       )
       VALUES ($1, $2, $3, $4, NULL, $5)
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
        invoice.organization_id,
        payment.id,
        invoice.id,
        input.amountVnd,
        "Auto-matched unique SaaS payment reference " +
          invoice.payment_reference
      ]
    );
    const allocation = allocationResult.rows[0]!;

    const remainingAfter =
      Number(invoice.remaining_amount_vnd) - input.amountVnd;
    const invoiceStatus =
      remainingAfter === 0 ? "PAID" : "PARTIALLY_PAID";

    await client.query(
      `UPDATE saas_subscription_invoices
       SET status = $3,
           paid_at = CASE
             WHEN $3 = 'PAID' THEN COALESCE(paid_at, $4)
             ELSE NULL
           END,
           updated_at = now()
       WHERE organization_id = $1
         AND id = $2`,
      [
        invoice.organization_id,
        invoice.id,
        invoiceStatus,
        occurredAt
      ]
    );

    if (invoiceStatus === "PAID") {
      await this.activatePaidPeriodInTransaction(
        client,
        invoice.organization_id
      );
    }

    await this.insertSystemAudit(client, {
      organizationId: invoice.organization_id,
      action: "SUBSCRIPTION_PROVIDER_PAYMENT_ALLOCATED",
      targetType: "SAAS_SUBSCRIPTION_INVOICE",
      targetKey: invoice.id,
      beforeState: {
        invoiceStatus: invoice.status,
        paidAmountVnd: Number(invoice.paid_amount_vnd),
        remainingAmountVnd: Number(invoice.remaining_amount_vnd)
      },
      afterState: {
        invoiceStatus,
        remainingAmountVnd: remainingAfter,
        paymentId: payment.id,
        allocationId: allocation.id,
        provider,
        providerTransactionId
      },
      reason: "Unique provider payment reference auto-match."
    });

    return this.providerIngestionViewForPayment(client, payment);
  }

  async allocateProviderPaymentInTransaction(
    client: PoolClient,
    input: {
      paymentId: string;
      invoiceId: string;
      amountVnd: number;
      allocatedByUserId: string;
      reason: string;
    }
  ): Promise<BillingSettlementView> {
    const reason = input.reason.trim();
    if (!Number.isInteger(input.amountVnd) || input.amountVnd <= 0) {
      throw new SubscriptionBillingConflictError(
        "Allocation amount must be a positive integer VND amount."
      );
    }
    if (reason.length < 3) {
      throw new SubscriptionBillingConflictError(
        "Provider payment allocation reason is required."
      );
    }

    const invoiceLookup = await client.query<InvoiceRow>(
      this.invoiceSelectSql("WHERE i.id = $1"),
      [input.invoiceId]
    );
    const lookup = invoiceLookup.rows[0];
    if (!lookup) {
      throw new SubscriptionBillingNotFoundError(
        "Subscription invoice was not found."
      );
    }

    await this.lockOrganization(client, lookup.organization_id);

    const invoiceResult = await client.query<InvoiceRow>(
      this.invoiceSelectSql(
        "WHERE i.organization_id = $1 AND i.id = $2 FOR UPDATE OF i"
      ),
      [lookup.organization_id, input.invoiceId]
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice) {
      throw new SubscriptionBillingNotFoundError(
        "Subscription invoice was not found after organization lock."
      );
    }
    if (
      invoice.status === "VOID" ||
      invoice.status === "PAID" ||
      Number(invoice.remaining_amount_vnd) <= 0
    ) {
      throw new SubscriptionBillingConflictError(
        "Subscription invoice cannot receive another allocation."
      );
    }

    const paymentResult = await client.query<PaymentRow>(
      this.paymentSelectSql(
        "WHERE p.id = $1 FOR UPDATE OF p"
      ),
      [input.paymentId]
    );
    const payment = paymentResult.rows[0];
    if (!payment) {
      throw new SubscriptionBillingNotFoundError(
        "Provider payment transaction was not found."
      );
    }
    if (payment.source !== "PROVIDER" || payment.status !== "SUCCEEDED") {
      throw new SubscriptionBillingConflictError(
        "Only successful provider payments can be reconciled."
      );
    }
    if (
      payment.organization_id !== null &&
      (
        payment.organization_id !== invoice.organization_id ||
        payment.subscription_id !== invoice.subscription_id
      )
    ) {
      throw new SubscriptionBillingConflictError(
        "Provider payment is already assigned to a different organization subscription."
      );
    }

    const unallocatedAmount = Number(payment.unallocated_amount_vnd);
    if (input.amountVnd > unallocatedAmount) {
      throw new SubscriptionBillingConflictError(
        "Allocation exceeds provider payment unallocated balance."
      );
    }
    if (input.amountVnd > Number(invoice.remaining_amount_vnd)) {
      throw new SubscriptionBillingConflictError(
        "Allocation exceeds subscription invoice remaining balance."
      );
    }

    await client.query(
      `UPDATE saas_subscription_payments
       SET organization_id = $2,
           subscription_id = $3
       WHERE id = $1`,
      [
        payment.id,
        invoice.organization_id,
        invoice.subscription_id
      ]
    );

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
        invoice.organization_id,
        payment.id,
        invoice.id,
        input.amountVnd,
        input.allocatedByUserId,
        reason
      ]
    );
    const allocation = allocationResult.rows[0]!;

    const paymentUnallocatedAfter =
      unallocatedAmount - input.amountVnd;
    await client.query(
      `UPDATE saas_subscription_payments
       SET reconciliation_status = $2
       WHERE id = $1`,
      [
        payment.id,
        paymentUnallocatedAfter === 0
          ? "ALLOCATED"
          : "REVIEW_REQUIRED"
      ]
    );

    const invoiceRemainingAfter =
      Number(invoice.remaining_amount_vnd) - input.amountVnd;
    const invoiceStatus =
      invoiceRemainingAfter === 0
        ? "PAID"
        : "PARTIALLY_PAID";
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
      [
        invoice.organization_id,
        invoice.id,
        invoiceStatus
      ]
    );

    if (invoiceStatus === "PAID") {
      await this.activatePaidPeriodInTransaction(
        client,
        invoice.organization_id
      );
    }

    await this.insertSystemAudit(client, {
      organizationId: invoice.organization_id,
      action: "SUBSCRIPTION_PROVIDER_PAYMENT_RECONCILED",
      targetType: "SAAS_SUBSCRIPTION_PAYMENT",
      targetKey: payment.id,
      beforeState: {
        paymentReconciliationStatus: payment.reconciliation_status,
        paymentUnallocatedAmountVnd: unallocatedAmount,
        invoiceStatus: invoice.status,
        invoiceRemainingAmountVnd: Number(
          invoice.remaining_amount_vnd
        )
      },
      afterState: {
        paymentReconciliationStatus:
          paymentUnallocatedAfter === 0
            ? "ALLOCATED"
            : "REVIEW_REQUIRED",
        paymentUnallocatedAmountVnd: paymentUnallocatedAfter,
        invoiceStatus,
        invoiceRemainingAmountVnd: invoiceRemainingAfter,
        allocationId: allocation.id
      },
      reason
    });

    const refreshedPaymentResult = await client.query<PaymentRow>(
      this.paymentSelectSql("WHERE p.id = $1"),
      [payment.id]
    );
    const refreshedPayment = refreshedPaymentResult.rows[0];
    if (!refreshedPayment) {
      throw new SubscriptionBillingNotFoundError(
        "Provider payment was not found after reconciliation."
      );
    }

    return this.settlementView(
      client,
      refreshedPayment,
      allocation,
      invoice.id
    );
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

  async setCancellationScheduleInTransaction(
    client: PoolClient,
    input: {
      organizationId: string;
      cancelAtPeriodEnd: boolean;
      expectedVersion: number;
      reason: string;
    }
  ): Promise<SubscriptionCancellationScheduleView> {
    const reason = input.reason.trim();
    if (reason.length < 3) {
      throw new SubscriptionBillingConflictError(
        "Subscription cancellation reason is required."
      );
    }
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new SubscriptionBillingConflictError(
        "expectedVersion must be a positive integer."
      );
    }

    await this.lockOrganization(client, input.organizationId);
    const subscription = await this.loadSubscriptionForUpdate(
      client,
      input.organizationId
    );

    if (
      subscription.status !== "ACTIVE" &&
      subscription.status !== "TRIALING"
    ) {
      throw new SubscriptionBillingConflictError(
        "Scheduled cancellation is only available for ACTIVE or TRIALING subscriptions."
      );
    }
    if (subscription.version !== input.expectedVersion) {
      throw new SubscriptionBillingConflictError(
        "Subscription changed since it was loaded."
      );
    }
    if (
      subscription.cancel_at_period_end === input.cancelAtPeriodEnd
    ) {
      throw new SubscriptionBillingConflictError(
        input.cancelAtPeriodEnd
          ? "Subscription cancellation is already scheduled."
          : "Subscription cancellation is not scheduled."
      );
    }

    const effectiveAt =
      subscription.status === "TRIALING"
        ? subscription.trial_ends_at
        : subscription.current_period_end;

    if (!effectiveAt) {
      throw new SubscriptionBillingConfigurationError(
        "Subscription does not have a cancellation period end."
      );
    }

    let voidedInvoiceIds: string[] = [];
    let reopenedInvoiceIds: string[] = [];
    if (input.cancelAtPeriodEnd) {
      voidedInvoiceIds =
        await this.voidUnpaidFutureInvoicesInTransaction(
          client,
          subscription,
          effectiveAt
        );
    } else {
      reopenedInvoiceIds =
        await this.reopenCancellationVoidedInvoicesInTransaction(
          client,
          subscription,
          effectiveAt
        );
    }

    const updatedVersion = subscription.version + 1;
    await client.query(
      `UPDATE organization_subscriptions
       SET cancel_at_period_end = $2,
           version = $3,
           updated_at = now()
       WHERE organization_id = $1`,
      [
        input.organizationId,
        input.cancelAtPeriodEnd,
        updatedVersion
      ]
    );

    await this.insertSystemAudit(client, {
      organizationId: input.organizationId,
      action: input.cancelAtPeriodEnd
        ? "SUBSCRIPTION_CANCELLATION_SCHEDULED"
        : "SUBSCRIPTION_CANCELLATION_SCHEDULE_REVOKED",
      targetType: "SAAS_SUBSCRIPTION",
      targetKey: subscription.id,
      beforeState: {
        status: subscription.status,
        version: subscription.version,
        cancelAtPeriodEnd: subscription.cancel_at_period_end
      },
      afterState: {
        status: subscription.status,
        version: updatedVersion,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        effectiveAt: effectiveAt.toISOString(),
        voidedInvoiceIds,
        reopenedInvoiceIds
      },
      reason
    });

    return {
      organizationId: subscription.organization_id,
      subscriptionId: subscription.id,
      status: subscription.status,
      version: updatedVersion,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      effectiveAt: effectiveAt.toISOString(),
      voidedInvoiceIds,
      reopenedInvoiceIds
    };
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
             s.cancel_at_period_end = false
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
             )
           )
           OR (
             s.cancel_at_period_end = true
             AND (
               (
                 s.status = 'TRIALING'
                 AND s.trial_ends_at IS NOT NULL
                 AND s.trial_ends_at <= now()
               )
               OR (
                 s.status <> 'TRIALING'
                 AND s.current_period_end IS NOT NULL
                 AND s.current_period_end <= now()
               )
             )
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
      const cancellation =
        await this.applyScheduledCancellationInTransaction(
          client,
          organizationId
        );
      if (cancellation) {
        return {
          invoice,
          activatedPaidPeriod: false,
          transition: cancellation
        };
      }

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

  private async applyScheduledCancellationInTransaction(
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
    if (
      subscription.status === "CANCELLED" ||
      !subscription.cancel_at_period_end
    ) {
      return null;
    }

    const effectiveAt =
      subscription.status === "TRIALING"
        ? subscription.trial_ends_at
        : subscription.current_period_end;

    if (!effectiveAt || effectiveAt.getTime() > Date.now()) {
      return null;
    }

    await this.voidUnpaidFutureInvoicesInTransaction(
      client,
      subscription,
      effectiveAt
    );

    const transition = transitionSubscription(
      {
        id: subscription.id,
        organizationId: subscription.organization_id,
        planId: subscription.plan_id,
        planVersionId: subscription.plan_version_id,
        status: subscription.status,
        version: subscription.version
      },
      "CANCELLED",
      "Scheduled subscription cancellation reached period end."
    );

    await client.query(
      `UPDATE organization_subscriptions
       SET status = 'CANCELLED',
           cancel_at_period_end = false,
           version = $2,
           updated_at = now()
       WHERE organization_id = $1`,
      [organizationId, transition.subscription.version]
    );

    await this.insertSystemAudit(client, {
      organizationId,
      action: "SUBSCRIPTION_SCHEDULED_CANCELLATION_APPLIED",
      targetType: "SAAS_SUBSCRIPTION",
      targetKey: subscription.id,
      beforeState: {
        status: subscription.status,
        version: subscription.version,
        cancelAtPeriodEnd: true,
        effectiveAt: effectiveAt.toISOString()
      },
      afterState: {
        status: "CANCELLED",
        version: transition.subscription.version,
        cancelAtPeriodEnd: false
      },
      reason: "Scheduled subscription cancellation reached period end."
    });

    return {
      from: subscription.status,
      to: "CANCELLED",
      version: transition.subscription.version
    };
  }

  private async voidUnpaidFutureInvoicesInTransaction(
    client: PoolClient,
    subscription: SubscriptionBillingRow,
    effectiveAt: Date
  ): Promise<string[]> {
    const invoiceResult = await client.query<InvoiceRow>(
      this.invoiceSelectSql(
        `WHERE i.organization_id = $1
           AND i.subscription_id = $2
           AND i.period_start >= $3
           AND i.status <> 'VOID'
         ORDER BY i.period_start, i.id
         FOR UPDATE OF i`
      ),
      [
        subscription.organization_id,
        subscription.id,
        effectiveAt
      ]
    );

    const funded = invoiceResult.rows.find(
      (invoice) => Number(invoice.paid_amount_vnd) > 0
    );
    if (funded) {
      throw new SubscriptionBillingConflictError(
        "Cannot schedule/apply cancellation because a future billing period already has allocated payment."
      );
    }

    const ids = invoiceResult.rows.map((invoice) => invoice.id);
    if (ids.length === 0) {
      return [];
    }

    await client.query(
      `UPDATE saas_subscription_invoices
       SET status = 'VOID',
           paid_at = NULL,
           void_reason = 'SCHEDULED_CANCELLATION',
           voided_at = now(),
           updated_at = now()
       WHERE organization_id = $1
         AND id = ANY($2::uuid[])`,
      [subscription.organization_id, ids]
    );

    return ids;
  }

  private async reopenCancellationVoidedInvoicesInTransaction(
    client: PoolClient,
    subscription: SubscriptionBillingRow,
    effectiveAt: Date
  ): Promise<string[]> {
    const result = await client.query<QueryResultRow & { id: string }>(
      `UPDATE saas_subscription_invoices
       SET status = 'OPEN',
           void_reason = NULL,
           voided_at = NULL,
           updated_at = now()
       WHERE organization_id = $1
         AND subscription_id = $2
         AND period_start >= $3
         AND status = 'VOID'
         AND void_reason = 'SCHEDULED_CANCELLATION'
       RETURNING id::text`,
      [
        subscription.organization_id,
        subscription.id,
        effectiveAt
      ]
    );

    return result.rows.map((row) => row.id);
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

  async getProviderPaymentIngestionByIdInTransaction(
    client: PoolClient,
    paymentId: string
  ): Promise<ProviderPaymentIngestionView> {
    const result = await client.query<PaymentRow>(
      this.paymentSelectSql("WHERE p.id = $1"),
      [paymentId]
    );
    const payment = result.rows[0];
    if (!payment) {
      throw new SubscriptionBillingNotFoundError(
        "Provider payment was not found."
      );
    }
    if (payment.source !== "PROVIDER") {
      throw new SubscriptionBillingConflictError(
        "Payment is not a provider transaction."
      );
    }

    return this.providerIngestionViewForPayment(client, payment);
  }

  private async providerIngestionViewForPayment(
    client: PoolClient,
    payment: PaymentRow
  ): Promise<ProviderPaymentIngestionView> {
    const refreshedPaymentResult = await client.query<PaymentRow>(
      this.paymentSelectSql("WHERE p.id = $1"),
      [payment.id]
    );
    const refreshedPayment = refreshedPaymentResult.rows[0];
    if (!refreshedPayment) {
      throw new SubscriptionBillingNotFoundError(
        "Provider payment was not found after ingestion."
      );
    }

    const allocationResult = await client.query<AllocationRow>(
      this.allocationSelectSql(
        "WHERE a.payment_id = $1 ORDER BY a.created_at LIMIT 1"
      ),
      [payment.id]
    );
    const allocation = allocationResult.rows[0] ?? null;

    if (!allocation) {
      const metadata =
        typeof refreshedPayment.metadata === "object" &&
        refreshedPayment.metadata !== null &&
        !Array.isArray(refreshedPayment.metadata)
          ? (refreshedPayment.metadata as Record<string, unknown>)
          : null;
      const paymentReference =
        typeof metadata?.paymentReference === "string"
          ? metadata.paymentReference
          : null;

      if (paymentReference) {
        const invoiceResult = await client.query<InvoiceRow>(
          this.invoiceSelectSql(
            "WHERE i.payment_reference = $1"
          ),
          [paymentReference]
        );
        const invoice = invoiceResult.rows[0] ?? null;
        return {
          payment: this.mapPayment(refreshedPayment),
          invoice: invoice ? this.mapInvoice(invoice) : null,
          allocation: null,
          matchedBy: invoice ? "PAYMENT_REFERENCE" : null
        };
      }

      return {
        payment: this.mapPayment(refreshedPayment),
        invoice: null,
        allocation: null,
        matchedBy: null
      };
    }

    const invoiceResult = await client.query<InvoiceRow>(
      this.invoiceSelectSql(
        "WHERE i.id = $1 AND i.organization_id = $2"
      ),
      [allocation.invoice_id, allocation.organization_id]
    );
    const invoice = invoiceResult.rows[0] ?? null;

    return {
      payment: this.mapPayment(refreshedPayment),
      invoice: invoice ? this.mapInvoice(invoice) : null,
      allocation: this.mapAllocation(allocation),
      matchedBy: "PAYMENT_REFERENCE"
    };
  }

  private async settlementView(
    client: PoolClient,
    payment: PaymentRow,
    allocation: AllocationRow,
    invoiceId: string
  ): Promise<BillingSettlementView> {
    if (!payment.organization_id || !payment.subscription_id) {
      throw new SubscriptionBillingConflictError(
        "Allocated payment must be assigned to an organization subscription."
      );
    }

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

  private encodeProviderPaymentCursor(row: PaymentRow): string {
    return Buffer.from(
      JSON.stringify({
        occurredAt: row.occurred_at.toISOString(),
        id: row.id
      }),
      "utf8"
    ).toString("base64url");
  }

  private decodeProviderPaymentCursor(value: string): {
    occurredAt: string;
    id: string;
  } {
    if (value.length > 1000) {
      throw new SubscriptionBillingConflictError(
        "Provider payment cursor is too long."
      );
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(value, "base64url").toString("utf8")
      ) as { occurredAt?: unknown; id?: unknown };

      if (
        typeof parsed.occurredAt !== "string" ||
        Number.isNaN(new Date(parsed.occurredAt).getTime()) ||
        typeof parsed.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          parsed.id
        )
      ) {
        throw new Error("invalid cursor");
      }

      return {
        occurredAt: new Date(parsed.occurredAt).toISOString(),
        id: parsed.id
      };
    } catch {
      throw new SubscriptionBillingConflictError(
        "Invalid provider payment cursor."
      );
    }
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
       i.payment_reference,
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
      paymentReference: row.payment_reference,
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
