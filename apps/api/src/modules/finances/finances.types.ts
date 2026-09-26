export const operatingExpenseCategories = [
  "REPAIR_MAINTENANCE",
  "UTILITIES",
  "MANAGEMENT_SERVICE",
  "CLEANING_WASTE",
  "TAX_FEES",
  "OTHER"
] as const;

export type OperatingExpenseCategory = (typeof operatingExpenseCategories)[number];

export const expensePaymentMethods = [
  "CASH",
  "BANK_TRANSFER",
  "OTHER"
] as const;

export type ExpensePaymentMethod = (typeof expensePaymentMethods)[number];

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
