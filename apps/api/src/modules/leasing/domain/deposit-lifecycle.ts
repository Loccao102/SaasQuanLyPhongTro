import type { ReadinessState } from "./lease-lifecycle.js";

export type DepositStatus =
  | "NOT_REQUIRED"
  | "UNPAID"
  | "PARTIALLY_PAID"
  | "HELD"
  | "PARTIALLY_SETTLED"
  | "SETTLED";

export type DepositMovementType =
  | "COLLECTION"
  | "DEDUCTION"
  | "REFUND"
  | "FORFEITURE";

export type PaymentMethod = "BANK_TRANSFER" | "CASH" | "OTHER";

export interface DepositMovement {
  id: string;
  movementType: DepositMovementType;
  amountVnd: number;
  paymentMethod: PaymentMethod;
  reference: string | null;
  notes: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface DepositState {
  status: DepositStatus;
  depositRequiredVnd: number;
  totalCollectedVnd: number;
  totalDeductedVnd: number;
  totalRefundedVnd: number;
  remainingHeldVnd: number;
}

export class InvalidDepositAmountError extends Error {
  constructor(message = "Deposit amount must be a positive integer in VND.") {
    super(message);
    this.name = "InvalidDepositAmountError";
  }
}

export class DepositSettlementExceedsHeldError extends Error {
  constructor(
    settlementAmount: number,
    heldAmount: number
  ) {
    super(
      `Deposit settlement of ${settlementAmount} VND exceeds the current held deposit of ${heldAmount} VND.`
    );
    this.name = "DepositSettlementExceedsHeldError";
  }
}

export class DepositAlreadySettledError extends Error {
  constructor(message = "Held deposit is zero; cannot settle further deposit.") {
    super(message);
    this.name = "DepositAlreadySettledError";
  }
}

function assertPositiveIntegerMoney(value: number, fieldName = "Amount"): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidDepositAmountError(
      `${fieldName} must be a positive integer in VND.`
    );
  }
}

function assertNonNegativeIntegerMoney(value: number, fieldName = "Amount"): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidDepositAmountError(
      `${fieldName} must be a non-negative integer in VND.`
    );
  }
}

export function calculateDepositStatus(
  depositRequiredVnd: number,
  totalCollectedVnd: number,
  totalDeductedVnd: number,
  totalRefundedVnd: number
): { status: DepositStatus; remainingHeldVnd: number } {
  assertNonNegativeIntegerMoney(depositRequiredVnd, "depositRequiredVnd");
  assertNonNegativeIntegerMoney(totalCollectedVnd, "totalCollectedVnd");
  assertNonNegativeIntegerMoney(totalDeductedVnd, "totalDeductedVnd");
  assertNonNegativeIntegerMoney(totalRefundedVnd, "totalRefundedVnd");

  const totalSettled = totalDeductedVnd + totalRefundedVnd;
  if (totalSettled > totalCollectedVnd) {
    throw new DepositSettlementExceedsHeldError(totalSettled, totalCollectedVnd);
  }

  const remainingHeldVnd = totalCollectedVnd - totalSettled;

  if (depositRequiredVnd === 0 && totalCollectedVnd === 0) {
    return { status: "NOT_REQUIRED", remainingHeldVnd: 0 };
  }

  if (totalCollectedVnd === 0) {
    return { status: "UNPAID", remainingHeldVnd: 0 };
  }

  if (totalSettled > 0) {
    if (remainingHeldVnd === 0) {
      return { status: "SETTLED", remainingHeldVnd: 0 };
    }
    return { status: "PARTIALLY_SETTLED", remainingHeldVnd };
  }

  if (totalCollectedVnd < depositRequiredVnd) {
    return { status: "PARTIALLY_PAID", remainingHeldVnd };
  }

  return { status: "HELD", remainingHeldVnd };
}

export function collectDeposit(
  current: DepositState,
  input: { amountVnd: number }
): DepositState {
  assertPositiveIntegerMoney(input.amountVnd, "Collect amount");

  const newTotalCollected = current.totalCollectedVnd + input.amountVnd;
  const { status, remainingHeldVnd } = calculateDepositStatus(
    current.depositRequiredVnd,
    newTotalCollected,
    current.totalDeductedVnd,
    current.totalRefundedVnd
  );

  return {
    status,
    depositRequiredVnd: current.depositRequiredVnd,
    totalCollectedVnd: newTotalCollected,
    totalDeductedVnd: current.totalDeductedVnd,
    totalRefundedVnd: current.totalRefundedVnd,
    remainingHeldVnd
  };
}

export function settleDeposit(
  current: DepositState,
  input: {
    deductionAmountVnd: number;
    refundAmountVnd: number;
  }
): DepositState {
  assertNonNegativeIntegerMoney(input.deductionAmountVnd, "deductionAmountVnd");
  assertNonNegativeIntegerMoney(input.refundAmountVnd, "refundAmountVnd");

  const settlementAmount = input.deductionAmountVnd + input.refundAmountVnd;
  if (settlementAmount <= 0) {
    throw new InvalidDepositAmountError(
      "Deposit settlement must specify deduction or refund amount greater than 0."
    );
  }

  if (current.remainingHeldVnd <= 0) {
    throw new DepositAlreadySettledError();
  }

  if (settlementAmount > current.remainingHeldVnd) {
    throw new DepositSettlementExceedsHeldError(
      settlementAmount,
      current.remainingHeldVnd
    );
  }

  const newTotalDeducted = current.totalDeductedVnd + input.deductionAmountVnd;
  const newTotalRefunded = current.totalRefundedVnd + input.refundAmountVnd;

  const { status, remainingHeldVnd } = calculateDepositStatus(
    current.depositRequiredVnd,
    current.totalCollectedVnd,
    newTotalDeducted,
    newTotalRefunded
  );

  return {
    status,
    depositRequiredVnd: current.depositRequiredVnd,
    totalCollectedVnd: current.totalCollectedVnd,
    totalDeductedVnd: newTotalDeducted,
    totalRefundedVnd: newTotalRefunded,
    remainingHeldVnd
  };
}

export function deriveDepositTerminationReadiness(
  depositRequiredVnd: number,
  depositState: DepositState | null
): ReadinessState {
  if (depositRequiredVnd === 0 && (!depositState || depositState.totalCollectedVnd === 0)) {
    return "NOT_REQUIRED";
  }

  if (!depositState) {
    return "PENDING";
  }

  if (depositState.remainingHeldVnd === 0 && (depositState.totalCollectedVnd > 0 || depositRequiredVnd === 0)) {
    return "READY";
  }

  return "PENDING";
}
