import { adminApiRequest } from "./admin-api-client";

/** All values are scoped to the authenticated membership's visible properties. */
export type DashboardOverview = {
  monthLabel: string;
  summary: {
    propertyCount: number;
    roomCount: number;
    occupiedRoomCount: number;
    newRoomsLast30Days: number;
    collectedThisMonthVnd: number | null;
    outstandingVnd: number | null;
    overdueRooms: number | null;
    expiringLeases: number | null;
    failedNotifications: number | null;
  };
  billingProgress: {
    totalOccupiedRooms: number;
    billedRooms: number | null;
    reviewInvoices: number | null;
    overdueRooms: number | null;
  };
  properties: Array<{
    id: string;
    code: string;
    name: string;
    administrativeArea: string | null;
    rooms: number;
    occupiedRooms: number;
    billedRooms: number | null;
    outstandingVnd: number | null;
    collectedThisMonthVnd: number | null;
    overdueRooms: number | null;
    reviewInvoices: number | null;
  }>;
};

export const adminDashboardApi = {
  overview: () => adminApiRequest<DashboardOverview>("/admin/assets/dashboard")
};
