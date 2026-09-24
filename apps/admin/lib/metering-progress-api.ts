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
    )
};
