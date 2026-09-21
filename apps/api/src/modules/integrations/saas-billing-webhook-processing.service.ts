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
    return this.database.withTransaction(async (client) => {
      const event = await this.inbox.getProcessingEventInTransaction(
        client,
        eventId
      );
      if (!event) {
        throw new BillingWebhookConflictError(
          "Billing webhook event was not found."
        );
      }

      const ingestion =
        await this.billing.ingestProviderPaymentInTransaction(client, {
          provider: event.provider,
          providerTransactionId: input.providerTransactionId,
          amountVnd: input.amountVnd,
          occurredAt: input.occurredAt,
          paymentReference: input.paymentReference ?? null,
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

      const completed = await this.inbox.completeInTransaction(client, {
        eventId: event.id,
        outcome: "PROCESSED"
      });

      return {
        event: completed,
        ingestion
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
}
