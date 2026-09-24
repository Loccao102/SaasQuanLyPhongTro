import { adminApiRequest } from "./admin-api-client";

export type RenterCollectionStatus =
  | "UNPAID"
  | "PARTIALLY_PAID"
  | "PAID";

export type RenterPaymentDetailResponse = {
  organization: { id: string; name: string };
  invoice: {
    id: string;
    number: string;
    paymentReference: string;
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

export type OrganizationPaymentProfile = {
  organizationId: string;
  bankId: string;
  accountNo: string;
  accountName: string;
  vietQrTemplate: string;
  isActive: boolean;
  updatedAt: string;
};

export type PaymentProfileResponse = {
  organization: { id: string; name: string };
  profile: OrganizationPaymentProfile | null;
  canManage: boolean;
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


async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  return adminApiRequest<T>("/admin/renter-payments" + path, init);
}

export const renterPaymentsApi = {
  paymentProfile: () =>
    request<PaymentProfileResponse>("/payment-profile"),
  updatePaymentProfile: (input: {
    bankId: string;
    accountNo: string;
    accountName: string;
    vietQrTemplate: string;
    isActive: boolean;
  }) =>
    request<OrganizationPaymentProfile>("/payment-profile", {
      method: "PUT",
      body: input
    }),
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
