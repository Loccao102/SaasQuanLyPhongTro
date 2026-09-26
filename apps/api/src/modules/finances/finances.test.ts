import assert from "node:assert/strict";
import test from "node:test";
import { operatingExpenseCategories, type OperatingExpenseCategory } from "./finances.types.js";

function validateExpenseInput(input: {
  category: string;
  amountVnd: number;
  occurredAt: string;
}): void {
  if (!operatingExpenseCategories.includes(input.category as OperatingExpenseCategory)) {
    throw new Error("Invalid category: " + input.category);
  }
  const amount = Math.floor(input.amountVnd);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Amount must be positive integer VND: " + input.amountVnd);
  }
  const date = new Date(input.occurredAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid occurredAt date: " + input.occurredAt);
  }
}

function calculateCashflow(
  incomeAmounts: number[],
  expenses: Array<{ category: OperatingExpenseCategory; amountVnd: number }>
) {
  const totalIncomeVnd = incomeAmounts.reduce((sum, val) => sum + val, 0);
  const totalExpenseVnd = expenses.reduce((sum, e) => sum + e.amountVnd, 0);
  const netCashflowVnd = totalIncomeVnd - totalExpenseVnd;

  const categoryMap = new Map<OperatingExpenseCategory, { totalVnd: number; count: number }>();
  for (const exp of expenses) {
    const prev = categoryMap.get(exp.category) ?? { totalVnd: 0, count: 0 };
    categoryMap.set(exp.category, {
      totalVnd: prev.totalVnd + exp.amountVnd,
      count: prev.count + 1
    });
  }

  const categoryBreakdown = Array.from(categoryMap.entries()).map(([category, stats]) => ({
    category,
    totalVnd: stats.totalVnd,
    count: stats.count
  }));

  return {
    totalIncomeVnd,
    totalExpenseVnd,
    netCashflowVnd,
    incomeCount: incomeAmounts.length,
    expenseCount: expenses.length,
    categoryBreakdown
  };
}

test("finances: valid expense input passes validation", () => {
  assert.doesNotThrow(() => {
    validateExpenseInput({
      category: "REPAIR_MAINTENANCE",
      amountVnd: 350000,
      occurredAt: "2026-09-26T10:00:00.000Z"
    });
  });
});

test("finances: rejects invalid expense category", () => {
  assert.throws(
    () => {
      validateExpenseInput({
        category: "GAMBLING",
        amountVnd: 100000,
        occurredAt: "2026-09-26T10:00:00.000Z"
      });
    },
    /Invalid category/
  );
});

test("finances: rejects zero or negative expense amount", () => {
  assert.throws(
    () => {
      validateExpenseInput({
        category: "UTILITIES",
        amountVnd: 0,
        occurredAt: "2026-09-26T10:00:00.000Z"
      });
    },
    /Amount must be positive integer VND/
  );

  assert.throws(
    () => {
      validateExpenseInput({
        category: "UTILITIES",
        amountVnd: -50000,
        occurredAt: "2026-09-26T10:00:00.000Z"
      });
    },
    /Amount must be positive integer VND/
  );
});

test("finances: rejects invalid date string", () => {
  assert.throws(
    () => {
      validateExpenseInput({
        category: "CLEANING_WASTE",
        amountVnd: 200000,
        occurredAt: "not-a-date"
      });
    },
    /Invalid occurredAt date/
  );
});

test("finances: cashflow correctly aggregates income, expenses, and net profit", () => {
  const incomes = [3500000, 4200000, 5000000]; // Total: 12,700,000 VND
  const expenses: Array<{ category: OperatingExpenseCategory; amountVnd: number }> = [
    { category: "REPAIR_MAINTENANCE", amountVnd: 500000 },
    { category: "UTILITIES", amountVnd: 1200000 },
    { category: "CLEANING_WASTE", amountVnd: 300000 },
    { category: "REPAIR_MAINTENANCE", amountVnd: 250000 }
  ]; // Total: 2,250,000 VND

  const summary = calculateCashflow(incomes, expenses);

  assert.equal(summary.totalIncomeVnd, 12700000);
  assert.equal(summary.totalExpenseVnd, 2250000);
  assert.equal(summary.netCashflowVnd, 10450000);
  assert.equal(summary.incomeCount, 3);
  assert.equal(summary.expenseCount, 4);

  const repairStat = summary.categoryBreakdown.find((c) => c.category === "REPAIR_MAINTENANCE");
  assert.ok(repairStat);
  assert.equal(repairStat.totalVnd, 750000);
  assert.equal(repairStat.count, 2);

  const utilStat = summary.categoryBreakdown.find((c) => c.category === "UTILITIES");
  assert.ok(utilStat);
  assert.equal(utilStat.totalVnd, 1200000);
  assert.equal(utilStat.count, 1);
});
