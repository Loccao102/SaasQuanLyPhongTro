import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { TenantPrincipalGuard } from "../identity/tenant-principal.guard.js";
import type {
  TenantPrincipal,
  TenantRequest
} from "../identity/tenant-principal.js";
import {
  CreditBalanceService,
  type CreditMovementType,
  type CreateManualCreditInput,
  type CreateManualDebitInput,
  type IssueRefundInput
} from "./credit-balance.service.js";

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
    throw new BadRequestException(
      field + " must be a positive integer VND amount."
    );
  }
  return value;
}

const validMovementTypes: CreditMovementType[] = [
  "OVERPAYMENT_CREDIT",
  "CREDIT_APPLIED",
  "MANUAL_CREDIT",
  "MANUAL_DEBIT",
  "REFUND_ISSUED",
  "ALLOCATION_REVERSAL"
];

const validRefundMethods = ["CASH", "BANK_TRANSFER", "OTHER"] as const;

@Controller("admin/credit-balance")
@UseGuards(TenantPrincipalGuard)
export class CreditBalanceController {
  constructor(private readonly creditService: CreditBalanceService) {}

  @Get()
  getBalance(@Req() request: TenantRequest) {
    return this.creditService.getBalance(this.principal(request));
  }

  @Get("movements")
  listMovements(
    @Req() request: TenantRequest,
    @Query("movementType") movementType?: string,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ) {
    const mt =
      movementType && validMovementTypes.includes(movementType as CreditMovementType)
        ? (movementType as CreditMovementType)
        : null;

    return this.creditService.listMovements(this.principal(request), {
      movementType: mt,
      fromDate: fromDate?.trim() || null,
      toDate: toDate?.trim() || null,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined
    });
  }

  @Get("refunds")
  listRefunds(
    @Req() request: TenantRequest,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ) {
    return this.creditService.listRefunds(this.principal(request), {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined
    });
  }

  @Post("manual-credit")
  createManualCredit(
    @Req() request: TenantRequest,
    @Body() input: BodyInput
  ) {
    const command: CreateManualCreditInput = {
      movementId: requiredUuid(input, "movementId"),
      amountVnd: requiredMoney(input, "amountVnd"),
      description: optionalString(input, "description"),
      note: optionalString(input, "note")
    };
    return this.creditService.createManualCredit(
      this.principal(request),
      command
    );
  }

  @Post("manual-debit")
  createManualDebit(
    @Req() request: TenantRequest,
    @Body() input: BodyInput
  ) {
    const command: CreateManualDebitInput = {
      movementId: requiredUuid(input, "movementId"),
      amountVnd: requiredMoney(input, "amountVnd"),
      description: optionalString(input, "description"),
      note: optionalString(input, "note")
    };
    return this.creditService.createManualDebit(
      this.principal(request),
      command
    );
  }

  @Post("refund")
  issueRefund(
    @Req() request: TenantRequest,
    @Body() input: BodyInput
  ) {
    const refundMethod = requiredString(input, "refundMethod");
    if (!validRefundMethods.includes(refundMethod as any)) {
      throw new BadRequestException(
        "refundMethod must be one of: " + validRefundMethods.join(", ")
      );
    }
    const command: IssueRefundInput = {
      refundId: requiredUuid(input, "refundId"),
      movementId: requiredUuid(input, "movementId"),
      amountVnd: requiredMoney(input, "amountVnd"),
      refundMethod: refundMethod as "CASH" | "BANK_TRANSFER" | "OTHER",
      recipientName: optionalString(input, "recipientName"),
      recipientAccount: optionalString(input, "recipientAccount"),
      note: optionalString(input, "note")
    };
    return this.creditService.issueRefund(this.principal(request), command);
  }

  @Post("reverse-allocation/:allocationId")
  reverseAllocation(
    @Req() request: TenantRequest,
    @Param("allocationId", new ParseUUIDPipe({ version: "4" }))
    allocationId: string,
    @Body() input: BodyInput
  ) {
    const movementId = requiredUuid(input, "movementId");
    return this.creditService.reverseAllocation(
      this.principal(request),
      allocationId,
      movementId
    );
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}
