import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import { roleHasPermission } from "../identity/domain/access-control.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";
import {
  operatingExpenseCategories,
  type CashflowCategorySummary,
  type CashflowSummary,
  type CreateExpenseInput,
  type ExpensePaymentMethod,
  type OperatingExpense,
  type OperatingExpenseCategory
} from "./finances.types.js";

type ExpenseRow = QueryResultRow & {
  id: string;
  organization_id: string;
  property_id: string | null;
  property_name: string | null;
  property_code: string | null;
  category: string;
  amount_vnd: string;
  occurred_at: Date | string;
  paid_to: string | null;
  note: string | null;
  payment_method: string;
  receipt_url: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: Date | string;
};

@Injectable()
export class FinancesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService
  ) {}

  async listExpenses(
    principal: TenantPrincipal,
    filters: {
      propertyId?: string | null;
      category?: string | null;
      fromDate?: string | null;
      toDate?: string | null;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ expenses: OperatingExpense[]; total: number }> {
    if (
      !roleHasPermission(principal.role, "billing.read") &&
      !roleHasPermission(principal.role, "report.read")
    ) {
      throw new ForbiddenException("Financial read permission denied.");
    }

    if (filters.propertyId) {
      await this.validatePropertyScope(principal, filters.propertyId, "billing.read");
    }

    const conditions: string[] = ["e.organization_id = $1::uuid"];
    const values: unknown[] = [principal.organizationId];
    let idx = 2;

    if (filters.propertyId) {
      conditions.push(`e.property_id = $${idx++}::uuid`);
      values.push(filters.propertyId);
    }

    if (filters.category && operatingExpenseCategories.includes(filters.category as OperatingExpenseCategory)) {
      conditions.push(`e.category = $${idx++}`);
      values.push(filters.category);
    }

    if (filters.fromDate) {
      conditions.push(`e.occurred_at >= $${idx++}::timestamptz`);
      values.push(filters.fromDate);
    }

    if (filters.toDate) {
      conditions.push(`e.occurred_at <= $${idx++}::timestamptz`);
      values.push(filters.toDate);
    }

    const whereClause = conditions.join(" AND ");
    const limit = Math.min(Math.max(Number(filters.limit ?? 50), 1), 200);
    const offset = Math.max(Number(filters.offset ?? 0), 0);

    const countResult = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM operating_expenses e WHERE ${whereClause}`,
      values
    );
    const total = Number(countResult.rows[0]?.count ?? 0);

    const queryValues = [...values, limit, offset];
    const result = await this.db.query<ExpenseRow>(
      `SELECT
         e.id::text,
         e.organization_id::text,
         e.property_id::text,
         p.name AS property_name,
         p.code AS property_code,
         e.category,
         e.amount_vnd::text,
         e.occurred_at,
         e.paid_to,
         e.note,
         e.payment_method,
         e.receipt_url,
         e.created_by_user_id::text,
         u.full_name AS created_by_name,
         e.created_at
       FROM operating_expenses e
       LEFT JOIN properties p ON p.id = e.property_id AND p.organization_id = e.organization_id
       LEFT JOIN users u ON u.id = e.created_by_user_id
       WHERE ${whereClause}
       ORDER BY e.occurred_at DESC, e.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      queryValues
    );

    return {
      expenses: result.rows.map((row) => this.mapExpense(row)),
      total
    };
  }

  async createExpense(
    principal: TenantPrincipal,
    input: CreateExpenseInput
  ): Promise<OperatingExpense> {
    if (!roleHasPermission(principal.role, "billing.manage")) {
      throw new ForbiddenException("Financial manage permission denied.");
    }

    if (!operatingExpenseCategories.includes(input.category)) {
      throw new BadRequestException("Danh mục chi phí không hợp lệ.");
    }

    const amountVnd = Math.floor(Number(input.amountVnd));
    if (!Number.isSafeInteger(amountVnd) || amountVnd <= 0) {
      throw new BadRequestException("Số tiền chi phí phải là số nguyên dương VND.");
    }

    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new BadRequestException("Ngày phát sinh chi phí không hợp lệ.");
    }

    if (input.propertyId) {
      await this.validatePropertyScope(principal, input.propertyId, "billing.manage");
    }

    const paymentMethod: ExpensePaymentMethod =
      input.paymentMethod === "BANK_TRANSFER" || input.paymentMethod === "OTHER"
        ? input.paymentMethod
        : "CASH";

    const result = await this.db.query<ExpenseRow>(
      `INSERT INTO operating_expenses (
         organization_id,
         property_id,
         category,
         amount_vnd,
         occurred_at,
         paid_to,
         note,
         payment_method,
         receipt_url,
         created_by_user_id
       ) VALUES ($1::uuid, $2, $3, $4::bigint, $5::timestamptz, $6, $7, $8, $9, $10::uuid)
       RETURNING
         id::text,
         organization_id::text,
         property_id::text,
         category,
         amount_vnd::text,
         occurred_at,
         paid_to,
         note,
         payment_method,
         receipt_url,
         created_by_user_id::text,
         created_at`,
      [
        principal.organizationId,
        input.propertyId ? input.propertyId : null,
        input.category,
        amountVnd,
        occurredAt.toISOString(),
        input.paidTo?.trim() || null,
        input.note?.trim() || null,
        paymentMethod,
        input.receiptUrl?.trim() || null,
        principal.userId
      ]
    );

    const row = result.rows[0]!;
    let propertyName: string | null = null;
    let propertyCode: string | null = null;
    if (input.propertyId) {
      const propResult = await this.db.query<{ name: string; code: string }>(
        `SELECT name, code FROM properties WHERE organization_id = $1::uuid AND id = $2::uuid LIMIT 1`,
        [principal.organizationId, input.propertyId]
      );
      if (propResult.rows[0]) {
        propertyName = propResult.rows[0].name;
        propertyCode = propResult.rows[0].code;
      }
    }

    return {
      id: row.id,
      organizationId: row.organization_id,
      propertyId: row.property_id,
      propertyName,
      propertyCode,
      category: row.category as OperatingExpenseCategory,
      amountVnd: Number(row.amount_vnd),
      occurredAt: new Date(row.occurred_at).toISOString(),
      paidTo: row.paid_to,
      note: row.note,
      paymentMethod: row.payment_method as ExpensePaymentMethod,
      receiptUrl: row.receipt_url,
      createdByUserId: row.created_by_user_id,
      createdByName: null,
      createdAt: new Date(row.created_at).toISOString()
    };
  }

  async deleteExpense(
    principal: TenantPrincipal,
    expenseId: string
  ): Promise<{ success: boolean; id: string }> {
    if (!roleHasPermission(principal.role, "billing.manage")) {
      throw new ForbiddenException("Financial manage permission denied.");
    }

    const existingResult = await this.db.query<{ id: string; property_id: string | null }>(
      `SELECT id::text, property_id::text
       FROM operating_expenses
       WHERE organization_id = $1::uuid AND id = $2::uuid
       LIMIT 1`,
      [principal.organizationId, expenseId]
    );
    const existing = existingResult.rows[0];
    if (!existing) {
      throw new NotFoundException("Khoản chi phí không tồn tại.");
    }

    if (existing.property_id) {
      await this.validatePropertyScope(principal, existing.property_id, "billing.manage");
    }

    await this.db.query(
      `DELETE FROM operating_expenses WHERE organization_id = $1::uuid AND id = $2::uuid`,
      [principal.organizationId, expenseId]
    );

    return { success: true, id: expenseId };
  }

  async getCashflowSummary(
    principal: TenantPrincipal,
    query: {
      propertyId?: string | null;
      fromDate?: string | null;
      toDate?: string | null;
    }
  ): Promise<CashflowSummary> {
    if (
      !roleHasPermission(principal.role, "billing.read") &&
      !roleHasPermission(principal.role, "report.read")
    ) {
      throw new ForbiddenException("Financial read permission denied.");
    }

    if (query.propertyId) {
      await this.validatePropertyScope(principal, query.propertyId, "billing.read");
    }

    // 1. Calculate Inflow (Total revenue collected from tenants)
    let totalIncomeVnd = 0;
    let incomeCount = 0;

    if (query.propertyId) {
      const incomeResult = await this.db.query<{ total_income: string; tx_count: number }>(
        `SELECT
           COALESCE(SUM(a.allocated_vnd), 0)::text AS total_income,
           COUNT(DISTINCT t.id)::int AS tx_count
         FROM renter_payment_allocations a
         JOIN renter_payment_transactions t ON t.id = a.payment_transaction_id AND t.organization_id = a.organization_id
         JOIN renter_invoices i ON i.id = a.invoice_id AND i.organization_id = a.organization_id
         WHERE a.organization_id = $1::uuid
           AND t.status = 'POSTED'
           AND i.property_id = $2::uuid
           AND ($3::timestamptz IS NULL OR t.occurred_at >= $3::timestamptz)
           AND ($4::timestamptz IS NULL OR t.occurred_at <= $4::timestamptz)`,
        [
          principal.organizationId,
          query.propertyId,
          query.fromDate ?? null,
          query.toDate ?? null
        ]
      );
      totalIncomeVnd = Number(incomeResult.rows[0]?.total_income ?? 0);
      incomeCount = Number(incomeResult.rows[0]?.tx_count ?? 0);
    } else {
      const incomeResult = await this.db.query<{ total_income: string; tx_count: number }>(
        `SELECT
           COALESCE(SUM(amount_vnd), 0)::text AS total_income,
           COUNT(*)::int AS tx_count
         FROM renter_payment_transactions
         WHERE organization_id = $1::uuid
           AND status = 'POSTED'
           AND ($2::timestamptz IS NULL OR occurred_at >= $2::timestamptz)
           AND ($3::timestamptz IS NULL OR occurred_at <= $3::timestamptz)`,
        [
          principal.organizationId,
          query.fromDate ?? null,
          query.toDate ?? null
        ]
      );
      totalIncomeVnd = Number(incomeResult.rows[0]?.total_income ?? 0);
      incomeCount = Number(incomeResult.rows[0]?.tx_count ?? 0);
    }

    // 2. Calculate Outflow (Operating Expenses breakdown and total)
    const expenseBreakdownResult = await this.db.query<{
      category: string;
      total_vnd: string;
      count: number;
    }>(
      `SELECT
         category,
         COALESCE(SUM(amount_vnd), 0)::text AS total_vnd,
         COUNT(*)::int AS count
       FROM operating_expenses
       WHERE organization_id = $1::uuid
         AND ($2::uuid IS NULL OR property_id = $2::uuid)
         AND ($3::timestamptz IS NULL OR occurred_at >= $3::timestamptz)
         AND ($4::timestamptz IS NULL OR occurred_at <= $4::timestamptz)
       GROUP BY category
       ORDER BY SUM(amount_vnd) DESC`,
      [
        principal.organizationId,
        query.propertyId ?? null,
        query.fromDate ?? null,
        query.toDate ?? null
      ]
    );

    const categoryBreakdown: CashflowCategorySummary[] = expenseBreakdownResult.rows.map(
      (row) => ({
        category: row.category as OperatingExpenseCategory,
        totalVnd: Number(row.total_vnd),
        count: Number(row.count)
      })
    );

    const totalExpenseVnd = categoryBreakdown.reduce((sum, item) => sum + item.totalVnd, 0);
    const expenseCount = categoryBreakdown.reduce((sum, item) => sum + item.count, 0);
    const netCashflowVnd = totalIncomeVnd - totalExpenseVnd;

    return {
      period: {
        fromDate: query.fromDate ?? null,
        toDate: query.toDate ?? null
      },
      propertyId: query.propertyId ?? null,
      totalIncomeVnd,
      totalExpenseVnd,
      netCashflowVnd,
      incomeCount,
      expenseCount,
      categoryBreakdown
    };
  }

  private async validatePropertyScope(
    principal: TenantPrincipal,
    propertyId: string,
    permission: "billing.read" | "billing.manage"
  ): Promise<void> {
    const result = await this.db.query<{
      id: string;
      operational_group_ids: string[];
    }>(
      `SELECT
         p.id::text,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids
       FROM properties p
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       WHERE p.organization_id = $1::uuid
         AND p.id = $2::uuid
       GROUP BY p.id
       LIMIT 1`,
      [principal.organizationId, propertyId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Cơ sở không tồn tại trong tổ chức.");
    }

    if (
      !this.accessControl.can(principal.membership, permission, {
        organizationId: principal.organizationId,
        propertyId,
        operationalGroupIds: row.operational_group_ids
      })
    ) {
      throw new ForbiddenException("Không có quyền truy cập vào cơ sở này.");
    }
  }

  private mapExpense(row: ExpenseRow): OperatingExpense {
    return {
      id: row.id,
      organizationId: row.organization_id,
      propertyId: row.property_id,
      propertyName: row.property_name,
      propertyCode: row.property_code,
      category: row.category as OperatingExpenseCategory,
      amountVnd: Number(row.amount_vnd),
      occurredAt: new Date(row.occurred_at).toISOString(),
      paidTo: row.paid_to,
      note: row.note,
      paymentMethod: row.payment_method as ExpensePaymentMethod,
      receiptUrl: row.receipt_url,
      createdByUserId: row.created_by_user_id,
      createdByName: row.created_by_name,
      createdAt: new Date(row.created_at).toISOString()
    };
  }
}
