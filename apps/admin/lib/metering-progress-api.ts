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

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";
const configuredOrganizationId =
  process.env.NEXT_PUBLIC_ADMIN_ORGANIZATION_ID?.trim() ?? "";

async function request<T>(path: string): Promise<T> {
  const headers = new Headers();
  if (configuredOrganizationId) {
    headers.set("x-organization-id", configuredOrganizationId);
  }

  const response = await fetch(apiBase + "/admin/metering" + path, {
    credentials: "include",
    headers
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || "Metering API request failed with status " + String(response.status)
    );
  }
  return response.json() as Promise<T>;
}

export const meteringProgressApi = {
  load: (readingDate: string) =>
    request<MeteringProgressResponse>(
      "/progress?readingDate=" + encodeURIComponent(readingDate)
    )
};
