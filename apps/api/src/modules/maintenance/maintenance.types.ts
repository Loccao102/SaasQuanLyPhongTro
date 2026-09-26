export const maintenanceTicketCategories = [
  "ELECTRICITY",
  "PLUMBING",
  "APPLIANCE",
  "STRUCTURAL",
  "INTERNET",
  "OTHER"
] as const;

export type MaintenanceTicketCategory = (typeof maintenanceTicketCategories)[number];

export const maintenanceTicketPriorities = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT"
] as const;

export type MaintenanceTicketPriority = (typeof maintenanceTicketPriorities)[number];

export const maintenanceTicketStatuses = [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
  "CANCELLED"
] as const;

export type MaintenanceTicketStatus = (typeof maintenanceTicketStatuses)[number];

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
