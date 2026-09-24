import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { TenantPrincipalGuard } from "../identity/tenant-principal.guard.js";
import type { TenantPrincipal, TenantRequest } from "../identity/tenant-principal.js";
import {
  RenterPaymentReviewService,
  type ResolveProviderReviewInput
} from "./renter-payment-review.service.js";

type BodyInput = Record<string, unknown>;

function requiredUuid(input: BodyInput, field: string): string {
  const value = input[field];
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new BadRequestException(field + " must be a UUID v4.");
  }
  return value;
}

function requiredMoney(input: BodyInput, field: string): number {
  const value = input[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new BadRequestException(field + " must be a positive integer VND amount.");
  }
  return value;
}

function requiredString(input: BodyInput, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(field + " is required.");
  }
  return value.trim();
}

@Controller("admin/renter-payments/reviews")
@UseGuards(TenantPrincipalGuard)
export class RenterPaymentReviewController {
  constructor(private readonly reviews: RenterPaymentReviewService) {}

  @Get()
  list(@Req() request: TenantRequest) {
    return this.reviews.list(this.principal(request));
  }

  @Get(":transactionId")
  detail(
    @Req() request: TenantRequest,
    @Param("transactionId", new ParseUUIDPipe({ version: "4" })) transactionId: string
  ) {
    return this.reviews.detail(this.principal(request), transactionId);
  }

  @Post(":transactionId/allocations")
  allocate(
    @Req() request: TenantRequest,
    @Param("transactionId", new ParseUUIDPipe({ version: "4" })) transactionId: string,
    @Body() body: BodyInput
  ) {
    const input: ResolveProviderReviewInput = {
      allocationId: requiredUuid(body, "allocationId"),
      amountVnd: requiredMoney(body, "amountVnd"),
      reason: requiredString(body, "reason")
    };
    return this.reviews.allocateReferencedInvoice(
      this.principal(request),
      transactionId,
      input
    );
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}
