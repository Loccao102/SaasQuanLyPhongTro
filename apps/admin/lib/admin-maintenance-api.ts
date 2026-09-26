import { adminApiRequest } from "./admin-api-client";

export type MaintenanceTicketCategory =
  | "ELECTRICITY"
  | "PLUMBING"
  | "APPLIANCE"
  | "STRUCTURAL"
  | "INTERNET"
  | "OTHER";

export type MaintenanceTicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type MaintenanceTicketStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "RESOLVED"
  | "CLOSED"
  | "CANCELLED";

export interface MaintenanceTicket {
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

export interface CreateMaintenanceTicketInput {
  propertyId: string;
  roomId?: string | null;
  leaseId?: string | null;
  title: string;
  category?: MaintenanceTicketCategory;
  priority?: MaintenanceTicketPriority;
  description: string;
  residentName: string;
  residentPhone?: string | null;
  images?: string[];
}

export interface UpdateMaintenanceTicketInput {
  title?: string;
  category?: MaintenanceTicketCategory;
  priority?: MaintenanceTicketPriority;
  status?: MaintenanceTicketStatus;
  description?: string;
  residentName?: string;
  residentPhone?: string | null;
  resolutionNote?: string | null;
  repairCostVnd?: number;
  syncToOperatingExpense?: boolean;
  images?: string[];
}

export interface MaintenanceFilterQuery {
  propertyId?: string;
  roomId?: string;
  status?: MaintenanceTicketStatus;
  priority?: MaintenanceTicketPriority;
  category?: MaintenanceTicketCategory;
  limit?: number;
}

export const adminMaintenanceApi = {
  list: (query?: MaintenanceFilterQuery) => {
    const params = new URLSearchParams();
    if (query?.propertyId) params.set("propertyId", query.propertyId);
    if (query?.roomId) params.set("roomId", query.roomId);
    if (query?.status) params.set("status", query.status);
    if (query?.priority) params.set("priority", query.priority);
    if (query?.category) params.set("category", query.category);
    if (query?.limit) params.set("limit", String(query.limit));

    const qs = params.toString();
    return adminApiRequest<MaintenanceTicket[]>(
      "/admin/maintenance" + (qs ? "?" + qs : "")
    );
  },

  get: (ticketId: string) =>
    adminApiRequest<MaintenanceTicket>(
      "/admin/maintenance/" + encodeURIComponent(ticketId)
    ),

  create: (input: CreateMaintenanceTicketInput) =>
    adminApiRequest<MaintenanceTicket>("/admin/maintenance", {
      method: "POST",
      body: input
    }),

  update: (ticketId: string, input: UpdateMaintenanceTicketInput) =>
    adminApiRequest<MaintenanceTicket>(
      "/admin/maintenance/" + encodeURIComponent(ticketId),
      {
        method: "PATCH",
        body: input
      }
    ),

  delete: (ticketId: string) =>
    adminApiRequest<{ success: boolean; id: string }>(
      "/admin/maintenance/" + encodeURIComponent(ticketId),
      {
        method: "DELETE"
      }
    )
};
