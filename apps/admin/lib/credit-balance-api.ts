import { adminApiRequest } from "./admin-api-client";

// ── Types ────────────────────────────────────────────────────

export type CreditMovementType =
  | "OVERPAYMENT_CREDIT"
  | "CREDIT_APPLIED"
  | "MANUAL_CREDIT"
  | "MANUAL_DEBIT"
  | "REFUND_ISSUED"
  | "ALLOCATION_REVERSAL";

export interface CreditBalance {
  organizationId: string;
  balanceVnd: number;
  updatedAt: string;
}

export interface CreditMovement {
  id: string;
  organizationId: string;
  movementType: CreditMovementType;
  amountVnd: number;
  balanceAfterVnd: number;
  invoiceId: string | null;
  paymentTransactionId: string | null;
  allocationId: string | null;
  description: string | null;
  note: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface Refund {
  id: string;
  organizationId: string;
  creditMovementId: string;
  amountVnd: number;
  refundMethod: string;
  recipientName: string | null;
  recipientAccount: string | null;
  note: string | null;
  status: string;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
  completedAt: string | null;
}

// ── API Client ───────────────────────────────────────────────

export const creditBalanceApi = {
  getBalance: () =>
    adminApiRequest<CreditBalance>("/admin/credit-balance"),

  listMovements: (params?: {
    movementType?: CreditMovementType;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    offset?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params?.movementType) sp.set("movementType", params.movementType);
    if (params?.fromDate) sp.set("fromDate", params.fromDate);
    if (params?.toDate) sp.set("toDate", params.toDate);
    if (params?.limit) sp.set("limit", String(params.limit));
    if (params?.offset) sp.set("offset", String(params.offset));
    const qs = sp.toString();
    return adminApiRequest<{ movements: CreditMovement[]; total: number }>(
      "/admin/credit-balance/movements" + (qs ? "?" + qs : "")
    );
  },

  listRefunds: (params?: { limit?: number; offset?: number }) => {
    const sp = new URLSearchParams();
    if (params?.limit) sp.set("limit", String(params.limit));
    if (params?.offset) sp.set("offset", String(params.offset));
    const qs = sp.toString();
    return adminApiRequest<{ refunds: Refund[]; total: number }>(
      "/admin/credit-balance/refunds" + (qs ? "?" + qs : "")
    );
  },

  manualCredit: (input: {
    movementId: string;
    amountVnd: number;
    description?: string | null;
    note?: string | null;
  }) =>
    adminApiRequest<{ balance: CreditBalance; movement: CreditMovement }>(
      "/admin/credit-balance/manual-credit",
      { method: "POST", body: input }
    ),

  manualDebit: (input: {
    movementId: string;
    amountVnd: number;
    description?: string | null;
    note?: string | null;
  }) =>
    adminApiRequest<{ balance: CreditBalance; movement: CreditMovement }>(
      "/admin/credit-balance/manual-debit",
      { method: "POST", body: input }
    ),

  issueRefund: (input: {
    refundId: string;
    movementId: string;
    amountVnd: number;
    refundMethod: "CASH" | "BANK_TRANSFER" | "OTHER";
    recipientName?: string | null;
    recipientAccount?: string | null;
    note?: string | null;
  }) =>
    adminApiRequest<{
      balance: CreditBalance;
      movement: CreditMovement;
      refund: Refund;
    }>("/admin/credit-balance/refund", { method: "POST", body: input }),

  reverseAllocation: (
    allocationId: string,
    movementId: string
  ) =>
    adminApiRequest<{ balance: CreditBalance; movement: CreditMovement }>(
      "/admin/credit-balance/reverse-allocation/" +
        encodeURIComponent(allocationId),
      { method: "POST", body: { movementId } }
    )
};
