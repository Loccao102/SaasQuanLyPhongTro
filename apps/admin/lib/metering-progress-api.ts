import { adminApiRequest } from "./admin-api-client";

export type MeteringProgressResponse = {
  organization: { id: string; name: string };
  readingDate: string;
  summary: {
    propertyCount: number;
    roomCount: number;
    completedRoomCount: number;
    pendingRoomCount: number;
    missingMeterRoomCount: number;
  };
  properties: Array<{
    id: string;
    code: string;
    name: string;
    roomCount: number;
    completedRoomCount: number;
    pendingRoomCount: number;
    missingMeterRoomCount: number;
  }>;
};

export type AdminMeterItem = {
  id: string;
  meterType: "ELECTRICITY" | "WATER";
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

export type AdminChecklistRoom = {
  id: string;
  code: string;
  name: string;
  floor: { id: string; code: string | null; name: string | null } | null;
  electricity: AdminMeterItem | null;
  water: AdminMeterItem | null;
  requiredMeterTypes: Array<"ELECTRICITY" | "WATER">;
  waterBillingMode:
    | "WATER_PER_M3"
    | "WATER_PER_PERSON"
    | "WATER_PER_ROOM"
    | null;
  complete: boolean;
  missingMeter: boolean;
};

export type AdminChecklistProperty = {
  id: string;
  code: string;
  name: string;
  writeAllowed: boolean;
  roomCount: number;
  completedRoomCount: number;
  pendingRoomCount: number;
  missingMeterRoomCount: number;
  rooms: AdminChecklistRoom[];
};

export type AdminMeteringChecklistResponse = {
  organization: { id: string; name: string };
  readingDate: string;
  summary: {
    propertyCount: number;
    roomCount: number;
    completedRoomCount: number;
    pendingRoomCount: number;
    missingMeterRoomCount: number;
  };
  properties: AdminChecklistProperty[];
};

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  return adminApiRequest<T>("/admin/metering" + path, init);
}

export const meteringProgressApi = {
  load: (readingDate: string) =>
    request<MeteringProgressResponse>(
      "/progress?readingDate=" + encodeURIComponent(readingDate)
    ),
  loadChecklist: (readingDate: string) =>
    request<AdminMeteringChecklistResponse>(
      "/checklist?readingDate=" + encodeURIComponent(readingDate)
    ),
  saveReading: (
    meterId: string,
    input: {
      id: string;
      readingDate: string;
      readingValue: string | number;
      allowCorrection?: boolean;
    }
  ) =>
    request<{
      id: string;
      readingDate: string;
      readingValue: string;
      source: string;
    }>("/meters/" + encodeURIComponent(meterId) + "/readings", {
      method: "POST",
      body: input
    }),
  batchSaveReadings: (input: {
    readingDate: string;
    readings: Array<{
      id: string;
      meterId: string;
      readingValue: string | number;
      allowCorrection?: boolean;
    }>;
  }) =>
    request<{
      readingDate: string;
      savedCount: number;
      readings: Array<{
        id: string;
        readingDate: string;
        readingValue: string;
        source: string;
      }>;
    }>("/readings/batch", {
      method: "POST",
      body: input
    })
};
