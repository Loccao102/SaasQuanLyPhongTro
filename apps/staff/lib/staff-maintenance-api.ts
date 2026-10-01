import {
  staffApiFetch,
  StaffNetworkError
} from "./staff-api-client";

export type MaintenanceTicketCategory =
  | "ELECTRICITY"
  | "PLUMBING"
  | "APPLIANCE"
  | "STRUCTURAL"
  | "INTERNET"
  | "OTHER";

export type MaintenanceTicketPriority =
  | "LOW"
  | "NORMAL"
  | "HIGH"
  | "URGENT";

export type MaintenanceTicketStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "RESOLVED"
  | "CLOSED"
  | "CANCELLED";

export interface StaffMaintenanceTicket {
  id: string;
  organizationId: string;
  propertyId: string;
  propertyName: string;
  propertyCode: string;
  roomId: string | null;
  roomCode: string | null;
  roomName: string | null;
  leaseId: string | null;
  title: string;
  category: MaintenanceTicketCategory;
  priority: MaintenanceTicketPriority;
  status: MaintenanceTicketStatus;
  description: string;
  residentName: string;
  residentPhone: string | null;
  images: string[];
  reportedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  repairCostVnd: number;
  linkedExpenseId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export class StaffMaintenanceApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "StaffMaintenanceApiError";
  }
}

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  let response: Response;
  try {
    response = await staffApiFetch("/admin/maintenance" + path, init);
  } catch (error) {
    if (error instanceof StaffNetworkError) {
      throw new StaffMaintenanceApiError("Không thể kết nối máy chủ.", 0);
    }
    throw error;
  }

  if (!response.ok) {
    const raw = await response.text();
    let message = "Yêu cầu thất bại.";
    try {
      const parsed = JSON.parse(raw) as { message?: string };
      if (parsed.message) message = parsed.message;
    } catch {
      if (raw) message = raw;
    }
    throw new StaffMaintenanceApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}

export const staffMaintenanceApi = {
  list: async (params?: { propertyId?: string; status?: string }) => {
    const query = new URLSearchParams();
    if (params?.propertyId) query.set("propertyId", params.propertyId);
    if (params?.status) query.set("status", params.status);
    const qs = query.toString();
    return request<StaffMaintenanceTicket[]>(qs ? `?${qs}` : "");
  },

  update: async (
    ticketId: string,
    input: {
      status?: MaintenanceTicketStatus;
      resolutionNote?: string;
      repairCostVnd?: number;
    }
  ) => {
    return request<StaffMaintenanceTicket>(`/${ticketId}`, {
      method: "PATCH",
      body: input
    });
  },

  create: async (input: {
    propertyId: string;
    roomId?: string;
    title: string;
    category?: MaintenanceTicketCategory;
    priority?: MaintenanceTicketPriority;
    description?: string;
    residentName?: string;
    residentPhone?: string;
  }) => {
    return request<StaffMaintenanceTicket>("", {
      method: "POST",
      body: input
    });
  }
};
