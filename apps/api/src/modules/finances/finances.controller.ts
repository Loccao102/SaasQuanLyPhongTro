import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { TenantPrincipalGuard } from "../identity/tenant-principal.guard.js";
import type { TenantPrincipal, TenantRequest } from "../identity/tenant-principal.js";
import { FinancesService } from "./finances.service.js";
import {
  operatingExpenseCategories,
  type CreateExpenseInput,
  type OperatingExpenseCategory
} from "./finances.types.js";

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
  return value.trim();
}

function requiredNumber(input: BodyInput, field: string): number {
  const value = input[field];
  const num = typeof value === "number" ? value : Number(value);
  if (typeof num !== "number" || Number.isNaN(num)) {
    throw new BadRequestException(field + " must be a valid number.");
  }
  return num;
}

@Controller("admin/finances")
@UseGuards(TenantPrincipalGuard)
export class FinancesController {
  constructor(private readonly financesService: FinancesService) {}

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }

  @Get("expenses")
  async listExpenses(
    @Req() req: TenantRequest,
    @Query("propertyId") propertyId?: string,
    @Query("category") category?: string,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ) {
    return this.financesService.listExpenses(this.principal(req), {
      propertyId: propertyId ? propertyId.trim() : null,
      category: category ? category.trim() : null,
      fromDate: fromDate ? fromDate.trim() : null,
      toDate: toDate ? toDate.trim() : null,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined
    });
  }

  @Post("expenses")
  async createExpense(@Req() req: TenantRequest, @Body() body: BodyInput) {
    const category = requiredString(body, "category") as OperatingExpenseCategory;
    if (!operatingExpenseCategories.includes(category)) {
      throw new BadRequestException("Danh mục chi phí không hợp lệ.");
    }

    const input: CreateExpenseInput = {
      propertyId: optionalString(body, "propertyId"),
      category,
      amountVnd: requiredNumber(body, "amountVnd"),
      occurredAt: requiredString(body, "occurredAt"),
      paidTo: optionalString(body, "paidTo"),
      note: optionalString(body, "note"),
      paymentMethod: optionalString(body, "paymentMethod") as any,
      receiptUrl: optionalString(body, "receiptUrl")
    };

    return this.financesService.createExpense(this.principal(req), input);
  }

  @Delete("expenses/:expenseId")
  async deleteExpense(
    @Req() req: TenantRequest,
    @Param("expenseId", ParseUUIDPipe) expenseId: string
  ) {
    return this.financesService.deleteExpense(this.principal(req), expenseId);
  }

  @Get("cashflow-summary")
  async getCashflowSummary(
    @Req() req: TenantRequest,
    @Query("propertyId") propertyId?: string,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string
  ) {
    return this.financesService.getCashflowSummary(this.principal(req), {
      propertyId: propertyId ? propertyId.trim() : null,
      fromDate: fromDate ? fromDate.trim() : null,
      toDate: toDate ? toDate.trim() : null
    });
  }
}
