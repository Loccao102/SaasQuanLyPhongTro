import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { SubscriptionBillingService } from "../commercial/application/subscription-billing.service.js";
import { DatabaseService } from "../database/database.service.js";
import {
  BillingWebhookConflictError,
  SaasBillingWebhookInboxService
} from "./saas-billing-webhook-inbox.service.js";

export interface NormalizedSaasProviderPaymentInput {
  providerTransactionId: string;
  amountVnd: number;
  occurredAt: string;
  paymentReference?: string | null;
  metadata?: unknown;
}

@Injectable()
export class SaasBillingWebhookProcessingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly inbox: SaasBillingWebhookInboxService,
    private readonly billing: SubscriptionBillingService
  ) {}

  claim(provider?: string) {
    return this.inbox.claimNext(provider);
  }

  processPayment(
    eventId: string,
    input: NormalizedSaasProviderPaymentInput
  ) {
    const normalized = this.normalizePayment(input);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          providerTransactionId: normalized.providerTransactionId,
          amountVnd: normalized.amountVnd,
          occurredAt: normalized.occurredAt,
          paymentReference: normalized.paymentReference
        })
      )
      .digest("hex");

    return this.database.withTransaction(async (client) => {
      const event =
        await this.inbox.getPaymentProcessingEventInTransaction(
          client,
          eventId
        );
      if (!event) {
        throw new BillingWebhookConflictError(
          "Billing webhook event was not found."
        );
      }

      if (event.processingStatus === "PROCESSED") {
        if (
          event.normalizedPaymentFingerprint !== fingerprint ||
          !event.paymentId
        ) {
          throw new BillingWebhookConflictError(
            "Processed webhook event was replayed with different normalized payment content."
          );
        }

        const ingestion =
          await this.billing.getProviderPaymentIngestionByIdInTransaction(
            client,
            event.paymentId
          );
        return {
          event,
          ingestion,
          replayed: true
        };
      }

      const ingestion =
        await this.billing.ingestProviderPaymentInTransaction(client, {
          provider: event.provider,
          providerTransactionId: normalized.providerTransactionId,
          amountVnd: normalized.amountVnd,
          occurredAt: normalized.occurredAt,
          paymentReference: normalized.paymentReference,
          metadata: {
            ...(typeof input.metadata === "object" &&
            input.metadata !== null &&
            !Array.isArray(input.metadata)
              ? input.metadata
              : {}),
            webhookEventId: event.id,
            providerEventId: event.providerEventId,
            rawBodySha256: event.rawBodySha256
          }
        });

      const completed =
        await this.inbox.completePaymentInTransaction(client, {
          eventId: event.id,
          paymentId: ingestion.payment.id,
          normalizedPaymentFingerprint: fingerprint
        });

      return {
        event: completed,
        ingestion,
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
    return this.inbox.complete(input);
  }

  private normalizePayment(
    input: NormalizedSaasProviderPaymentInput
  ): {
    providerTransactionId: string;
    amountVnd: number;
    occurredAt: string;
    paymentReference: string | null;
  } {
    const providerTransactionId = input.providerTransactionId.trim();
    if (!providerTransactionId) {
      throw new BillingWebhookConflictError(
        "providerTransactionId is required."
      );
    }
    if (!Number.isInteger(input.amountVnd) || input.amountVnd <= 0) {
      throw new BillingWebhookConflictError(
        "amountVnd must be a positive integer VND amount."
      );
    }

    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new BillingWebhookConflictError(
        "occurredAt must be a valid date-time."
      );
    }

    return {
      providerTransactionId,
      amountVnd: input.amountVnd,
      occurredAt: occurredAt.toISOString(),
      paymentReference:
        input.paymentReference?.trim().toUpperCase() || null
    };
  }
}
