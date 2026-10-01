import { adminApiRequest } from "./admin-api-client";

export type AdminAssetPropertySummary = {
  id: string;
  code: string;
  name: string;
  type: string;
  address: string | null;
  administrativeArea: string | null;
  floors: number;
  rooms: number;
  occupiedRooms: number;
  vacantRooms: number;
};

export type AdminAssetOverview = {
  organization: { id: string; name: string };
  principal: { role: string };
  summary: {
    propertyCount: number;
    floorCount: number;
    roomCount: number;
    occupiedRoomCount: number;
    vacantRoomCount: number;
  };
  properties: AdminAssetPropertySummary[];
};

export type AdminPropertyDetail = {
  organization: { id: string; name: string };
  property: AdminAssetPropertySummary;
  floors: Array<{
    id: string | null;
    code: string;
    name: string;
    sortOrder: number;
    rooms: Array<{
      id: string;
      code: string;
      name: string;
      sortOrder: number;
      occupancy: "OCCUPIED" | "VACANT";
      lease: { id: string; code: string; status: string } | null;
    }>;
  }>;
};

export type AdminRoomDetail = {
  organization: { id: string; name: string };
  room: {
    id: string;
    code: string;
    name: string;
    sortOrder: number;
    occupancy: "OCCUPIED" | "VACANT";
  };
  property: { id: string; code: string; name: string };
  floor: { id: string; code: string | null; name: string | null } | null;
  currentLease: {
    id: string;
    code: string;
    status: string;
    startDate: string | null;
    plannedEndDate: string | null;
    baseRentVnd: number;
    depositRequiredVnd: number;
  } | null;
};

export type CreatePropertyInput = {
  id: string;
  code: string;
  name: string;
  propertyType: "BOARDING_HOUSE" | "MINI_APARTMENT" | "APARTMENT" | "OTHER";
  addressText?: string | null;
};

export type CreateFloorInput = {
  id: string;
  code: string;
  name: string;
  sortOrder?: number;
};

export type CreateRoomInput = {
  id: string;
  floorId?: string | null;
  code: string;
  name: string;
  sortOrder?: number;
};

export type EquipmentConditionStatus =
  | "EXCELLENT"
  | "GOOD"
  | "FAIR"
  | "DAMAGED"
  | "NEEDS_REPAIR";

export type RoomEquipment = {
  id: string;
  organizationId: string;
  propertyId: string;
  roomId: string;
  name: string;
  brand: string | null;
  modelOrSerial: string | null;
  quantity: number;
  conditionStatus: EquipmentConditionStatus;
  compensationValueVnd: number;
  note: string | null;
  installedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateRoomEquipmentInput = {
  name: string;
  brand?: string | null;
  modelOrSerial?: string | null;
  quantity?: number;
  conditionStatus?: EquipmentConditionStatus;
  compensationValueVnd?: number;
  note?: string | null;
  installedAt?: string | null;
};

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  return adminApiRequest<T>("/admin/assets" + path, init);
}

export const adminAssetsApi = {
  overview: () => request<AdminAssetOverview>(""),
  property: (propertyId: string) =>
    request<AdminPropertyDetail>(
      "/properties/" + encodeURIComponent(propertyId)
    ),
  room: (roomId: string) =>
    request<AdminRoomDetail>("/rooms/" + encodeURIComponent(roomId)),

  createProperty: (input: CreatePropertyInput) =>
    request("/properties", { method: "POST", body: input }),
  updateProperty: (
    propertyId: string,
    input: Partial<Omit<CreatePropertyInput, "id">>
  ) =>
    request("/properties/" + encodeURIComponent(propertyId), {
      method: "PATCH",
      body: input
    }),
  deactivateProperty: (propertyId: string) =>
    request("/properties/" + encodeURIComponent(propertyId) + "/deactivate", {
      method: "POST"
    }),

  createFloor: (propertyId: string, input: CreateFloorInput) =>
    request("/properties/" + encodeURIComponent(propertyId) + "/floors", {
      method: "POST",
      body: input
    }),
  updateFloor: (
    floorId: string,
    input: Partial<Omit<CreateFloorInput, "id">>
  ) =>
    request("/floors/" + encodeURIComponent(floorId), {
      method: "PATCH",
      body: input
    }),
  deactivateFloor: (floorId: string) =>
    request("/floors/" + encodeURIComponent(floorId) + "/deactivate", {
      method: "POST"
    }),

  createRoom: (propertyId: string, input: CreateRoomInput) =>
    request("/properties/" + encodeURIComponent(propertyId) + "/rooms", {
      method: "POST",
      body: input
    }),
  updateRoom: (
    roomId: string,
    input: Partial<Omit<CreateRoomInput, "id">>
  ) =>
    request("/rooms/" + encodeURIComponent(roomId), {
      method: "PATCH",
      body: input
    }),
  deactivateRoom: (roomId: string) =>
    request("/rooms/" + encodeURIComponent(roomId) + "/deactivate", {
      method: "POST"
    }),

  roomEquipment: (roomId: string) =>
    request<RoomEquipment[]>("/rooms/" + encodeURIComponent(roomId) + "/equipment"),
  createRoomEquipment: (roomId: string, input: CreateRoomEquipmentInput) =>
    request<RoomEquipment>(
      "/rooms/" + encodeURIComponent(roomId) + "/equipment",
      {
        method: "POST",
        body: input
      }
    ),
  updateRoomEquipment: (
    roomId: string,
    equipmentId: string,
    input: Partial<CreateRoomEquipmentInput>
  ) =>
    request<RoomEquipment>(
      "/rooms/" +
        encodeURIComponent(roomId) +
        "/equipment/" +
        encodeURIComponent(equipmentId),
      {
        method: "PATCH",
        body: input
      }
    ),
  deleteRoomEquipment: (roomId: string, equipmentId: string) =>
    request<{ success: boolean; id: string }>(
      "/rooms/" +
        encodeURIComponent(roomId) +
        "/equipment/" +
        encodeURIComponent(equipmentId),
      {
        method: "DELETE"
      }
    ),

  validateImport: (payload: PropertyImportPayload) =>
    request<PropertyImportValidationReport>("/import/validate", {
      method: "POST",
      body: { payload }
    }),

  executeImport: (payload: PropertyImportPayload) =>
    request<PropertyImportResult>("/import/execute", {
      method: "POST",
      body: { payload }
    })
};

export type PropertyImportPayload = {
  mode?: "CREATE_NEW" | "EXISTING_PROPERTY";
  targetPropertyId?: string;
  autoCreateMeters?: boolean;
  property?: {
    code: string;
    name: string;
    propertyType: "BOARDING_HOUSE" | "MINI_APARTMENT" | "APARTMENT" | "OTHER";
    addressText?: string;
    provinceName?: string;
    districtName?: string;
    wardName?: string;
  };
  floors: Array<{
    code: string;
    name: string;
    sortOrder?: number;
  }>;
  rooms: Array<{
    floorCode?: string;
    code: string;
    name: string;
    sortOrder?: number;
  }>;
  equipments: Array<{
    roomCode: string;
    name: string;
    brand?: string;
    modelOrSerial?: string;
    quantity?: number;
    conditionStatus?: EquipmentConditionStatus;
    compensationValueVnd?: number;
    note?: string;
  }>;
};

export type PropertyImportValidationReport = {
  isValid: boolean;
  summary: {
    isExistingProperty?: boolean;
    propertyCode: string;
    propertyName: string;
    propertyType: string;
    locationText: string;
    floorCount: number;
    roomCount: number;
    newRoomCount?: number;
    existingRoomCount?: number;
    autoCreateMeters?: boolean;
    equipmentCount: number;
  };
  errors: Array<{
    section: "PROPERTY" | "FLOORS" | "ROOMS" | "EQUIPMENTS";
    row?: number;
    itemCode?: string;
    message: string;
  }>;
  warnings: string[];
};

export type PropertyImportResult = {
  propertyId: string;
  propertyCode: string;
  propertyName: string;
  floorCount: number;
  roomCount: number;
  newRoomCount?: number;
  existingRoomCount?: number;
  metersCreatedCount?: number;
  equipmentCount: number;
  administrativeAreaId: string | null;
};

