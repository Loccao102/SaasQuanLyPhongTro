export type RenterCollectionStatus =
  | "UNPAID"
  | "PARTIALLY_PAID"
  | "PAID";

export type RenterPaymentDetailResponse = {
  organization: { id: string; name: string };
  invoice: {
    id: string;
    number: string;
    property: { id: string; code: string; name: string };
    roomCode: string;
    primaryResidentName: string;
    status: "DRAFT" | "ISSUED" | "VOID";
    totalVnd: number;
    paidVnd: number;
    remainingVnd: number;
    collectionStatus: RenterCollectionStatus;
    dueDate: string;
  };
  permissions: {
    reconcile: boolean;
  };
  allocations: Array<{
    id: string;
    amountVnd: number;
    type: "MANUAL" | "AUTO";
    createdAt: string;
    transaction: {
      id: string;
      source: "MANUAL" | "PROVIDER";
      provider: string | null;
      providerTransactionId: string | null;
      amountVnd: number;
      occurredAt: string;
      payerName: string | null;
      note: string | null;
      status: "POSTED" | "REVERSED";
    };
  }>;
};

export type ManualAllocationResult = {
  invoice: {
    id: string;
    number: string;
    roomCode: string;
    primaryResidentName: string;
    status: string;
    totalVnd: number;
    paidVnd: number;
    remainingVnd: number;
    collectionStatus: RenterCollectionStatus;
    dueDate: string;
  };
  allocations: RenterPaymentDetailResponse["allocations"];
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

  const response = await fetch(apiBase + "/admin/renter-payments" + path, {
    credentials: "include",
    method: init?.method ?? "GET",
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text ||
        "Renter payment API request failed with status " +
          String(response.status)
    );
  }

  return response.json() as Promise<T>;
}

export const renterPaymentsApi = {
  detail: (invoiceId: string) =>
    request<RenterPaymentDetailResponse>(
      "/invoices/" + encodeURIComponent(invoiceId)
    ),
  createManualAllocation: (input: {
    transactionId: string;
    allocationId: string;
    invoiceId: string;
    amountVnd: number;
    occurredAt: string;
    payerName: string | null;
    note: string | null;
  }) =>
    request<ManualAllocationResult>("/manual-allocations", {
      method: "POST",
      body: input
    })
};
