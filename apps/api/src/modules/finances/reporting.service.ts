import {
  BadRequestException,
  ForbiddenException,
  Injectable
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import { roleHasPermission } from "../identity/domain/access-control.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";

// ── Row types ────────────────────────────────────────────────

type MeterReadingExportRow = QueryResultRow & {
  property_name: string;
  property_code: string;
  room_code: string;
  meter_type: string;
  meter_serial: string;
  reading_date: Date | string;
  value: string;
  recorded_by_name: string | null;
};

type RevenueDebtRow = QueryResultRow & {
  property_name: string;
  property_code: string;
  room_code_snapshot: string;
  invoice_number: string;
  primary_resident_name_snapshot: string;
  period_start: Date | string;
  period_end: Date | string;
  due_date: Date | string;
  total_vnd: string;
  paid_vnd: string;
  remaining_vnd: string;
  collection_status: string;
  status: string;
};

type CashflowExportRow = QueryResultRow & {
  direction: "INCOME" | "EXPENSE";
  category: string | null;
  property_name: string | null;
  property_code: string | null;
  description: string;
  amount_vnd: string;
  occurred_at: Date | string;
  payer_or_payee: string | null;
  payment_method: string | null;
};

type PropertySummaryRow = QueryResultRow & {
  property_name: string;
  property_code: string;
  total_rooms: number;
  occupied_rooms: number;
  occupancy_rate: string;
  total_revenue_vnd: string;
  total_expense_vnd: string;
  net_income_vnd: string;
  outstanding_debt_vnd: string;
};

// ── Public types ─────────────────────────────────────────────

export interface ReportDateRange {
  fromDate?: string | null;
  toDate?: string | null;
}

export interface PropertyFilter extends ReportDateRange {
  propertyId?: string | null;
}

// ── CSV helpers ──────────────────────────────────────────────

function escCsv(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function dateOnly(d: Date | string): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function timestamp(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

// ── Service ──────────────────────────────────────────────────

@Injectable()
export class ReportingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService
  ) {}

  // ── 1. Meter readings export ─────────────────────────────

  async exportMeterReadings(
    principal: TenantPrincipal,
    filters: PropertyFilter
  ): Promise<{ csv: string; filename: string }> {
    this.requireReportPermission(principal);

    if (filters.propertyId) {
      await this.validatePropertyScope(principal, filters.propertyId);
    }

    const conditions: string[] = ["r.organization_id = $1::uuid"];
    const values: unknown[] = [principal.organizationId];
    let idx = 2;

    if (filters.propertyId) {
      conditions.push(`rm.property_id = $${idx++}::uuid`);
      values.push(filters.propertyId);
    }
    if (filters.fromDate) {
      conditions.push(`mr.reading_date >= $${idx++}::date`);
      values.push(filters.fromDate);
    }
    if (filters.toDate) {
      conditions.push(`mr.reading_date <= $${idx++}::date`);
      values.push(filters.toDate);
    }

    const whereClause = conditions.join(" AND ");

    const result = await this.db.query<MeterReadingExportRow>(
      `SELECT
         p.name AS property_name,
         p.code AS property_code,
         rm.code AS room_code,
         r.meter_type,
         r.serial_number AS meter_serial,
         mr.reading_date,
         mr.value::text,
         u.full_name AS recorded_by_name
       FROM meter_readings mr
       JOIN room_meters r ON r.id = mr.meter_id AND r.organization_id = mr.organization_id
       JOIN rooms rm ON rm.id = r.room_id AND rm.organization_id = r.organization_id
       JOIN properties p ON p.id = rm.property_id AND p.organization_id = rm.organization_id
       LEFT JOIN users u ON u.id = mr.recorded_by_user_id
       WHERE ${whereClause}
       ORDER BY p.code, rm.code, r.meter_type, mr.reading_date`,
      values
    );

    const bom = "\uFEFF"; // UTF-8 BOM for Excel compatibility
    const header = "Cơ sở,Mã cơ sở,Phòng,Loại đồng hồ,Số serial,Ngày ghi,Chỉ số,Người ghi";
    const rows = result.rows.map(
      (r) =>
        [
          escCsv(r.property_name),
          escCsv(r.property_code),
          escCsv(r.room_code),
          escCsv(r.meter_type === "ELECTRICITY" ? "Điện" : r.meter_type === "WATER" ? "Nước" : r.meter_type),
          escCsv(r.meter_serial),
          dateOnly(r.reading_date),
          r.value,
          escCsv(r.recorded_by_name)
        ].join(",")
    );

    const dateSuffix = new Date().toISOString().slice(0, 10);
    return {
      csv: bom + header + "\n" + rows.join("\n"),
      filename: `chi-so-dong-ho_${dateSuffix}.csv`
    };
  }

  // ── 2. Revenue / debt report ─────────────────────────────

  async exportRevenueDebt(
    principal: TenantPrincipal,
    filters: PropertyFilter
  ): Promise<{ csv: string; filename: string }> {
    this.requireReportPermission(principal);

    if (filters.propertyId) {
      await this.validatePropertyScope(principal, filters.propertyId);
    }

    const conditions: string[] = [
      "i.organization_id = $1::uuid",
      "i.status = 'ISSUED'"
    ];
    const values: unknown[] = [principal.organizationId];
    let idx = 2;

    if (filters.propertyId) {
      conditions.push(`i.property_id = $${idx++}::uuid`);
      values.push(filters.propertyId);
    }
    if (filters.fromDate) {
      conditions.push(`i.due_date >= $${idx++}::date`);
      values.push(filters.fromDate);
    }
    if (filters.toDate) {
      conditions.push(`i.due_date <= $${idx++}::date`);
      values.push(filters.toDate);
    }

    const whereClause = conditions.join(" AND ");

    const result = await this.db.query<RevenueDebtRow>(
      `SELECT
         p.name AS property_name,
         p.code AS property_code,
         i.room_code_snapshot,
         i.invoice_number,
         i.primary_resident_name_snapshot,
         c.period_start,
         c.period_end,
         i.due_date,
         i.total_vnd::text,
         i.paid_vnd::text,
         i.remaining_vnd::text,
         i.collection_status,
         i.status
       FROM renter_invoices i
       JOIN properties p ON p.id = i.property_id AND p.organization_id = i.organization_id
       LEFT JOIN renter_billing_cycles c ON c.id = i.billing_cycle_id AND c.organization_id = i.organization_id
       WHERE ${whereClause}
       ORDER BY i.due_date DESC, p.code, i.room_code_snapshot`,
      values
    );

    const bom = "\uFEFF";
    const header = "Cơ sở,Mã cơ sở,Phòng,Số hóa đơn,Khách thuê,Kỳ bắt đầu,Kỳ kết thúc,Hạn thanh toán,Tổng (VND),Đã thu (VND),Còn nợ (VND),Trạng thái thu";
    const statusMap: Record<string, string> = {
      UNPAID: "Chưa thu",
      PARTIALLY_PAID: "Thu một phần",
      PAID: "Đã thu đủ"
    };

    const rows = result.rows.map(
      (r) =>
        [
          escCsv(r.property_name),
          escCsv(r.property_code),
          escCsv(r.room_code_snapshot),
          escCsv(r.invoice_number),
          escCsv(r.primary_resident_name_snapshot),
          r.period_start ? dateOnly(r.period_start) : "",
          r.period_end ? dateOnly(r.period_end) : "",
          dateOnly(r.due_date),
          r.total_vnd,
          r.paid_vnd,
          r.remaining_vnd,
          escCsv(statusMap[r.collection_status] ?? r.collection_status)
        ].join(",")
    );

    const dateSuffix = new Date().toISOString().slice(0, 10);
    return {
      csv: bom + header + "\n" + rows.join("\n"),
      filename: `doanh-thu-cong-no_${dateSuffix}.csv`
    };
  }

  // ── 3. Cashflow report ───────────────────────────────────

  async exportCashflow(
    principal: TenantPrincipal,
    filters: PropertyFilter
  ): Promise<{ csv: string; filename: string }> {
    this.requireReportPermission(principal);

    if (filters.propertyId) {
      await this.validatePropertyScope(principal, filters.propertyId);
    }

    // Income rows (payment transactions)
    const incomeConditions: string[] = [
      "t.organization_id = $1::uuid",
      "t.status = 'POSTED'"
    ];
    const incomeValues: unknown[] = [principal.organizationId];
    let iIdx = 2;

    if (filters.fromDate) {
      incomeConditions.push(`t.occurred_at >= $${iIdx++}::timestamptz`);
      incomeValues.push(filters.fromDate);
    }
    if (filters.toDate) {
      incomeConditions.push(`t.occurred_at <= $${iIdx++}::timestamptz`);
      incomeValues.push(filters.toDate);
    }

    // For property filter on income, we need to join through allocations
    let incomeQuery: string;
    if (filters.propertyId) {
      incomeConditions.push(`i.property_id = $${iIdx++}::uuid`);
      incomeValues.push(filters.propertyId);

      incomeQuery = `
        SELECT DISTINCT ON (t.id)
          'INCOME' AS direction,
          NULL AS category,
          p.name AS property_name,
          p.code AS property_code,
          'Thanh toán tiền thuê' AS description,
          t.amount_vnd::text,
          t.occurred_at,
          t.payer_name AS payer_or_payee,
          t.source AS payment_method
        FROM renter_payment_transactions t
        JOIN renter_payment_allocations a ON a.payment_transaction_id = t.id AND a.organization_id = t.organization_id
        JOIN renter_invoices i ON i.id = a.invoice_id AND i.organization_id = a.organization_id
        JOIN properties p ON p.id = i.property_id AND p.organization_id = i.organization_id
        WHERE ${incomeConditions.join(" AND ")}
        ORDER BY t.id, t.occurred_at`;
    } else {
      incomeQuery = `
        SELECT
          'INCOME' AS direction,
          NULL AS category,
          NULL AS property_name,
          NULL AS property_code,
          'Thanh toán tiền thuê' AS description,
          t.amount_vnd::text,
          t.occurred_at,
          t.payer_name AS payer_or_payee,
          t.source AS payment_method
        FROM renter_payment_transactions t
        WHERE ${incomeConditions.join(" AND ")}
        ORDER BY t.occurred_at`;
    }

    // Expense rows
    const expenseConditions: string[] = ["e.organization_id = $1::uuid"];
    const expenseValues: unknown[] = [principal.organizationId];
    let eIdx = 2;

    if (filters.propertyId) {
      expenseConditions.push(`e.property_id = $${eIdx++}::uuid`);
      expenseValues.push(filters.propertyId);
    }
    if (filters.fromDate) {
      expenseConditions.push(`e.occurred_at >= $${eIdx++}::timestamptz`);
      expenseValues.push(filters.fromDate);
    }
    if (filters.toDate) {
      expenseConditions.push(`e.occurred_at <= $${eIdx++}::timestamptz`);
      expenseValues.push(filters.toDate);
    }

    const expenseQuery = `
      SELECT
        'EXPENSE' AS direction,
        e.category,
        p.name AS property_name,
        p.code AS property_code,
        COALESCE(e.note, e.category) AS description,
        e.amount_vnd::text,
        e.occurred_at,
        e.paid_to AS payer_or_payee,
        e.payment_method
      FROM operating_expenses e
      LEFT JOIN properties p ON p.id = e.property_id AND p.organization_id = e.organization_id
      WHERE ${expenseConditions.join(" AND ")}
      ORDER BY e.occurred_at`;

    const [incomeResult, expenseResult] = await Promise.all([
      this.db.query<CashflowExportRow>(incomeQuery, incomeValues),
      this.db.query<CashflowExportRow>(expenseQuery, expenseValues)
    ]);

    const categoryMap: Record<string, string> = {
      REPAIR_MAINTENANCE: "Sửa chữa/bảo trì",
      UTILITIES: "Tiện ích",
      MANAGEMENT_SERVICE: "Phí quản lý",
      CLEANING_WASTE: "Vệ sinh/rác",
      TAX_FEES: "Thuế/phí",
      OTHER: "Khác"
    };
    const paymentMethodMap: Record<string, string> = {
      CASH: "Tiền mặt",
      BANK_TRANSFER: "Chuyển khoản",
      MANUAL: "Thủ công",
      PROVIDER: "Nhà cung cấp",
      OTHER: "Khác"
    };

    // Merge and sort by date
    const allRows = [
      ...incomeResult.rows.map((r) => ({ ...r, sortDate: new Date(r.occurred_at).getTime() })),
      ...expenseResult.rows.map((r) => ({ ...r, sortDate: new Date(r.occurred_at).getTime() }))
    ].sort((a, b) => a.sortDate - b.sortDate);

    const bom = "\uFEFF";
    const header = "Ngày,Loại,Danh mục,Cơ sở,Mô tả,Số tiền (VND),Người chi/thu,Phương thức";
    const csvRows = allRows.map(
      (r) =>
        [
          dateOnly(r.occurred_at),
          r.direction === "INCOME" ? "Thu" : "Chi",
          escCsv(r.category ? (categoryMap[r.category] ?? r.category) : "Thu nhập cho thuê"),
          escCsv(r.property_name),
          escCsv(r.description),
          r.direction === "INCOME" ? r.amount_vnd : "-" + r.amount_vnd,
          escCsv(r.payer_or_payee),
          escCsv(r.payment_method ? (paymentMethodMap[r.payment_method] ?? r.payment_method) : "")
        ].join(",")
    );

    const dateSuffix = new Date().toISOString().slice(0, 10);
    return {
      csv: bom + header + "\n" + csvRows.join("\n"),
      filename: `dong-tien_${dateSuffix}.csv`
    };
  }

  // ── 4. Property occupancy & profitability summary ────────

  async getPropertySummary(
    principal: TenantPrincipal,
    filters: ReportDateRange
  ): Promise<{ properties: PropertySummaryRow[] }> {
    this.requireReportPermission(principal);

    const fromDate = filters.fromDate ?? null;
    const toDate = filters.toDate ?? null;

    const result = await this.db.query<PropertySummaryRow>(
      `WITH occupancy AS (
         SELECT
           rm.property_id,
           COUNT(DISTINCT rm.id) AS total_rooms,
           COUNT(DISTINCT CASE WHEN l.id IS NOT NULL THEN rm.id END) AS occupied_rooms
         FROM rooms rm
         LEFT JOIN leases l
           ON l.room_id = rm.id
          AND l.organization_id = rm.organization_id
          AND l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
         WHERE rm.organization_id = $1::uuid
           AND rm.status = 'ACTIVE'
         GROUP BY rm.property_id
       ),
       revenue AS (
         SELECT
           i.property_id,
           COALESCE(SUM(a.amount_vnd), 0)::text AS total_revenue_vnd
         FROM renter_payment_allocations a
         JOIN renter_payment_transactions t
           ON t.id = a.payment_transaction_id AND t.organization_id = a.organization_id
         JOIN renter_invoices i
           ON i.id = a.invoice_id AND i.organization_id = a.organization_id
         WHERE a.organization_id = $1::uuid
           AND t.status = 'POSTED'
           AND ($2::timestamptz IS NULL OR t.occurred_at >= $2::timestamptz)
           AND ($3::timestamptz IS NULL OR t.occurred_at <= $3::timestamptz)
         GROUP BY i.property_id
       ),
       expenses AS (
         SELECT
           property_id,
           COALESCE(SUM(amount_vnd), 0)::text AS total_expense_vnd
         FROM operating_expenses
         WHERE organization_id = $1::uuid
           AND ($2::timestamptz IS NULL OR occurred_at >= $2::timestamptz)
           AND ($3::timestamptz IS NULL OR occurred_at <= $3::timestamptz)
           AND property_id IS NOT NULL
         GROUP BY property_id
       ),
       debt AS (
         SELECT
           property_id,
           COALESCE(SUM(remaining_vnd), 0)::text AS outstanding_debt_vnd
         FROM renter_invoices
         WHERE organization_id = $1::uuid
           AND status = 'ISSUED'
           AND collection_status != 'PAID'
         GROUP BY property_id
       )
       SELECT
         p.name AS property_name,
         p.code AS property_code,
         COALESCE(o.total_rooms, 0)::int AS total_rooms,
         COALESCE(o.occupied_rooms, 0)::int AS occupied_rooms,
         CASE
           WHEN COALESCE(o.total_rooms, 0) = 0 THEN '0'
           ELSE ROUND(COALESCE(o.occupied_rooms, 0)::numeric / o.total_rooms * 100, 1)::text
         END AS occupancy_rate,
         COALESCE(r.total_revenue_vnd, '0') AS total_revenue_vnd,
         COALESCE(e.total_expense_vnd, '0') AS total_expense_vnd,
         (COALESCE(r.total_revenue_vnd::bigint, 0) - COALESCE(e.total_expense_vnd::bigint, 0))::text AS net_income_vnd,
         COALESCE(d.outstanding_debt_vnd, '0') AS outstanding_debt_vnd
       FROM properties p
       LEFT JOIN occupancy o ON o.property_id = p.id
       LEFT JOIN revenue r ON r.property_id = p.id
       LEFT JOIN expenses e ON e.property_id = p.id
       LEFT JOIN debt d ON d.property_id = p.id
       WHERE p.organization_id = $1::uuid
         AND p.status = 'ACTIVE'
       ORDER BY p.code`,
      [principal.organizationId, fromDate, toDate]
    );

    return { properties: result.rows };
  }

  async exportPropertySummary(
    principal: TenantPrincipal,
    filters: ReportDateRange
  ): Promise<{ csv: string; filename: string }> {
    const { properties } = await this.getPropertySummary(principal, filters);

    const bom = "\uFEFF";
    const header = "Cơ sở,Mã,Tổng phòng,Đang thuê,Tỷ lệ lấp đầy (%),Doanh thu (VND),Chi phí (VND),Lợi nhuận ròng (VND),Nợ phải thu (VND)";
    const rows = properties.map(
      (r) =>
        [
          escCsv(r.property_name),
          escCsv(r.property_code),
          r.total_rooms,
          r.occupied_rooms,
          r.occupancy_rate,
          r.total_revenue_vnd,
          r.total_expense_vnd,
          r.net_income_vnd,
          r.outstanding_debt_vnd
        ].join(",")
    );

    const dateSuffix = new Date().toISOString().slice(0, 10);
    return {
      csv: bom + header + "\n" + rows.join("\n"),
      filename: `tong-hop-co-so_${dateSuffix}.csv`
    };
  }

  // ── Helpers ──────────────────────────────────────────────

  private requireReportPermission(principal: TenantPrincipal): void {
    const hasReport = roleHasPermission(principal.role, "report.read");
    const hasBilling = roleHasPermission(principal.role, "billing.read");
    if (!hasReport && !hasBilling) {
      throw new ForbiddenException("Không có quyền xem báo cáo.");
    }
  }

  private async validatePropertyScope(
    principal: TenantPrincipal,
    propertyId: string
  ): Promise<void> {
    const result = await this.db.query<{
      id: string;
      operational_group_ids: string[];
    }>(
      `SELECT
         p.id::text,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids
       FROM properties p
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       WHERE p.organization_id = $1::uuid
         AND p.id = $2::uuid
       GROUP BY p.id
       LIMIT 1`,
      [principal.organizationId, propertyId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new BadRequestException("Cơ sở không tồn tại.");
    }
    if (
      !this.accessControl.can(principal.membership, "billing.read", {
        organizationId: principal.organizationId,
        propertyId,
        operationalGroupIds: row.operational_group_ids
      })
    ) {
      throw new ForbiddenException("Không có quyền truy cập cơ sở này.");
    }
  }
}
