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

export const adminLeasesApi = {
  list: () => request<LeaseListResponse>(""),
  detail: (leaseId: string) =>
    request<LeaseDetailResponse>("/" + encodeURIComponent(leaseId)),
  createDraft: (input: CreateLeaseDraftInput) =>
    request<{ leaseId: string; residentId: string; status: "DRAFT" }>("", {
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
  setTerminationReadiness: (
    leaseId: string,
    input: {
      kind: "meter" | "financial" | "deposit";
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
