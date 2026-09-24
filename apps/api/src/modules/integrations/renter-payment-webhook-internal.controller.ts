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
  RenterProviderPaymentProcessingService,
  type NormalizedRenterProviderPaymentInput
} from "../renter-payments/renter-provider-payment-processing.service.js";

type ClaimInput = { provider?: string };
type OutcomeInput = {
  outcome?: "REVIEW_REQUIRED" | "IGNORED" | "FAILED";
  errorCode?: string | null;
  errorMessage?: string | null;
};

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(field + " is required.");
  }
  return value.trim();
}

@Controller("internal/renter-payment-webhooks")
@UseGuards(InternalServiceGuard)
export class RenterPaymentWebhookInternalController {
  constructor(
    private readonly processing: RenterProviderPaymentProcessingService
  ) {}

  @Post("claim")
  claim(@Body() input: ClaimInput) {
    return this.processing.claim(
      input.provider === undefined
        ? undefined
        : requiredString(input.provider, "provider")
    );
  }

  @Post(":eventId/payment")
  payment(
    @Param("eventId") eventId: string,
    @Body() input: NormalizedRenterProviderPaymentInput
  ) {
    if (!Number.isSafeInteger(input.amountVnd) || input.amountVnd <= 0) {
      throw new BadRequestException(
        "amountVnd must be a positive integer VND amount."
      );
    }
    return this.processing.processPayment(eventId, {
      providerTransactionId: requiredString(
        input.providerTransactionId,
        "providerTransactionId"
      ),
      amountVnd: input.amountVnd,
      occurredAt: requiredString(input.occurredAt, "occurredAt"),
      paymentReference:
        input.paymentReference === undefined ||
        input.paymentReference === null
          ? null
          : requiredString(input.paymentReference, "paymentReference"),
      destinationAccountNo:
        input.destinationAccountNo === undefined ||
        input.destinationAccountNo === null
          ? null
          : requiredString(
              input.destinationAccountNo,
              "destinationAccountNo"
            ),
      payerName:
        input.payerName === undefined || input.payerName === null
          ? null
          : requiredString(input.payerName, "payerName"),
      note:
        input.note === undefined || input.note === null
          ? null
          : requiredString(input.note, "note"),
      providerIdentity: input.providerIdentity ?? null,
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
