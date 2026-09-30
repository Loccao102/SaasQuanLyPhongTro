import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePriorUnpaidDebt,
  computeInvoiceTotals,
  buildPreviousDebtLine
} from "./previous-debt.js";

test("calculatePriorUnpaidDebt: returns 0 when no prior invoices exist", () => {
  assert.equal(calculatePriorUnpaidDebt([]), 0);
});

test("calculatePriorUnpaidDebt: correctly rolls forward unpaid single invoice", () => {
  const prior = [
    { subtotalVnd: 3500000, adjustmentVnd: 0, paidVnd: 0 }
  ];
  assert.equal(calculatePriorUnpaidDebt(prior), 3500000);
});

test("calculatePriorUnpaidDebt: correctly accounts for partial payments", () => {
  const prior = [
    { subtotalVnd: 3500000, adjustmentVnd: 0, paidVnd: 1500000 }
  ];
  assert.equal(calculatePriorUnpaidDebt(prior), 2000000);
});

test("calculatePriorUnpaidDebt: returns 0 when all prior invoices are fully paid", () => {
  const prior = [
    { subtotalVnd: 3500000, adjustmentVnd: 0, paidVnd: 3500000 },
    { subtotalVnd: 4000000, adjustmentVnd: -200000, paidVnd: 3800000 }
  ];
  assert.equal(calculatePriorUnpaidDebt(prior), 0);
});

test("calculatePriorUnpaidDebt: prevents double-counting across multiple rolled cycles", () => {
  // Cycle 1: 3,000,000 billed, 0 paid
  // Cycle 2: 3,500,000 new charges, 0 paid (even if cycle 2 rolled forward cycle 1, the new charges are 3.5M)
  const prior = [
    { subtotalVnd: 3000000, adjustmentVnd: 0, paidVnd: 0 },
    { subtotalVnd: 3500000, adjustmentVnd: 0, paidVnd: 0 }
  ];
  // Total debt should be exactly 6,500,000 (NOT 3M + 6.5M = 9.5M)
  assert.equal(calculatePriorUnpaidDebt(prior), 6500000);

  // If resident paid 4,000,000 on Cycle 2:
  prior[1]!.paidVnd = 4000000;
  assert.equal(calculatePriorUnpaidDebt(prior), 2500000);

  // If resident paid full 6,500,000 on Cycle 2:
  prior[1]!.paidVnd = 6500000;
  assert.equal(calculatePriorUnpaidDebt(prior), 0);
});

test("calculatePriorUnpaidDebt: handles negative adjustments (discounts)", () => {
  const prior = [
    { subtotalVnd: 3000000, adjustmentVnd: -500000, paidVnd: 2000000 }
  ];
  // Net charged: 2,500,000 - 2,000,000 paid = 500,000
  assert.equal(calculatePriorUnpaidDebt(prior), 500000);
});

test("computeInvoiceTotals: satisfies financial check constraints", () => {
  const result = computeInvoiceTotals(3500000, -200000, 1500000, 0);
  assert.equal(result.subtotalVnd, 3500000);
  assert.equal(result.adjustmentVnd, -200000);
  assert.equal(result.previousBalanceVnd, 1500000);
  assert.equal(result.totalVnd, 4800000);
  assert.equal(result.paidVnd, 0);
  assert.equal(result.remainingVnd, 4800000);
  assert.equal(result.collectionStatus, "UNPAID");

  // Partial payment
  const partial = computeInvoiceTotals(3500000, -200000, 1500000, 2000000);
  assert.equal(partial.totalVnd, 4800000);
  assert.equal(partial.paidVnd, 2000000);
  assert.equal(partial.remainingVnd, 2800000);
  assert.equal(partial.collectionStatus, "PARTIALLY_PAID");

  // Full payment
  const full = computeInvoiceTotals(3500000, -200000, 1500000, 4800000);
  assert.equal(full.remainingVnd, 0);
  assert.equal(full.collectionStatus, "PAID");

  // Zero total
  const zero = computeInvoiceTotals(0, 0, 0, 0);
  assert.equal(zero.totalVnd, 0);
  assert.equal(zero.collectionStatus, "PAID");
});

test("buildPreviousDebtLine: creates line when debt exists, returns null when 0", () => {
  assert.equal(buildPreviousDebtLine(0), null);
  assert.equal(buildPreviousDebtLine(-1000), null);

  const line = buildPreviousDebtLine(2500000, [
    { id: "inv-1", invoiceNumber: "INV-001" },
    { id: "inv-2", invoiceNumber: "INV-002" }
  ]);
  assert.ok(line);
  assert.equal(line.lineType, "PREVIOUS_DEBT");
  assert.equal(line.amountVnd, 2500000);
  assert.equal(line.unitPriceVnd, 2500000);
  assert.equal(line.sortOrder, 90);
  assert.equal(line.snapshot.policy, "PREVIOUS_DEBT_CARRY_FORWARD_V1");
  assert.deepEqual(line.snapshot.sourceInvoiceIds, ["inv-1", "inv-2"]);
  assert.deepEqual(line.snapshot.sourceInvoiceNumbers, ["INV-001", "INV-002"]);
});
