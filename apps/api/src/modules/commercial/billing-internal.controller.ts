import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards
} from "@nestjs/common";
import { InternalServiceGuard } from "../internal/internal-service.guard.js";
import { SubscriptionBillingService } from "./application/subscription-billing.service.js";

type BillingSweepInput = {
  limit?: number;
};

@Controller("internal/billing")
@UseGuards(InternalServiceGuard)
export class BillingInternalController {
  constructor(private readonly billing: SubscriptionBillingService) {}

  @Post("sweep")
  sweep(@Body() input: BillingSweepInput) {
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new BadRequestException(
        "limit must be an integer between 1 and 500."
      );
    }

    return this.billing.processDueBatch(limit);
  }
}
