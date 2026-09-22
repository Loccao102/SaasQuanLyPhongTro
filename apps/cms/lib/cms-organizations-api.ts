export type CmsOrganizationDirectoryItem = {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: string;
  ownerName: string | null;
  rooms: number;
  staff: number;
  subscriptionStatus: string;
  subscriptionVersion: number | null;
  billingInterval: "MONTHLY" | "YEARLY" | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean | null;
  planCode: string | null;
  latestInvoice: {
    id: string;
    status: "OPEN" | "PARTIALLY_PAID" | "PAID" | "VOID";
    amountVnd: number;
    paidAmountVnd: number;
    remainingAmountVnd: number;
    isOverdue: boolean;
    dueAt: string | null;
    paidAt: string | null;
    periodStart: string | null;
    periodEnd: string | null;
  } | null;
  roomLimit: number | null;
  staffLimit: number | null;
  automationQuota: number | null;
  roomLimitSource: "PLAN" | "OVERRIDE" | null;
  staffLimitSource: "PLAN" | "OVERRIDE" | null;
  automationQuotaSource: "PLAN" | "OVERRIDE" | null;
  automationUsed: number;
  automationReserved: number;
  delinquent: boolean;
  overLimit: boolean;
};

export type CmsOrganizationDirectoryResult = {
  items: CmsOrganizationDirectoryItem[];
  nextCursor: string | null;
};

export type CmsOrganizationDirectoryFilters = {
  query?: string;
  plan?: string;
  status?: string;
  organizationStatus?: string;
  delinquent?: boolean;
  overLimit?: boolean;
  limit?: number;
  cursor?: string;
};

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";

async function request<T>(path: string): Promise<T> {
  const response = await fetch(apiBase + "/cms/organization-directory" + path, {
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

export const cmsOrganizationsApi = {
  search: (filters: CmsOrganizationDirectoryFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.query) params.set("q", filters.query);
    if (filters.plan) params.set("plan", filters.plan);
    if (filters.status) params.set("status", filters.status);
    if (filters.organizationStatus) {
      params.set("organizationStatus", filters.organizationStatus);
    }
    if (filters.delinquent !== undefined) {
      params.set("delinquent", String(filters.delinquent));
    }
    if (filters.overLimit !== undefined) {
      params.set("overLimit", String(filters.overLimit));
    }
    if (filters.limit !== undefined) params.set("limit", String(filters.limit));
    if (filters.cursor) params.set("cursor", filters.cursor);

    const suffix = params.size > 0 ? "?" + params.toString() : "";
    return request<CmsOrganizationDirectoryResult>(suffix);
  },

  getById: (organizationId: string) =>
    request<CmsOrganizationDirectoryItem>(
      "/" + encodeURIComponent(organizationId)
    )
};
