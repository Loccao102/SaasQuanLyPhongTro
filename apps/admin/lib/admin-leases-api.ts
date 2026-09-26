import { adminApiRequest } from "./admin-api-client";

export type LeaseStatus =
  | "DRAFT"
  | "ACTIVE"
  | "TERMINATION_SCHEDULED"
  | "TERMINATED"
  | "CANCELLED";

export type LeaseSummary = {
  id: string;
  code: string;
  status: LeaseStatus;
  startDate: string;
  plannedEndDate: string | null;
  baseRentVnd: number;
  depositRequiredVnd: number;
  billingDay: number;
  room: { id: string; code: string; name: string };
  property: { id: string; code: string; name: string };
  primaryResident: {
    id: string;
    fullName: string;
    phone: string | null;
  } | null;
};

export type LeaseListResponse = {
  organization: { id: string; name: string };
  summary: {
    active: number;
    terminationScheduled: number;
    draft: number;
    terminated: number;
  };
  leases: LeaseSummary[];
};

export type LeaseDetailResponse = {
  organization: { id: string; name: string };
  lease: LeaseSummary & {
    terminationEffectiveDate: string | null;
    terminationReason: string | null;
    version: number;
    createdAt: string;
    renewedFromLeaseId?: string | null;
  };
  permissions: {
    manage: boolean;
    terminate: boolean;
  };
  parties: Array<{
    residentId: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    role: string;
    joinedOn: string | null;
    leftOn: string | null;
  }>;
  termination: {
    id: string;
    status: string;
    effectiveDate: string | null;
    reason: string;
    readiness: {
      meter: "PENDING" | "READY" | "NOT_REQUIRED";
      financial: "PENDING" | "READY" | "NOT_REQUIRED";
      deposit: "PENDING" | "READY" | "NOT_REQUIRED";
    };
    createdAt: string;
    completedAt: string | null;
    cancelledAt: string | null;
  } | null;
  audit: Array<{
    action: string;
    metadata: unknown;
    occurredAt: string;
  }>;
};

export type LeaseTerminationMeterReadiness = {
  leaseId: string;
  terminationId: string | null;
  effectiveDate: string | null;
  state: "PENDING" | "READY" | "NOT_REQUIRED" | null;
  meters: Array<{
    id: string;
    meterType: "ELECTRICITY" | "WATER";
    unit: "KWH" | "M3";
    label: string | null;
    finalReading: {
      id: string;
      readingDate: string;
      readingValue: string;
      source: "ADMIN" | "STAFF" | "IMPORT" | null;
    } | null;
  }>;
};

export type LeaseTerminationFinancialReadiness = {
  leaseId: string;
  terminationId: string | null;
  effectiveDate: string | null;
  state: "PENDING" | "READY" | "NOT_REQUIRED" | null;
  summary: {
    totalInvoicedVnd: number;
    totalPaidVnd: number;
    outstandingDebtVnd: number;
    hasDraftInvoices: boolean;
    invoiceCount: number;
  };
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    status: "DRAFT" | "ISSUED" | "VOID";
    collectionStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    totalVnd: number;
    paidVnd: number;
    remainingVnd: number;
  }>;
};

export type LeaseDepositStatus =
  | "NOT_REQUIRED"
  | "UNPAID"
  | "PARTIALLY_HELD"
  | "HELD"
  | "SETTLED";

export type LeaseDepositSummary = {
  leaseId: string;
  requiredVnd: number;
  collectedVnd: number;
  refundedVnd: number;
  deductedVnd: number;
  heldVnd: number;
  outstandingVnd: number;
  status: LeaseDepositStatus;
  terminationDepositReadiness:
    | "PENDING"
    | "READY"
    | "NOT_REQUIRED"
    | null;
  permissions: {
    reconcile: boolean;
  };
  entries: Array<{
    id: string;
    type: "COLLECTION" | "REFUND" | "DEDUCTION";
    amountVnd: number;
    occurredAt: string;
    note: string | null;
    createdAt: string;
  }>;
};

export type ResidentSearchResult = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
};

export type CreateLeaseDraftInput = {
  leaseId: string;
  residentId: string;
  idempotencyKey: string;
  roomId: string;
  leaseCode: string;
  startDate: string;
  plannedEndDate?: string | null;
  baseRentVnd: number;
  depositRequiredVnd: number;
  billingDay: number;
  primaryResident?: {
    fullName: string;
    phone?: string | null;
    email?: string | null;
  } | null;
};


async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  return adminApiRequest<T>("/admin/leases" + path, init);
}

function command(
  path: string,
  idempotencyKey: string,
  body: Record<string, unknown> = {}
) {
  return request<{ lease: { status: LeaseStatus; version: number } }>(path, {
    method: "POST",
    body: {
      ...body,
      idempotencyKey
    }
  });
}

export type LeaseAttachment = {
  id: string;
  attachmentType:
    | "CITIZEN_ID_FRONT"
    | "CITIZEN_ID_BACK"
    | "HANDOVER_MINUTES"
    | "CONTRACT_SCAN"
    | "OTHER";
  fileName: string;
  fileUrl: string;
  fileSizeBytes: number | null;
  mimeType: string | null;
  note: string | null;
  uploadedAt: string;
  actorUserId: string | null;
};

export type LeaseAmendment = {
  id: string;
  amendmentNumber: string;
  effectiveDate: string;
  changesSummary: string;
  adjustedBaseRentVnd: number | null;
  adjustedDepositRequiredVnd: number | null;
  adjustedPlannedEndDate: string | null;
  note: string | null;
  createdAt: string;
  actorUserId: string | null;
};

export const adminLeasesApi = {
  list: () => request<LeaseListResponse>(""),
  detail: (leaseId: string) =>
    request<LeaseDetailResponse>("/" + encodeURIComponent(leaseId)),
  createDraft: (input: CreateLeaseDraftInput) =>
    request<{ leaseId: string; residentId: string; status: "DRAFT" }>("", {
      method: "POST",
      body: input
    }),
  attachments: (leaseId: string) =>
    request<{ leaseId: string; attachments: LeaseAttachment[] }>(
      "/" + encodeURIComponent(leaseId) + "/attachments"
    ),
  addAttachment: (
    leaseId: string,
    input: {
      attachmentId?: string;
      attachmentType: LeaseAttachment["attachmentType"];
      fileName: string;
      fileUrl: string;
      fileSizeBytes?: number | null;
      mimeType?: string | null;
      note?: string | null;
    }
  ) =>
    request<LeaseAttachment>("/" + encodeURIComponent(leaseId) + "/attachments", {
      method: "POST",
      body: input
    }),
  deleteAttachment: (leaseId: string, attachmentId: string) =>
    request<{ success: boolean; attachmentId: string }>(
      "/" + encodeURIComponent(leaseId) + "/attachments/" + encodeURIComponent(attachmentId),
      { method: "DELETE" }
    ),
  amendments: (leaseId: string) =>
    request<{ leaseId: string; amendments: LeaseAmendment[] }>(
      "/" + encodeURIComponent(leaseId) + "/amendments"
    ),
  createAmendment: (
    leaseId: string,
    input: {
      amendmentId?: string;
      amendmentNumber: string;
      effectiveDate: string;
      changesSummary: string;
      adjustedBaseRentVnd?: number | null;
      adjustedDepositRequiredVnd?: number | null;
      adjustedPlannedEndDate?: string | null;
      note?: string | null;
    }
  ) =>
    request<{
      id: string;
      leaseId: string;
      amendmentNumber: string;
      effectiveDate: string;
      changesSummary: string;
    }>("/" + encodeURIComponent(leaseId) + "/amendments", {
      method: "POST",
      body: input
    }),
  activate: (leaseId: string, idempotencyKey: string) =>
    command("/" + encodeURIComponent(leaseId) + "/activate", idempotencyKey),
  cancelDraft: (leaseId: string, idempotencyKey: string) =>
    command("/" + encodeURIComponent(leaseId) + "/cancel-draft", idempotencyKey),
  scheduleTermination: (
    leaseId: string,
    idempotencyKey: string,
    input: { effectiveDate: string; reason: string }
  ) =>
    command(
      "/" + encodeURIComponent(leaseId) + "/termination",
      idempotencyKey,
      input
    ),
  cancelTermination: (leaseId: string, idempotencyKey: string) =>
    command(
      "/" + encodeURIComponent(leaseId) + "/termination/cancel",
      idempotencyKey
    ),
  finalizeTermination: (leaseId: string, idempotencyKey: string) =>
    command(
      "/" + encodeURIComponent(leaseId) + "/termination/finalize",
      idempotencyKey
    ),
  searchResidents: (propertyId: string, query: string) =>
    request<{ residents: ResidentSearchResult[] }>(
      "/residents/search?propertyId=" +
        encodeURIComponent(propertyId) +
        "&q=" +
        encodeURIComponent(query)
    ),
  updateDraft: (
    leaseId: string,
    input: {
      expectedVersion: number;
      leaseCode: string;
      startDate: string;
      plannedEndDate?: string | null;
      baseRentVnd: number;
      depositRequiredVnd: number;
      billingDay: number;
    }
  ) =>
    request<{ leaseId: string; status: "DRAFT"; version: number }>(
      "/" + encodeURIComponent(leaseId) + "/draft",
      { method: "PATCH", body: input }
    ),
  replaceDraftPrimaryTenant: (
    leaseId: string,
    input: {
      expectedVersion: number;
      idempotencyKey: string;
      residentId: string;
      previousPrimaryDisposition:
        | "REMOVE"
        | "CO_TENANT"
        | "OCCUPANT";
      resident?: {
        fullName: string;
        phone?: string | null;
        email?: string | null;
      } | null;
    }
  ) =>
    request<{
      leaseId: string;
      previousPrimaryResidentId: string;
      primaryResidentId: string;
      previousPrimaryDisposition:
        | "REMOVE"
        | "CO_TENANT"
        | "OCCUPANT";
      version: number;
    }>(
      "/" +
        encodeURIComponent(leaseId) +
        "/draft/primary-tenant",
      { method: "PATCH", body: input }
    ),
  addDraftParty: (
    leaseId: string,
    input: {
      residentId: string;
      partyRole: "CO_TENANT" | "OCCUPANT";
      resident?: {
        fullName: string;
        phone?: string | null;
        email?: string | null;
      } | null;
    }
  ) =>
    request(
      "/" + encodeURIComponent(leaseId) + "/draft/parties",
      { method: "POST", body: input }
    ),
  removeDraftParty: (leaseId: string, residentId: string) =>
    request(
      "/" +
        encodeURIComponent(leaseId) +
        "/draft/parties/" +
        encodeURIComponent(residentId) +
        "/remove",
      { method: "POST" }
    ),
  deposit: (leaseId: string) =>
    request<LeaseDepositSummary>(
      "/" + encodeURIComponent(leaseId) + "/deposit"
    ),
  recordDepositCollection: (
    leaseId: string,
    input: {
      idempotencyKey: string;
      amountVnd: number;
      occurredAt: string;
      note?: string | null;
    }
  ) =>
    request<LeaseDepositSummary>(
      "/" + encodeURIComponent(leaseId) + "/deposit/collections",
      { method: "POST", body: input }
    ),
  settleDeposit: (
    leaseId: string,
    input: {
      idempotencyKey: string;
      refundVnd: number;
      deductionVnd: number;
      occurredAt: string;
      note: string;
    }
  ) =>
    request<
      LeaseDepositSummary & {
        termination: {
          status: string;
          depositReadiness: "READY" | "NOT_REQUIRED";
        };
      }
    >(
      "/" + encodeURIComponent(leaseId) + "/deposit/settlement",
      { method: "POST", body: input }
    ),
  terminationMeterReadiness: (leaseId: string) =>
    request<LeaseTerminationMeterReadiness>(
      "/" +
        encodeURIComponent(leaseId) +
        "/termination/meter-readiness"
    ),
  recordMeterReading: (
    meterId: string,
    input: {
      id: string;
      readingDate: string;
      readingValue: string | number;
      source?: "ADMIN" | "STAFF" | "IMPORT";
    }
  ) =>
    adminApiRequest<{
      id: string;
      readingDate: string;
      readingValue: string;
      source: "ADMIN" | "STAFF" | "IMPORT";
    }>(
      "/admin/metering/meters/" +
        encodeURIComponent(meterId) +
        "/readings",
      { method: "POST", body: input }
    ),
  terminationFinancialReadiness: (leaseId: string) =>
    request<LeaseTerminationFinancialReadiness>(
      "/" + encodeURIComponent(leaseId) + "/termination/financial-readiness"
    ),
  renewLease: (
    leaseId: string,
    input: {
      newLeaseId: string;
      idempotencyKey: string;
      newLeaseCode: string;
      startDate: string;
      plannedEndDate?: string | null;
      baseRentVnd: number;
      depositRequiredVnd: number;
      billingDay: number;
      rolloverDeposit?: boolean;
    }
  ) =>
    request<{
      leaseId: string;
      renewedFromLeaseId: string;
      status: "DRAFT";
    }>("/" + encodeURIComponent(leaseId) + "/renew", {
      method: "POST",
      body: input
    }),
  setTerminationReadiness: (
    leaseId: string,
    input: {
      kind: "financial";
      state: "PENDING" | "READY" | "NOT_REQUIRED";
      reason: string;
    }
  ) =>
    request<{
      meter: "PENDING" | "READY" | "NOT_REQUIRED";
      financial: "PENDING" | "READY" | "NOT_REQUIRED";
      deposit: "PENDING" | "READY" | "NOT_REQUIRED";
    }>(
      "/" + encodeURIComponent(leaseId) + "/termination/readiness",
      { method: "POST", body: input }
    )
};
