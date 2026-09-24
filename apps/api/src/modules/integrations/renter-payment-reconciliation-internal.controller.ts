import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards
} from "@nestjs/common";
import { InternalServiceGuard } from "../internal/internal-service.guard.js";
import {
  RenterPaymentReconciliationConflictError,
  RenterPaymentReconciliationService
} from "./renter-payment-reconciliation.service.js";

function requiredString(
  value: unknown,
  field: string,
  max: number
): string {
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.trim().length > max
  ) {
    throw new BadRequestException(
      field + " must contain between 1 and " + String(max) + " characters."
    );
  }
  return value.trim();
}

@Controller("internal/renter-payment-reconciliation")
@UseGuards(InternalServiceGuard)
export class RenterPaymentReconciliationInternalController {
  constructor(
    private readonly reconciliation: RenterPaymentReconciliationService
  ) {}

  @Post("cursor")
  cursor(@Body() input: { provider?: unknown; scopeKey?: unknown }) {
    return this.reconciliation.cursor(
      requiredString(input.provider, "provider", 64),
      requiredString(input.scopeKey, "scopeKey", 128)
    );
  }

  @Post("observations")
  observation(
    @Body()
    input: {
      provider?: unknown;
      scopeKey?: unknown;
      providerEventId?: unknown;
      rawBody?: unknown;
    }
  ) {
    return this.reconciliation.persistObservation({
      provider: requiredString(input.provider, "provider", 64),
      scopeKey: requiredString(input.scopeKey, "scopeKey", 128),
      providerEventId: requiredString(
        input.providerEventId,
        "providerEventId",
        256
      ),
      rawBody: requiredString(input.rawBody, "rawBody", 1_000_000)
    });
  }

  @Post("advance")
  async advance(
    @Body()
    input: {
      provider?: unknown;
      scopeKey?: unknown;
      expectedVersion?: unknown;
      nextCursor?: unknown;
    }
  ) {
    if (
      !Number.isInteger(input.expectedVersion) ||
      Number(input.expectedVersion) < 1
    ) {
      throw new BadRequestException(
        "expectedVersion must be a positive integer."
      );
    }

    try {
      return await this.reconciliation.advance({
        provider: requiredString(input.provider, "provider", 64),
        scopeKey: requiredString(input.scopeKey, "scopeKey", 128),
        expectedVersion: Number(input.expectedVersion),
        nextCursor: requiredString(input.nextCursor, "nextCursor", 256)
      });
    } catch (error) {
      if (error instanceof RenterPaymentReconciliationConflictError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
