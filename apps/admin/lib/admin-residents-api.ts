import { adminApiRequest } from "./admin-api-client";

export type Resident = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  identityDocumentType: string | null;
  identityDocumentNumber: string | null;
  dateOfBirth: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ResidentLease = {
  leaseId: string;
  leaseCode: string;
  status: string;
  startDate: string;
  plannedEndDate: string | null;
  partyRole: string;
  roomCode: string;
  roomName: string;
  propertyName: string;
};

export type ResidentListResponse = {
  residents: Resident[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type ResidentDetailResponse = {
  resident: Resident;
  leases: ResidentLease[];
};

export type CreateResidentInput = {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  identityDocumentType?: string | null;
  identityDocumentNumber?: string | null;
  dateOfBirth?: string | null;
  notes?: string | null;
};

export type UpdateResidentInput = Partial<CreateResidentInput>;

function req<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  return adminApiRequest<T>("/admin/residents" + path, init);
}

export const adminResidentsApi = {
  list: (params?: {
    q?: string;
    isActive?: boolean;
    propertyId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<ResidentListResponse> => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.isActive !== undefined)
      qs.set("isActive", String(params.isActive));
    if (params?.propertyId) qs.set("propertyId", params.propertyId);
    if (params?.cursor) qs.set("cursor", params.cursor);
    if (params?.limit) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? "?" + qs.toString() : "";
    return req<ResidentListResponse>(suffix);
  },

  detail: (residentId: string): Promise<ResidentDetailResponse> =>
    req<ResidentDetailResponse>("/" + encodeURIComponent(residentId)),

  create: (input: CreateResidentInput): Promise<{ resident: Resident }> =>
    req<{ resident: Resident }>("", { method: "POST", body: input }),

  update: (
    residentId: string,
    input: UpdateResidentInput
  ): Promise<{ resident: Resident }> =>
    req<{ resident: Resident }>("/" + encodeURIComponent(residentId), {
      method: "PATCH",
      body: input
    }),

  deactivate: (residentId: string): Promise<{ resident: Resident }> =>
    req<{ resident: Resident }>(
      "/" + encodeURIComponent(residentId) + "/deactivate",
      { method: "POST" }
    )
};
