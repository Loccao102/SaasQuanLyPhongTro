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
  primaryResident: {
    fullName: string;
    phone?: string | null;
    email?: string | null;
  };
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

  const response = await fetch(apiBase + "/admin/leases" + path, {
    credentials: "include",
    method: init?.method ?? "GET",
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || "Admin lease API request failed with status " + String(response.status)
    );
  }

  return response.json() as Promise<T>;
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
