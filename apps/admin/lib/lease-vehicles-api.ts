import { adminApiRequest } from "./admin-api-client";

export type LeaseVehicle = {
  id: string;
  leaseId: string;
  vehicleType: "MOTORBIKE" | "ELECTRIC_BIKE" | "BICYCLE" | "CAR" | "OTHER";
  licensePlate: string;
  brandModel: string | null;
  ownerName: string | null;
  isActive: boolean;
  registeredAt: string;
  unregisteredAt: string | null;
  createdAt: string;
};

export const leaseVehiclesApi = {
  list: (leaseId: string) =>
    adminApiRequest<LeaseVehicle[]>(
      `/admin/leases/${encodeURIComponent(leaseId)}/vehicles`
    ),
  add: (
    leaseId: string,
    input: {
      licensePlate: string;
      vehicleType?: string;
      brandModel?: string;
      ownerName?: string;
      registeredAt?: string;
    }
  ) =>
    adminApiRequest<LeaseVehicle>(
      `/admin/leases/${encodeURIComponent(leaseId)}/vehicles`,
      {
        method: "POST",
        body: input
      }
    ),
  update: (
    leaseId: string,
    vehicleId: string,
    input: {
      licensePlate?: string;
      vehicleType?: string;
      brandModel?: string;
      ownerName?: string;
      isActive?: boolean;
    }
  ) =>
    adminApiRequest<{ success: boolean; vehicleId: string; isActive: boolean }>(
      `/admin/leases/${encodeURIComponent(leaseId)}/vehicles/${encodeURIComponent(vehicleId)}`,
      {
        method: "PATCH",
        body: input
      }
    ),
  remove: (leaseId: string, vehicleId: string) =>
    adminApiRequest<{ success: boolean }>(
      `/admin/leases/${encodeURIComponent(leaseId)}/vehicles/${encodeURIComponent(vehicleId)}`,
      {
        method: "DELETE"
      }
    )
};
