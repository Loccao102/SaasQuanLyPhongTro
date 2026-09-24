import { adminApiRequest } from "./admin-api-client";

export type RenterBillingCycle = {
  id: string;
  property: { id: string; code: string; name: string };
  code: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: "OPEN" | "FINALIZED" | "CANCELLED";
  finalizedAt: string | null;
  invoiceCount: number;
  draftCount: number;
  issuedCount: number;
  totalVnd: number;
};

export type RenterBillingListResponse = {
  organization: { id: string; name: string };
  permissions: { paymentProfileRead: boolean };
  cycles: RenterBillingCycle[];
};

export type RenterBillingDetailResponse = {
  organization: { id: string; name: string };
  cycle: RenterBillingCycle;
  invoices: Array<{
    id: string;
    number: string;
    paymentReference: string;
    publicLinkActive: boolean;
    status: "DRAFT" | "ISSUED" | "VOID";
    room: { id: string; code: string };
    lease: { id: string; code: string };
    primaryResidentName: string;
    subtotalVnd: number;
    adjustmentVnd: number;
    previousBalanceVnd: number;
    totalVnd: number;
    paidVnd: number;
    remainingVnd: number;
    collectionStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
    calculationStatus: "READY" | "REVIEW_REQUIRED";
    reviewReasons: Array<Record<string, unknown>>;
    calculatedAt: string | null;
    issuedAt: string | null;
    lines: Array<{
      id: string;
      type: string;
      description: string;
      quantity: string;
      unitPriceVnd: number;
      amountVnd: number;
      sortOrder: number;
      snapshot: unknown;
    }>;
  }>;
};


async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  return adminApiRequest<T>("/admin/renter-billing" + path, init);
}

export const renterBillingApi = {
  list: () => request<RenterBillingListResponse>(""),
  detail: (cycleId: string) =>
    request<RenterBillingDetailResponse>(
      "/cycles/" + encodeURIComponent(cycleId)
    ),
  createCycle: (input: {
    id: string;
    propertyId: string;
    code: string;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
  }) => request("/cycles", { method: "POST", body: input }),
  generateRentDrafts: (cycleId: string) =>
    request<{
      cycleId: string;
      created: number;
      refreshed: number;
      eligibleLeaseCount: number;
      partialLeaseCount: number;
      reviewRequiredInvoiceCount: number;
      requiresReview: boolean;
    }>("/cycles/" + encodeURIComponent(cycleId) + "/generate-rent", {
      method: "POST"
    }),
  issuePublicLink: (invoiceId: string) =>
    request<{
      invoiceId: string;
      token: string;
      tokenHint: string;
      createdAt: string;
    }>("/invoices/" + encodeURIComponent(invoiceId) + "/public-link", {
      method: "POST"
    }),
  revokePublicLink: (invoiceId: string) =>
    request<{ invoiceId: string; revoked: boolean }>(
      "/invoices/" + encodeURIComponent(invoiceId) + "/public-link/revoke",
      { method: "POST" }
    ),
  finalizeCycle: (cycleId: string) =>
    request<{
      cycleId: string;
      status: "FINALIZED";
      invoiceCount: number;
      totalVnd: number;
    }>("/cycles/" + encodeURIComponent(cycleId) + "/finalize", {
      method: "POST"
    })
};
