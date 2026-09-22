export type AdminPropertyType =
  | "BOARDING_HOUSE"
  | "MINI_APARTMENT"
  | "APARTMENT"
  | "OTHER";

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
  principal: {
    role: string;
    capabilities: { canCreateProperty: boolean };
  };
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
  capabilities: { canManageProperty: boolean };
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

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";
const configuredOrganizationId =
  process.env.NEXT_PUBLIC_ADMIN_ORGANIZATION_ID?.trim() ?? "";

function responseMessage(text: string, fallback: string): string {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
    if (Array.isArray(parsed.message)) return parsed.message.join(" ");
  } catch {
    // Keep plain-text API errors readable.
  }
  return text;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (configuredOrganizationId) {
    headers.set("x-organization-id", configuredOrganizationId);
  }
  if (init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(apiBase + "/admin/assets" + path, {
    ...init,
    credentials: "include",
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      responseMessage(
        text,
        "Admin API request failed with status " + String(response.status)
      )
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
  createProperty: (input: {
    propertyId: string;
    code: string;
    name: string;
    propertyType: AdminPropertyType;
    addressText: string | null;
  }) =>
    request("/properties", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  createFloor: (
    propertyId: string,
    input: {
      floorId: string;
      code: string;
      name: string;
      sortOrder: number;
    }
  ) =>
    request("/properties/" + encodeURIComponent(propertyId) + "/floors", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  createRoom: (
    propertyId: string,
    input: {
      roomId: string;
      floorId: string | null;
      code: string;
      name: string;
      sortOrder: number;
    }
  ) =>
    request("/properties/" + encodeURIComponent(propertyId) + "/rooms", {
      method: "POST",
      body: JSON.stringify(input)
    })
};
