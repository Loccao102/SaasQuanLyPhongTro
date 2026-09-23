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

  const response = await fetch(apiBase + "/admin/assets" + path, {
    credentials: "include",
    method: init?.method ?? "GET",
    headers,
    body:
      init?.body === undefined ? undefined : JSON.stringify(init.body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || "Admin API request failed with status " + String(response.status)
    );
  }

  return response.json() as Promise<T>;
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
    })
};
