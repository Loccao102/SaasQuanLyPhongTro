import { buildStyledReportExcel } from "./report-excel-export";
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
  propertyName?: string;
}

// ── Styled .xlsx export, sourced from authorized report CSV endpoint ──

async function downloadExcel(
  path: string,
  title: string,
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

  // Parse the CSV payload as text with Excel's parser. Keep values raw to
  // preserve leading zeros for phone numbers, tenant IDs and room codes.
  const csvText = (await response.text()).replace(/^\uFEFF/, "");
  const XLSX = await import("xlsx");
  const csv = XLSX.read(csvText, { type: "string", raw: true });
  const sheet = csv.Sheets[csv.SheetNames[0] ?? ""];
  if (!sheet) throw new Error("Báo cáo trả về không có dữ liệu hợp lệ.");
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1, raw: true, defval: ""
  });
  const columnLabels = (rows[0] ?? []).map(value => String(value ?? "").trim());
  if (!columnLabels.length || columnLabels.every(value => !value)) {
    throw new Error("Không tìm thấy tên cột của báo cáo.");
  }
  const records = rows.slice(1).filter(row => row.some(value => String(value ?? "").trim()));
  const book = buildStyledReportExcel({
    title, headers: columnLabels, records,
    fromDate: params?.fromDate,
    toDate: params?.toDate,
    propertyName: params?.propertyName
  });
  const fileName = "Habi_" + title.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "") +
    "_" + new Date().toISOString().slice(0, 10) + ".xlsx";
  const blob = new Blob([new Uint8Array(book)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 5000);
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

  // Styled Excel exports with Vietnamese Unicode and numeric/date formats.
  downloadMeterReadings: (params?: ReportFilters) =>
    downloadExcel("/admin/reports/meter-readings/export", "Chỉ số điện nước", params),

  downloadRevenueDebt: (params?: ReportFilters) =>
    downloadExcel("/admin/reports/revenue-debt/export", "Doanh thu và công nợ", params),

  downloadCashflow: (params?: ReportFilters) =>
    downloadExcel("/admin/reports/cashflow/export", "Dòng tiền thu chi", params),

  downloadPropertySummary: (params?: ReportFilters) =>
    downloadExcel("/admin/reports/property-summary/export", "Tổng hợp cơ sở", params)
};
