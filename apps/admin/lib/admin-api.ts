export type AdminDashboard = {
  branding: {
    productName: string;
    descriptor: string;
    tagline: string;
    palette: Record<string, unknown>;
  };
  display: {
    locale: string;
    timezone: string;
    currencyCode: string;
    dateFormat: string;
    dateTimeFormat: string;
    presets: Record<string, unknown>;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
    status: string;
    userDisplayName: string;
    role: string;
    scopeMode: "ORGANIZATION" | "SCOPED";
    authorizedPropertyCount: number;
  };
  windows: {
    leaseExpiryDays: number;
    topItemsLimit: number;
  };
  subscription: {
    status: string;
    accessMode: string;
    planCode: string;
    roomLimit: number;
    staffLimit: number;
    automationQuota: number;
  } | null;
  metrics: {
    activeProperties: number;
    activeRooms: number;
    occupiedRooms: number;
    vacantRooms: number;
    occupancyRatePercent: number;
    activeResidents: number;
    activeLeases: number;
    terminationScheduledLeases: number;
    draftLeases: number;
    expiringLeases: number;
    contractedMonthlyRentVnd: number;
    requiredDepositVnd: number;
  };
  topProperties: Array<{
    id: string;
    code: string;
    name: string;
    addressText: string | null;
    activeRooms: number;
    occupiedRooms: number;
    vacantRooms: number;
    occupancyRatePercent: number;
    contractedMonthlyRentVnd: number;
  }>;
  expiringLeases: Array<{
    id: string;
    leaseCode: string;
    plannedEndDate: string;
    daysRemaining: number;
    propertyId: string;
    propertyName: string;
    roomId: string;
    roomCode: string;
    roomName: string;
    primaryResidentName: string | null;
  }>;
};

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

function baseUrl(): string {
  return (
    process.env.ADMIN_API_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    "http://localhost:4000/api"
  ).replace(/\/$/, "");
}

async function request<T>(path: string): Promise<T> {
  const organizationId =
    process.env.ADMIN_DEV_ORGANIZATION_ID?.trim();
  const headers: Record<string, string> = {
    accept: "application/json"
  };
  if (organizationId) {
    headers["x-organization-id"] = organizationId;
  }

  const response = await fetch(baseUrl() + path, {
    method: "GET",
    headers,
    cache: "no-store"
  });

  if (!response.ok) {
    let message = "Không thể tải dữ liệu Habi Admin.";
    try {
      const payload = (await response.json()) as {
        message?: string | string[];
      };
      if (Array.isArray(payload.message)) {
        message = payload.message.join(" ");
      } else if (typeof payload.message === "string") {
        message = payload.message;
      }
    } catch {
      // Keep a safe user-facing fallback.
    }
    throw new AdminApiError(response.status, message);
  }

  return (await response.json()) as T;
}

export const adminApi = {
  dashboard: () => request<AdminDashboard>("/admin/dashboard")
};
