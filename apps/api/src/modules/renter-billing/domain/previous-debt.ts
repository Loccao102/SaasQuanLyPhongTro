export interface PriorInvoiceFinancials {
  subtotalVnd: number;
  adjustmentVnd: number;
  paidVnd: number;
}

export interface SourceInvoiceSummary {
  id: string;
  invoiceNumber: string;
}

export interface GeneratedInvoiceTotals {
  subtotalVnd: number;
  adjustmentVnd: number;
  previousBalanceVnd: number;
  totalVnd: number;
  paidVnd: number;
  remainingVnd: number;
  collectionStatus: "PAID" | "PARTIALLY_PAID" | "UNPAID";
}

export interface PreviousDebtInvoiceLine {
  lineType: "PREVIOUS_DEBT";
  description: string;
  quantity: number;
  unitPriceVnd: number;
  amountVnd: number;
  sortOrder: number;
  snapshot: {
    policy: "PREVIOUS_DEBT_CARRY_FORWARD_V1";
    carriedDebtVnd: number;
    sourceInvoiceIds: string[];
    sourceInvoiceNumbers: string[];
  };
}

/**
 * Calculates net unpaid debt across prior finalized billing cycles for a lease.
 * Sums actual goods/services charges (subtotal + adjustment) and subtracts total payments made,
 * preventing double-counting of earlier debts that were rolled into prior statements.
 */
export function calculatePriorUnpaidDebt(
  priorInvoices: PriorInvoiceFinancials[]
): number {
  if (priorInvoices.length === 0) return 0;

  const totalInvoiced = priorInvoices.reduce(
    (acc, inv) => acc + inv.subtotalVnd + inv.adjustmentVnd,
    0
  );
  const totalPaid = priorInvoices.reduce((acc, inv) => acc + inv.paidVnd, 0);

  return Math.max(0, Math.round(totalInvoiced - totalPaid));
}

/**
 * Computes draft or final invoice totals given subtotal, adjustments, previous balance, and payments.
 * Guarantees integer VND arithmetic and adherence to check constraints:
 * - total_vnd = subtotal_vnd + adjustment_vnd + previous_balance_vnd
 * - paid_vnd + remaining_vnd = total_vnd
 */
export function computeInvoiceTotals(
  subtotalVnd: number,
  adjustmentVnd: number,
  previousBalanceVnd: number,
  paidVnd = 0
): GeneratedInvoiceTotals {
  const roundedSubtotal = Math.round(subtotalVnd);
  const roundedAdj = Math.round(adjustmentVnd);
  const roundedPrev = Math.round(Math.max(0, previousBalanceVnd));
  const roundedPaid = Math.round(Math.max(0, paidVnd));

  const totalVnd = Math.max(0, roundedSubtotal + roundedAdj + roundedPrev);
  const remainingVnd = Math.max(0, totalVnd - roundedPaid);

  const collectionStatus: "PAID" | "PARTIALLY_PAID" | "UNPAID" =
    totalVnd === 0 || remainingVnd === 0
      ? "PAID"
      : roundedPaid > 0
        ? "PARTIALLY_PAID"
        : "UNPAID";

  return {
    subtotalVnd: roundedSubtotal,
    adjustmentVnd: roundedAdj,
    previousBalanceVnd: roundedPrev,
    totalVnd,
    paidVnd: roundedPaid,
    remainingVnd,
    collectionStatus
  };
}

/**
 * Generates the standardized PREVIOUS_DEBT line item for renter invoice lines.
 */
export function buildPreviousDebtLine(
  previousBalanceVnd: number,
  sourceInvoices: SourceInvoiceSummary[] = []
): PreviousDebtInvoiceLine | null {
  if (previousBalanceVnd <= 0) return null;

  return {
    lineType: "PREVIOUS_DEBT",
    description: "Nợ cũ kỳ trước chuyển sang",
    quantity: 1,
    unitPriceVnd: previousBalanceVnd,
    amountVnd: previousBalanceVnd,
    sortOrder: 90,
    snapshot: {
      policy: "PREVIOUS_DEBT_CARRY_FORWARD_V1",
      carriedDebtVnd: previousBalanceVnd,
      sourceInvoiceIds: sourceInvoices.map((inv) => inv.id),
      sourceInvoiceNumbers: sourceInvoices.map((inv) => inv.invoiceNumber)
    }
  };
}
