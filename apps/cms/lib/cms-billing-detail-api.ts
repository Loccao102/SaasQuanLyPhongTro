export type CmsInvoiceDetail = {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  invoice: {
    id: string;
    organizationId: string;
    subscriptionId: string;
    planId: string;
    planVersionId: string;
    planCode: string;
    billingInterval: "MONTHLY" | "YEARLY";
    periodStart: string;
    periodEnd: string;
    amountVnd: number;
    paymentReference: string;
    paidAmountVnd: number;
    remainingAmountVnd: number;
    status: "OPEN" | "PARTIALLY_PAID" | "PAID" | "VOID";
    isOverdue: boolean;
    issuedAt: string;
    dueAt: string;
    paidAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  allocations: Array<{
    allocation: {
      id: string;
      organizationId: string;
      paymentId: string;
      invoiceId: string;
      amountVnd: number;
      allocatedByUserId: string | null;
      allocatedByName: string | null;
      reason: string;
      createdAt: string;
    };
    payment: {
      id: string;
      amountVnd: number;
      status: "SUCCEEDED" | "FAILED" | "REFUNDED";
      reconciliationStatus:
        | "UNALLOCATED"
        | "ALLOCATED"
        | "REVIEW_REQUIRED";
      source: "MANUAL" | "PROVIDER";
      provider: string | null;
      providerTransactionId: string | null;
      occurredAt: string;
    };
  }>;
  auditEvents: Array<{
    id: string;
    at: string;
    actor: string;
    action: string;
    targetType: string;
    target: string;
    reason: string;
  }> | null;
};

export type CmsListInvoicesParams = {
  status?: string;
  plan?: string;
  q?: string;
  page?: number;
  limit?: number;
};

export type CmsInvoiceSummaryItem = {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  subscriptionId: string;
  planCode: string;
  billingInterval: "MONTHLY" | "YEARLY";
  periodStart: string;
  periodEnd: string;
  amountVnd: number;
  paidAmountVnd: number;
  remainingAmountVnd: number;
  paymentReference: string;
  status: "OPEN" | "PARTIALLY_PAID" | "PAID" | "VOID";
  isOverdue: boolean;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  createdAt: string;
};

export type CmsInvoiceStatistics = {
  totalRevenueVnd: number;
  pendingRevenueVnd: number;
  totalInvoicesCount: number;
  paidInvoicesCount: number;
  openInvoicesCount: number;
  voidInvoicesCount: number;
  monthlyRevenueVnd: number;
  yearlyRevenueVnd: number;
  planBreakdown: Array<{
    planCode: string;
    invoiceCount: number;
    paidCount: number;
    revenueVnd: number;
  }>;
  subscriptionDistribution: Array<{
    planCode: string;
    status: string;
    count: number;
  }>;
};

export type CmsListInvoicesResponse = {
  items: CmsInvoiceSummaryItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  statistics: CmsInvoiceStatistics;
};

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";

async function request<T>(path: string): Promise<T> {
  const response = await fetch(apiBase + "/cms/billing" + path, {
    credentials: "include"
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || "CMS API request failed with status " + String(response.status)
    );
  }

  return response.json() as Promise<T>;
}

export const cmsBillingDetailApi = {
  getInvoice: (invoiceId: string) =>
    request<CmsInvoiceDetail>(
      "/invoices/" + encodeURIComponent(invoiceId)
    ),
  listInvoices: (params: CmsListInvoicesParams = {}) => {
    const sp = new URLSearchParams();
    if (params.status && params.status !== "ALL") sp.set("status", params.status);
    if (params.plan && params.plan !== "ALL") sp.set("plan", params.plan);
    if (params.q?.trim()) sp.set("q", params.q.trim());
    if (params.page) sp.set("page", String(params.page));
    if (params.limit) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    return request<CmsListInvoicesResponse>("/invoices" + (qs ? "?" + qs : ""));
  }
};
