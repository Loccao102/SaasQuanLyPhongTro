import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards
} from "@nestjs/common";
import { TenantPrincipalGuard } from "../identity/tenant-principal.guard.js";
import type {
  TenantPrincipal,
  TenantRequest
} from "../identity/tenant-principal.js";
import {
  RenterPaymentsService,
  type CreateManualAllocationInput
} from "./renter-payments.service.js";

type BodyInput = Record<string, unknown>;

function requiredString(input: BodyInput, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(field + " is required.");
  }
  return value.trim();
}

function optionalString(input: BodyInput, field: string): string | null {
  const value = input[field];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new BadRequestException(field + " must be a string.");
  }
  return value.trim();
}

function requiredUuid(input: BodyInput, field: string) {
  const value = requiredString(input, field);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    throw new BadRequestException(field + " must be a UUID v4.");
  }
  return value;
}

function requiredMoney(input: BodyInput, field: string) {
  const value = input[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new BadRequestException(field + " must be a positive integer VND amount.");
  }
  return value;
}

@Controller("admin/renter-payments")
@UseGuards(TenantPrincipalGuard)
export class RenterPaymentsController {
  constructor(private readonly payments: RenterPaymentsService) {}

  @Get("payment-profile")
  paymentProfile(@Req() request: TenantRequest) {
    return this.payments.paymentProfile(this.principal(request));
  }

  @Put("payment-profile")
  updatePaymentProfile(
    @Req() request: TenantRequest,
    @Body() input: BodyInput
  ) {
    if (typeof input.isActive !== "boolean") {
      throw new BadRequestException("isActive must be a boolean.");
    }
    return this.payments.updatePaymentProfile(this.principal(request), {
      bankId: requiredString(input, "bankId"),
      accountNo: requiredString(input, "accountNo"),
      accountName: requiredString(input, "accountName"),
      vietQrTemplate: requiredString(input, "vietQrTemplate"),
      isActive: input.isActive
    });
  }

  @Get("invoices/:invoiceId")
  detail(
    @Req() request: TenantRequest,
    @Param("invoiceId", new ParseUUIDPipe({ version: "4" })) invoiceId: string
  ) {
    return this.payments.detail(this.principal(request), invoiceId);
  }

  @Post("manual-allocations")
  createManualAllocation(
    @Req() request: TenantRequest,
    @Body() input: BodyInput
  ) {
    const command: CreateManualAllocationInput = {
      transactionId: requiredUuid(input, "transactionId"),
      allocationId: requiredUuid(input, "allocationId"),
      invoiceId: requiredUuid(input, "invoiceId"),
      amountVnd: requiredMoney(input, "amountVnd"),
      occurredAt: requiredString(input, "occurredAt"),
      payerName: optionalString(input, "payerName"),
      note: optionalString(input, "note")
    };
    return this.payments.createManualAllocation(
      this.principal(request),
      command
    );
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}
