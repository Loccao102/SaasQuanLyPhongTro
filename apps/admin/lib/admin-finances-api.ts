import { adminApiRequest } from "./admin-api-client";

export type OperatingExpenseCategory =
  | "REPAIR_MAINTENANCE"
  | "UTILITIES"
  | "MANAGEMENT_SERVICE"
  | "CLEANING_WASTE"
  | "TAX_FEES"
  | "OTHER";

export type ExpensePaymentMethod = "CASH" | "BANK_TRANSFER" | "OTHER";

export interface OperatingExpense {
  id: string;
  organizationId: string;
  propertyId: string | null;
  propertyName: string | null;
  propertyCode: string | null;
  category: OperatingExpenseCategory;
  amountVnd: number;
  occurredAt: string;
  paidTo: string | null;
  note: string | null;
  paymentMethod: ExpensePaymentMethod;
  receiptUrl: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface CreateExpenseInput {
  propertyId?: string | null;
  category: OperatingExpenseCategory;
  amountVnd: number;
  occurredAt: string;
  paidTo?: string | null;
  note?: string | null;
  paymentMethod?: ExpensePaymentMethod;
  receiptUrl?: string | null;
}

export interface CashflowCategorySummary {
  category: OperatingExpenseCategory;
  totalVnd: number;
  count: number;
}

export interface CashflowSummary {
  period: {
    fromDate: string | null;
    toDate: string | null;
  };
  propertyId: string | null;
  totalIncomeVnd: number;
  totalExpenseVnd: number;
  netCashflowVnd: number;
  incomeCount: number;
  expenseCount: number;
  categoryBreakdown: CashflowCategorySummary[];
}

export const adminFinancesApi = {
  expenses: (params?: {
    propertyId?: string;
    category?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    offset?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.propertyId) searchParams.set("propertyId", params.propertyId);
    if (params?.category) searchParams.set("category", params.category);
    if (params?.fromDate) searchParams.set("fromDate", params.fromDate);
    if (params?.toDate) searchParams.set("toDate", params.toDate);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));

    const qs = searchParams.toString();
    return adminApiRequest<{ expenses: OperatingExpense[]; total: number }>(
      "/admin/finances/expenses" + (qs ? "?" + qs : "")
    );
  },

  createExpense: (input: CreateExpenseInput) =>
    adminApiRequest<OperatingExpense>("/admin/finances/expenses", {
      method: "POST",
      body: input
    }),

  deleteExpense: (expenseId: string) =>
    adminApiRequest<{ success: boolean; id: string }>(
      "/admin/finances/expenses/" + encodeURIComponent(expenseId),
      { method: "DELETE" }
    ),

  cashflowSummary: (params?: {
    propertyId?: string;
    fromDate?: string;
    toDate?: string;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.propertyId) searchParams.set("propertyId", params.propertyId);
    if (params?.fromDate) searchParams.set("fromDate", params.fromDate);
    if (params?.toDate) searchParams.set("toDate", params.toDate);

    const qs = searchParams.toString();
    return adminApiRequest<CashflowSummary>(
      "/admin/finances/cashflow-summary" + (qs ? "?" + qs : "")
    );
  }
};
