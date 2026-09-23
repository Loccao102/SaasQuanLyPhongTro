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
  cycles: RenterBillingCycle[];
};

export type RenterBillingDetailResponse = {
  organization: { id: string; name: string };
  cycle: RenterBillingCycle;
  invoices: Array<{
    id: string;
    number: string;
    status: "DRAFT" | "ISSUED" | "VOID";
    room: { id: string; code: string };
    lease: { id: string; code: string };
    primaryResidentName: string;
    subtotalVnd: number;
    adjustmentVnd: number;
    previousBalanceVnd: number;
    totalVnd: number;
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

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";
const configuredOrganizationId =
  process.env.NEXT_PUBLIC_ADMIN_ORGANIZATION_ID?.trim() ?? "";

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const headers = new Headers();
  if (configuredOrganizationId) {
    headers.set("x-organization-id", configuredOrganizationId);
  }
  if (init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(apiBase + "/admin/renter-billing" + path, {
    credentials: "include",
    method: init?.method ?? "GET",
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text ||
        "Renter billing API request failed with status " +
          String(response.status)
    );
  }

  return response.json() as Promise<T>;
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
      eligibleLeaseCount: number;
      partialLeaseCount: number;
      requiresReview: boolean;
    }>("/cycles/" + encodeURIComponent(cycleId) + "/generate-rent", {
      method: "POST"
    }),
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
