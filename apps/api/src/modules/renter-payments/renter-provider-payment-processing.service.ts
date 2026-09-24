import { createHash, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";
import {
  RenterPaymentWebhookConflictError,
  RenterPaymentWebhookInboxService
} from "./renter-payment-webhook-inbox.service.js";

export interface NormalizedRenterProviderPaymentInput {
  providerTransactionId: string;
  amountVnd: number;
  occurredAt: string;
  paymentReference?: string | null;
  destinationAccountNo?: string | null;
  payerName?: string | null;
  note?: string | null;
  metadata?: unknown;
}

type InvoiceRow = QueryResultRow & {
  id: string;
  organization_id: string;
  invoice_number: string;
  status: "DRAFT" | "ISSUED" | "VOID";
  total_vnd: string;
  paid_vnd: string;
  remaining_vnd: string;
  collection_status: "UNPAID" | "PARTIALLY_PAID" | "PAID";
};

type PaymentRow = QueryResultRow & {
  id: string;
  organization_id: string;
  amount_vnd: string;
  occurred_at: Date;
  payment_reference: string | null;
  reconciliation_status: "ALLOCATED" | "REVIEW_REQUIRED";
};

@Injectable()
export class RenterProviderPaymentProcessingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly inbox: RenterPaymentWebhookInboxService
  ) {}

  claim(provider?: string) {
    return this.inbox.claim(provider);
  }

  processPayment(
    eventId: string,
    input: NormalizedRenterProviderPaymentInput
  ) {
    const normalized = this.normalize(input);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");

    return this.db.withTransaction(async (client) => {
      const event = await this.inbox.getForProcessingInTransaction(
        client,
        eventId
      );
      if (!event) {
        throw new RenterPaymentWebhookConflictError("Webhook was not found.");
      }

      if (
        event.processingStatus === "PROCESSED" ||
        event.processingStatus === "REVIEW_REQUIRED"
      ) {
        if (event.normalizedPaymentFingerprint !== fingerprint) {
          throw new RenterPaymentWebhookConflictError(
            "Completed webhook was replayed with different normalized payment content."
          );
        }
        return {
          event,
          paymentTransactionId: event.paymentTransactionId,
          allocated: event.processingStatus === "PROCESSED",
          replayed: true
        };
      }

      if (!normalized.paymentReference) {
        const completed = await this.inbox.completeNormalizedInTransaction(
          client,
          {
            eventId,
            outcome: "REVIEW_REQUIRED",
            ...normalized,
            fingerprint,
            errorCode: "RENTER_PAYMENT_REFERENCE_MISSING",
            errorMessage: "Provider payment does not contain a payment reference."
          }
        );
        return {
          event: completed,
          paymentTransactionId: null,
          allocated: false,
          replayed: false
        };
      }

      const invoiceResult = await client.query<InvoiceRow>(
        `SELECT
           id::text,
           organization_id::text,
           invoice_number,
           status,
           total_vnd::text,
           paid_vnd::text,
           remaining_vnd::text,
           collection_status
         FROM renter_invoices
         WHERE payment_reference = $1
         FOR UPDATE`,
        [normalized.paymentReference]
      );
      const invoice = invoiceResult.rows[0];

      if (!invoice) {
        const completed = await this.inbox.completeNormalizedInTransaction(
          client,
          {
            eventId,
            outcome: "REVIEW_REQUIRED",
            ...normalized,
            fingerprint,
            errorCode: "RENTER_PAYMENT_REFERENCE_NOT_FOUND",
            errorMessage: "Payment reference does not match a renter invoice."
          }
        );
        return {
          event: completed,
          paymentTransactionId: null,
          allocated: false,
          replayed: false
        };
      }

      const existingResult = await client.query<PaymentRow>(
        `SELECT
           id::text,
           organization_id::text,
           amount_vnd::text,
           occurred_at,
           payment_reference,
           reconciliation_status
         FROM renter_payment_transactions
         WHERE source = 'PROVIDER'
           AND provider = $1
           AND provider_transaction_id = $2
         FOR UPDATE`,
        [event.provider, normalized.providerTransactionId]
      );
      const existing = existingResult.rows[0];
      if (existing) {
        const same =
          existing.organization_id === invoice.organization_id &&
          Number(existing.amount_vnd) === normalized.amountVnd &&
          existing.occurred_at.toISOString() === normalized.occurredAt &&
          existing.payment_reference === normalized.paymentReference;
        const outcome =
          same && existing.reconciliation_status === "ALLOCATED"
            ? "PROCESSED"
            : "REVIEW_REQUIRED";
        const completed = await this.inbox.completeNormalizedInTransaction(
          client,
          {
            eventId,
            outcome,
            ...normalized,
            fingerprint,
            organizationId: same ? existing.organization_id : null,
            paymentTransactionId: same ? existing.id : null,
            errorCode: same
              ? existing.reconciliation_status === "REVIEW_REQUIRED"
                ? "RENTER_PAYMENT_REQUIRES_REVIEW"
                : null
              : "RENTER_PROVIDER_TRANSACTION_CONFLICT",
            errorMessage: same
              ? existing.reconciliation_status === "REVIEW_REQUIRED"
                ? "Existing provider transaction still requires manual review."
                : null
              : "Provider transaction id was reused with different payment content."
          }
        );
        return {
          event: completed,
          paymentTransactionId: same ? existing.id : null,
          allocated: outcome === "PROCESSED",
          replayed: same
        };
      }

      let destinationAccountIssue: string | null = null;
      if (normalized.destinationAccountNo) {
        const paymentProfile = await client.query<
          QueryResultRow & { account_no: string; is_active: boolean }
        >(
          `SELECT account_no, is_active
           FROM organization_payment_profiles
           WHERE organization_id = $1::uuid
           LIMIT 1`,
          [invoice.organization_id]
        );
        const profile = paymentProfile.rows[0];
        if (!profile || !profile.is_active) {
          destinationAccountIssue =
            "RENTER_PAYMENT_DESTINATION_PROFILE_MISSING";
        } else if (profile.account_no !== normalized.destinationAccountNo) {
          destinationAccountIssue =
            "RENTER_PAYMENT_DESTINATION_ACCOUNT_MISMATCH";
        }
      }

      const transactionId = randomUUID();
      const canAllocate =
        destinationAccountIssue === null &&
        invoice.status === "ISSUED" &&
        invoice.collection_status !== "PAID" &&
        normalized.amountVnd <= Number(invoice.remaining_vnd);

      await client.query(
        `INSERT INTO renter_payment_transactions (
           id,
           organization_id,
           source,
           provider,
           provider_transaction_id,
           payment_reference,
           reconciliation_status,
           amount_vnd,
           occurred_at,
           payer_name,
           note,
           status,
           raw_payload
         )
         VALUES (
           $1, $2, 'PROVIDER', $3, $4, $5, $6, $7, $8::timestamptz,
           $9, $10, 'POSTED', $11::jsonb
         )`,
        [
          transactionId,
          invoice.organization_id,
          event.provider,
          normalized.providerTransactionId,
          normalized.paymentReference,
          canAllocate ? "ALLOCATED" : "REVIEW_REQUIRED",
          normalized.amountVnd,
          normalized.occurredAt,
          normalized.payerName,
          normalized.note,
          JSON.stringify({
            ...(typeof input.metadata === "object" &&
            input.metadata !== null &&
            !Array.isArray(input.metadata)
              ? input.metadata
              : {}),
            webhookEventId: event.id,
            providerEventId: event.providerEventId,
            rawBodySha256: event.rawBodySha256
          })
        ]
      );

      if (!canAllocate) {
        const reason =
          destinationAccountIssue ??
          (invoice.status !== "ISSUED"
            ? "RENTER_INVOICE_NOT_ISSUED"
            : invoice.collection_status === "PAID"
              ? "RENTER_INVOICE_ALREADY_PAID"
              : "RENTER_PAYMENT_OVERPAYMENT");

        await this.auditSystem(
          client,
          invoice.organization_id,
          "RENTER_PROVIDER_PAYMENT_REVIEW_REQUIRED",
          invoice.id,
          {
            transactionId,
            provider: event.provider,
            providerTransactionId: normalized.providerTransactionId,
            paymentReference: normalized.paymentReference,
            amountVnd: normalized.amountVnd,
            remainingVnd: Number(invoice.remaining_vnd),
            reason
          }
        );

        const completed = await this.inbox.completeNormalizedInTransaction(
          client,
          {
            eventId,
            outcome: "REVIEW_REQUIRED",
            ...normalized,
            fingerprint,
            organizationId: invoice.organization_id,
            paymentTransactionId: transactionId,
            errorCode: reason,
            errorMessage:
              reason === "RENTER_PAYMENT_OVERPAYMENT"
                ? "Provider payment exceeds invoice remaining amount."
                : reason === "RENTER_PAYMENT_DESTINATION_ACCOUNT_MISMATCH"
                  ? "Provider payment was received by a different bank account than the organization's active payment profile."
                  : reason === "RENTER_PAYMENT_DESTINATION_PROFILE_MISSING"
                    ? "Organization payment profile is missing or inactive, so the destination account cannot be verified."
                    : "Invoice is not eligible for automatic allocation."
          }
        );
        return {
          event: completed,
          paymentTransactionId: transactionId,
          allocated: false,
          replayed: false
        };
      }

      const allocationId = randomUUID();
      await client.query(
        `INSERT INTO renter_payment_allocations (
           id,
           organization_id,
           payment_transaction_id,
           invoice_id,
           amount_vnd,
           allocation_type,
           created_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5, 'AUTO', NULL)`,
        [
          allocationId,
          invoice.organization_id,
          transactionId,
          invoice.id,
          normalized.amountVnd
        ]
      );

      const paidResult = await client.query<QueryResultRow & { paid_vnd: string }>(
        `SELECT COALESCE(sum(a.amount_vnd), 0)::text AS paid_vnd
         FROM renter_payment_allocations a
         JOIN renter_payment_transactions t
           ON t.organization_id = a.organization_id
          AND t.id = a.payment_transaction_id
          AND t.status = 'POSTED'
         WHERE a.organization_id = $1::uuid
           AND a.invoice_id = $2::uuid`,
        [invoice.organization_id, invoice.id]
      );
      const paidVnd = Number(paidResult.rows[0]?.paid_vnd ?? "0");
      const totalVnd = Number(invoice.total_vnd);
      if (paidVnd > totalVnd) {
        throw new RenterPaymentWebhookConflictError(
          "Payment allocations exceed renter invoice total."
        );
      }
      const remainingVnd = totalVnd - paidVnd;
      const collectionStatus =
        remainingVnd === 0
          ? "PAID"
          : paidVnd === 0
            ? "UNPAID"
            : "PARTIALLY_PAID";

      await client.query(
        `UPDATE renter_invoices
         SET paid_vnd = $3,
             remaining_vnd = $4,
             collection_status = $5,
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid`,
        [
          invoice.organization_id,
          invoice.id,
          paidVnd,
          remainingVnd,
          collectionStatus
        ]
      );

      await this.auditSystem(
        client,
        invoice.organization_id,
        "RENTER_PROVIDER_PAYMENT_AUTO_ALLOCATED",
        invoice.id,
        {
          transactionId,
          allocationId,
          provider: event.provider,
          providerTransactionId: normalized.providerTransactionId,
          paymentReference: normalized.paymentReference,
          amountVnd: normalized.amountVnd,
          paidVnd,
          remainingVnd,
          collectionStatus
        }
      );

      const completed = await this.inbox.completeNormalizedInTransaction(
        client,
        {
          eventId,
          outcome: "PROCESSED",
          ...normalized,
          fingerprint,
          organizationId: invoice.organization_id,
          paymentTransactionId: transactionId
        }
      );

      return {
        event: completed,
        paymentTransactionId: transactionId,
        allocationId,
        invoiceId: invoice.id,
        collectionStatus,
        paidVnd,
        remainingVnd,
        allocated: true,
        replayed: false
      };
    });
  }

  completeWithoutPayment(input: {
    eventId: string;
    outcome: "REVIEW_REQUIRED" | "IGNORED" | "FAILED";
    errorCode?: string | null;
    errorMessage?: string | null;
  }) {
    return this.inbox.completeWithoutPayment(input);
  }

  private normalize(input: NormalizedRenterProviderPaymentInput) {
    const providerTransactionId = input.providerTransactionId.trim();
    if (!providerTransactionId) {
      throw new RenterPaymentWebhookConflictError(
        "providerTransactionId is required."
      );
    }
    if (!Number.isSafeInteger(input.amountVnd) || input.amountVnd <= 0) {
      throw new RenterPaymentWebhookConflictError(
        "amountVnd must be a positive integer VND amount."
      );
    }
    const occurred = new Date(input.occurredAt);
    if (Number.isNaN(occurred.getTime())) {
      throw new RenterPaymentWebhookConflictError(
        "occurredAt must be a valid date-time."
      );
    }
    const paymentReference =
      input.paymentReference?.trim().toUpperCase() || null;
    const destinationAccountNo =
      input.destinationAccountNo?.trim() || null;
    return {
      providerTransactionId,
      amountVnd: input.amountVnd,
      occurredAt: occurred.toISOString(),
      paymentReference,
      destinationAccountNo,
      payerName: input.payerName?.trim() || null,
      note: input.note?.trim() || null
    };
  }

  private async auditSystem(
    client: PoolClient,
    organizationId: string,
    action: string,
    invoiceId: string,
    metadata: Readonly<Record<string, unknown>>
  ) {
    await client.query(
      `INSERT INTO audit_events (
         organization_id,
         actor_user_id,
         action,
         resource_type,
         resource_id,
         metadata
       )
       VALUES ($1, NULL, $2, 'RENTER_INVOICE', $3, $4::jsonb)`,
      [organizationId, action, invoiceId, JSON.stringify(metadata)]
    );
  }
}
