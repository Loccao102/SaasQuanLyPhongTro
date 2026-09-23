export type MeterType = "ELECTRICITY" | "WATER";

export type MeterChecklist = {
  id: string;
  meterType: MeterType;
  unit: "KWH" | "M3";
  previousReading: {
    readingDate: string;
    readingValue: string;
  } | null;
  currentReading: {
    readingDate: string;
    readingValue: string;
  } | null;
  baselineUsage: string | null;
};

export type StaffRoomChecklist = {
  id: string;
  code: string;
  name: string;
  floor: { id: string; code: string | null; name: string | null } | null;
  electricity: MeterChecklist | null;
  water: MeterChecklist | null;
  complete: boolean;
  missingMeter: boolean;
};

export type StaffPropertyChecklist = {
  id: string;
  code: string;
  name: string;
  writeAllowed: boolean;
  rooms: StaffRoomChecklist[];
  roomCount: number;
  completedRoomCount: number;
  pendingRoomCount: number;
  missingMeterRoomCount: number;
};

export type StaffMeteringChecklistResponse = {
  organization: { id: string; name: string };
  principal: { role: string };
  readingDate: string;
  properties: StaffPropertyChecklist[];
  summary: {
    propertyCount: number;
    roomCount: number;
    completedRoomCount: number;
    pendingRoomCount: number;
    missingMeterRoomCount: number;
  };
};

export type ServerReading = {
  id: string;
  readingDate: string;
  readingValue: string;
  source: "ADMIN" | "STAFF" | "IMPORT";
};

export class StaffMeteringApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly serverReading: ServerReading | null
  ) {
    super(message);
    this.name = "StaffMeteringApiError";
  }
}

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";
const configuredOrganizationId =
  process.env.NEXT_PUBLIC_STAFF_ORGANIZATION_ID?.trim() ||
  process.env.NEXT_PUBLIC_ADMIN_ORGANIZATION_ID?.trim() ||
  "";

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

  let response: Response;
  try {
    response = await fetch(apiBase + "/staff/metering" + path, {
      credentials: "include",
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body)
    });
  } catch {
    throw new StaffMeteringApiError(
      "Không thể kết nối máy chủ.",
      0,
      "NETWORK_ERROR",
      null
    );
  }

  if (!response.ok) {
    const raw = await response.text();
    let parsed: {
      message?: string;
      code?: string;
      serverReading?: ServerReading;
    } | null = null;
    try {
      parsed = JSON.parse(raw) as {
        message?: string;
        code?: string;
        serverReading?: ServerReading;
      };
    } catch {
      parsed = null;
    }
    throw new StaffMeteringApiError(
      parsed?.message || raw || "Metering request failed.",
      response.status,
      parsed?.code ?? null,
      parsed?.serverReading ?? null
    );
  }

  return response.json() as Promise<T>;
}

export const staffMeteringApi = {
  checklist: (readingDate: string) =>
    request<StaffMeteringChecklistResponse>(
      "/checklist?readingDate=" + encodeURIComponent(readingDate)
    ),
  addReading: (
    meterId: string,
    input: {
      id: string;
      readingDate: string;
      readingValue: string;
    }
  ) =>
    request<ServerReading>(
      "/meters/" + encodeURIComponent(meterId) + "/readings",
      {
        method: "POST",
        body: input
      }
    )
};
