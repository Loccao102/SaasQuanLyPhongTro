import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
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
import {
  IdempotencyConflictError,
  InvalidIdempotencyKeyError
} from "./idempotent-command.js";
import { LeaseDepositService } from "./lease-deposit.service.js";

type BodyInput = Record<string, unknown>;

function requiredString(input: BodyInput, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(field + " is required.");
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
    throw new BadRequestException(field + " must be a string or null.");
  }
  return value;
}

function requiredInteger(input: BodyInput, field: string): number {
  const value = input[field];
  if (!Number.isSafeInteger(value)) {
    throw new BadRequestException(field + " must be an integer.");
  }
  return Number(value);
}

@Controller("admin/leases")
@UseGuards(TenantPrincipalGuard)
export class LeaseDepositController {
  constructor(private readonly deposits: LeaseDepositService) {}

  @Get(":leaseId/deposit")
  summary(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string
  ) {
    return this.deposits.summary(this.principal(request), leaseId);
  }

  @Post(":leaseId/deposit/collections")
  recordCollection(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    return this.command(() =>
      this.deposits.recordCollection(this.principal(request), leaseId, {
        idempotencyKey: requiredString(input, "idempotencyKey"),
        amountVnd: requiredInteger(input, "amountVnd"),
        occurredAt: requiredString(input, "occurredAt"),
        note: optionalString(input, "note")
      })
    );
  }

  @Post(":leaseId/deposit/settlement")
  settle(
    @Req() request: TenantRequest,
    @Param("leaseId", new ParseUUIDPipe({ version: "4" })) leaseId: string,
    @Body() input: BodyInput
  ) {
    return this.command(() =>
      this.deposits.settle(this.principal(request), leaseId, {
        idempotencyKey: requiredString(input, "idempotencyKey"),
        refundVnd: requiredInteger(input, "refundVnd"),
        deductionVnd: requiredInteger(input, "deductionVnd"),
        occurredAt: requiredString(input, "occurredAt"),
        note: requiredString(input, "note")
      })
    );
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }

  private async command<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof InvalidIdempotencyKeyError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
