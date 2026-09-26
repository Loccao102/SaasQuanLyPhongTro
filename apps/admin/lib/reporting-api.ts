import { adminApiRequest } from "./admin-api-client";

// ── Types ────────────────────────────────────────────────────

export interface PropertySummary {
  property_name: string;
  property_code: string;
  total_rooms: number;
  occupied_rooms: number;
  occupancy_rate: string;
  total_revenue_vnd: string;
  total_expense_vnd: string;
  net_income_vnd: string;
  outstanding_debt_vnd: string;
}

export interface ReportFilters {
  propertyId?: string;
  fromDate?: string;
  toDate?: string;
}

// ── CSV download helper ──────────────────────────────────────

async function downloadCsv(
  path: string,
  params?: ReportFilters
): Promise<void> {
  const apiBase =
    process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL?.trim() || "/api";
  const organizationId =
    typeof window !== "undefined"
      ? localStorage.getItem("habi:selected-organization-id")?.trim() ||
        process.env.NEXT_PUBLIC_ADMIN_ORGANIZATION_ID?.trim() ||
        ""
      : "";

  const sp = new URLSearchParams();
  if (params?.propertyId) sp.set("propertyId", params.propertyId);
  if (params?.fromDate) sp.set("fromDate", params.fromDate);
  if (params?.toDate) sp.set("toDate", params.toDate);
  const qs = sp.toString();

  const url = apiBase + path + (qs ? "?" + qs : "");

  const headers: HeadersInit = {};
  if (organizationId) {
    headers["x-organization-id"] = organizationId;
  }

  // Read CSRF token
  if (typeof document !== "undefined") {
    const csrfName =
      process.env.NEXT_PUBLIC_AUTH_CSRF_COOKIE_NAME?.trim() ||
      (process.env.NODE_ENV === "production"
        ? "__Host-propops_csrf"
        : "propops_csrf");
    for (const part of document.cookie.split(";")) {
      const sep = part.indexOf("=");
      if (sep > 0 && part.slice(0, sep).trim() === csrfName) {
        headers["x-csrf-token"] = part.slice(sep + 1).trim();
        break;
      }
    }
  }

  const response = await fetch(url, {
    credentials: "include",
    headers
  });

  if (!response.ok) {
    throw new Error("Tải xuống báo cáo thất bại: " + response.status);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
  const filename = (filenameMatch && filenameMatch[1])
    ? filenameMatch[1]
    : "report_" + new Date().toISOString().slice(0, 10) + ".csv";

  // Trigger browser download
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename as string;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

// ── API Client ───────────────────────────────────────────────

export const reportingApi = {
  // JSON data endpoints
  propertySummary: (params?: { fromDate?: string; toDate?: string }) => {
    const sp = new URLSearchParams();
    if (params?.fromDate) sp.set("fromDate", params.fromDate);
    if (params?.toDate) sp.set("toDate", params.toDate);
    const qs = sp.toString();
    return adminApiRequest<{ properties: PropertySummary[] }>(
      "/admin/reports/property-summary" + (qs ? "?" + qs : "")
    );
  },

  // CSV download endpoints
  downloadMeterReadings: (params?: ReportFilters) =>
    downloadCsv("/admin/reports/meter-readings/export", params),

  downloadRevenueDebt: (params?: ReportFilters) =>
    downloadCsv("/admin/reports/revenue-debt/export", params),

  downloadCashflow: (params?: ReportFilters) =>
    downloadCsv("/admin/reports/cashflow/export", params),

  downloadPropertySummary: (params?: { fromDate?: string; toDate?: string }) =>
    downloadCsv("/admin/reports/property-summary/export", params)
};
