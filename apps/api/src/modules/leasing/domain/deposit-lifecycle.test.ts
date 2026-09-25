import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDepositStatus,
  collectDeposit,
  DepositAlreadySettledError,
  DepositSettlementExceedsHeldError,
  deriveDepositTerminationReadiness,
  InvalidDepositAmountError,
  settleDeposit,
  type DepositState
} from "./deposit-lifecycle.js";

test("calculateDepositStatus marks zero-deposit lease as NOT_REQUIRED", () => {
  const result = calculateDepositStatus(0, 0, 0, 0);
  assert.equal(result.status, "NOT_REQUIRED");
  assert.equal(result.remainingHeldVnd, 0);
});

test("calculateDepositStatus marks uncollected deposit as UNPAID", () => {
  const result = calculateDepositStatus(3500000, 0, 0, 0);
  assert.equal(result.status, "UNPAID");
  assert.equal(result.remainingHeldVnd, 0);
});

test("calculateDepositStatus marks partially collected deposit as PARTIALLY_PAID", () => {
  const result = calculateDepositStatus(3500000, 1500000, 0, 0);
  assert.equal(result.status, "PARTIALLY_PAID");
  assert.equal(result.remainingHeldVnd, 1500000);
});

test("calculateDepositStatus marks fully collected deposit as HELD", () => {
  const result = calculateDepositStatus(3500000, 3500000, 0, 0);
  assert.equal(result.status, "HELD");
  assert.equal(result.remainingHeldVnd, 3500000);
});

test("calculateDepositStatus marks partially settled deposit as PARTIALLY_SETTLED", () => {
  const result = calculateDepositStatus(3500000, 3500000, 500000, 0);
  assert.equal(result.status, "PARTIALLY_SETTLED");
  assert.equal(result.remainingHeldVnd, 3000000);
});

test("calculateDepositStatus marks fully refunded/deducted deposit as SETTLED", () => {
  const result = calculateDepositStatus(3500000, 3500000, 500000, 3000000);
  assert.equal(result.status, "SETTLED");
  assert.equal(result.remainingHeldVnd, 0);
});

test("collectDeposit accumulates collected amount and adjusts held balance", () => {
  const initial: DepositState = {
    status: "UNPAID",
    depositRequiredVnd: 3500000,
    totalCollectedVnd: 0,
    totalDeductedVnd: 0,
    totalRefundedVnd: 0,
    remainingHeldVnd: 0
  };

  const step1 = collectDeposit(initial, { amountVnd: 2000000 });
  assert.equal(step1.status, "PARTIALLY_PAID");
  assert.equal(step1.totalCollectedVnd, 2000000);
  assert.equal(step1.remainingHeldVnd, 2000000);

  const step2 = collectDeposit(step1, { amountVnd: 1500000 });
  assert.equal(step2.status, "HELD");
  assert.equal(step2.totalCollectedVnd, 3500000);
  assert.equal(step2.remainingHeldVnd, 3500000);
});

test("collectDeposit rejects invalid/negative amounts", () => {
  const current: DepositState = {
    status: "UNPAID",
    depositRequiredVnd: 3500000,
    totalCollectedVnd: 0,
    totalDeductedVnd: 0,
    totalRefundedVnd: 0,
    remainingHeldVnd: 0
  };

  assert.throws(() => collectDeposit(current, { amountVnd: 0 }), InvalidDepositAmountError);
  assert.throws(() => collectDeposit(current, { amountVnd: -500000 }), InvalidDepositAmountError);
  assert.throws(() => collectDeposit(current, { amountVnd: 100.5 }), InvalidDepositAmountError);
});

test("settleDeposit accurately records deduction and refund, returning SETTLED when remaining reaches zero", () => {
  const held: DepositState = {
    status: "HELD",
    depositRequiredVnd: 3500000,
    totalCollectedVnd: 3500000,
    totalDeductedVnd: 0,
    totalRefundedVnd: 0,
    remainingHeldVnd: 3500000
  };

  const settled = settleDeposit(held, {
    deductionAmountVnd: 500000,
    refundAmountVnd: 3000000
  });

  assert.equal(settled.status, "SETTLED");
  assert.equal(settled.totalDeductedVnd, 500000);
  assert.equal(settled.totalRefundedVnd, 3000000);
  assert.equal(settled.remainingHeldVnd, 0);
});

test("settleDeposit rejects settlement exceeding remaining held deposit", () => {
  const held: DepositState = {
    status: "HELD",
    depositRequiredVnd: 3500000,
    totalCollectedVnd: 3500000,
    totalDeductedVnd: 0,
    totalRefundedVnd: 0,
    remainingHeldVnd: 3500000
  };

  assert.throws(
    () =>
      settleDeposit(held, {
        deductionAmountVnd: 2000000,
        refundAmountVnd: 2000000
      }),
    DepositSettlementExceedsHeldError
  );
});

test("settleDeposit rejects settling when already settled or zero remaining", () => {
  const settled: DepositState = {
    status: "SETTLED",
    depositRequiredVnd: 3500000,
    totalCollectedVnd: 3500000,
    totalDeductedVnd: 500000,
    totalRefundedVnd: 3000000,
    remainingHeldVnd: 0
  };

  assert.throws(
    () =>
      settleDeposit(settled, {
        deductionAmountVnd: 100000,
        refundAmountVnd: 0
      }),
    DepositAlreadySettledError
  );
});

test("deriveDepositTerminationReadiness marks ready only when zero remaining held", () => {
  assert.equal(deriveDepositTerminationReadiness(0, null), "NOT_REQUIRED");

  const uncollected: DepositState = {
    status: "UNPAID",
    depositRequiredVnd: 3500000,
    totalCollectedVnd: 0,
    totalDeductedVnd: 0,
    totalRefundedVnd: 0,
    remainingHeldVnd: 0
  };
  assert.equal(deriveDepositTerminationReadiness(3500000, uncollected), "PENDING");

  const held: DepositState = {
    status: "HELD",
    depositRequiredVnd: 3500000,
    totalCollectedVnd: 3500000,
    totalDeductedVnd: 0,
    totalRefundedVnd: 0,
    remainingHeldVnd: 3500000
  };
  assert.equal(deriveDepositTerminationReadiness(3500000, held), "PENDING");

  const settled: DepositState = {
    status: "SETTLED",
    depositRequiredVnd: 3500000,
    totalCollectedVnd: 3500000,
    totalDeductedVnd: 500000,
    totalRefundedVnd: 3000000,
    remainingHeldVnd: 0
  };
  assert.equal(deriveDepositTerminationReadiness(3500000, settled), "READY");
});
