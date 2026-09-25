import {
  BadRequestException,
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { TenantPrincipalGuard } from "../../identity/tenant-principal.guard.js";
import type {
  TenantPrincipal,
  TenantRequest
} from "../../identity/tenant-principal.js";
import { LeaseDepositService } from "./lease-deposit.service.js";

type BodyInput = Record<string, unknown>;

function requiredString(input: BodyInput, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required.`);
  }
  return value.trim();
}

function optionalString(
  input: BodyInput,
  field: string
): string | null | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException(`${field} must be a string or null.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredInteger(input: BodyInput, field: string): number {
  const value = input[field];
  if (!Number.isSafeInteger(value)) {
    throw new BadRequestException(`${field} must be an integer.`);
  }
  return Number(value);
}

@Controller("admin/leases/:leaseId/deposit")
@UseGuards(TenantPrincipalGuard)
export class LeaseDepositController {
  constructor(private readonly depositService: LeaseDepositService) {}

  @Post("collect")
  collect(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    const rawMethod = optionalString(input, "paymentMethod");
    const paymentMethod =
      rawMethod === "CASH" || rawMethod === "OTHER" ? rawMethod : "BANK_TRANSFER";

    return this.depositService.collectDeposit(
      this.principal(request),
      leaseId,
      {
        idempotencyKey: requiredString(input, "idempotencyKey"),
        amountVnd: requiredInteger(input, "amountVnd"),
        paymentMethod,
        reference: optionalString(input, "reference"),
        notes: optionalString(input, "notes"),
        occurredAt: optionalString(input, "occurredAt")
      }
    );
  }

  @Post("settle")
  settle(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    return this.depositService.settleDeposit(
      this.principal(request),
      leaseId,
      {
        idempotencyKey: requiredString(input, "idempotencyKey"),
        deductionAmountVnd: requiredInteger(input, "deductionAmountVnd"),
        refundAmountVnd: requiredInteger(input, "refundAmountVnd"),
        deductionReason: optionalString(input, "deductionReason"),
        refundReference: optionalString(input, "refundReference"),
        notes: optionalString(input, "notes"),
        occurredAt: optionalString(input, "occurredAt")
      }
    );
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new BadRequestException("Tenant principal context is missing.");
    }
    return request.tenantPrincipal;
  }
}
