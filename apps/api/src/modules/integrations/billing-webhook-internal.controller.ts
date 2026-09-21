import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  UseGuards
} from "@nestjs/common";
import { InternalServiceGuard } from "../internal/internal-service.guard.js";
import {
  type NormalizedSaasProviderPaymentInput,
  SaasBillingWebhookProcessingService
} from "./saas-billing-webhook-processing.service.js";

type ClaimInput = {
  provider?: string;
};

type OutcomeInput = {
  outcome?: "REVIEW_REQUIRED" | "IGNORED" | "FAILED";
  errorCode?: string | null;
  errorMessage?: string | null;
};

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(field + " is required.");
  }
  return value.trim();
}

@Controller("internal/billing-webhooks")
@UseGuards(InternalServiceGuard)
export class BillingWebhookInternalController {
  constructor(
    private readonly processing: SaasBillingWebhookProcessingService
  ) {}

  @Post("claim")
  claim(@Body() input: ClaimInput) {
    const provider =
      input.provider === undefined
        ? undefined
        : requireNonEmptyString(input.provider, "provider");
    return this.processing.claim(provider);
  }

  @Post(":eventId/payment")
  payment(
    @Param("eventId") eventId: string,
    @Body() input: NormalizedSaasProviderPaymentInput
  ) {
    const providerTransactionId = requireNonEmptyString(
      input.providerTransactionId,
      "providerTransactionId"
    );
    const occurredAt = requireNonEmptyString(
      input.occurredAt,
      "occurredAt"
    );

    if (!Number.isInteger(input.amountVnd) || input.amountVnd <= 0) {
      throw new BadRequestException(
        "amountVnd must be a positive integer VND amount."
      );
    }

    return this.processing.processPayment(eventId, {
      providerTransactionId,
      amountVnd: input.amountVnd,
      occurredAt,
      paymentReference:
        input.paymentReference === undefined ||
        input.paymentReference === null
          ? null
          : requireNonEmptyString(
              input.paymentReference,
              "paymentReference"
            ),
      metadata: input.metadata
    });
  }

  @Post(":eventId/outcome")
  outcome(
    @Param("eventId") eventId: string,
    @Body() input: OutcomeInput
  ) {
    if (
      input.outcome !== "REVIEW_REQUIRED" &&
      input.outcome !== "IGNORED" &&
      input.outcome !== "FAILED"
    ) {
      throw new BadRequestException(
        "outcome must be REVIEW_REQUIRED, IGNORED or FAILED."
      );
    }

    return this.processing.completeWithoutPayment({
      eventId,
      outcome: input.outcome,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null
    });
  }
}
