import { adminApiRequest } from "./admin-api-client";

export type AdminMeterType = "ELECTRICITY" | "WATER";

export type AdminMeter = {
  id: string;
  meterType: AdminMeterType;
  unit: "KWH" | "M3";
  label: string | null;
  isActive: boolean;
};

export type AdminMeterReading = {
  id: string;
  readingDate: string;
  readingValue: string;
  source: "ADMIN" | "STAFF" | "IMPORT";
};

export const adminMeteringApi = {
  roomMeters: (roomId: string) =>
    adminApiRequest<{ roomId: string; meters: AdminMeter[] }>(
      "/admin/metering/rooms/" + encodeURIComponent(roomId) + "/meters"
    ),

  createMeter: (input: {
    id: string;
    roomId: string;
    meterType: AdminMeterType;
    label?: string;
  }) =>
    adminApiRequest<AdminMeter>("/admin/metering/meters", {
      method: "POST",
      body: input
    }),

  updateMeter: (
    meterId: string,
    input: { label?: string | null; isActive?: boolean }
  ) =>
    adminApiRequest<AdminMeter>(
      "/admin/metering/meters/" + encodeURIComponent(meterId),
      {
        method: "PATCH",
        body: input
      }
    ),

  addReading: (
    meterId: string,
    input: {
      id: string;
      readingDate: string;
      readingValue: string | number;
      source?: "ADMIN" | "STAFF" | "IMPORT";
    }
  ) =>
    adminApiRequest<AdminMeterReading>(
      "/admin/metering/meters/" +
        encodeURIComponent(meterId) +
        "/readings",
      {
        method: "POST",
        body: input
      }
    )
};
