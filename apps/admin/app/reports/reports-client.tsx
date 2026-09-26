"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MetricCard,
  MoneyDisplay,
  PageHeader,
  StatusBadge
} from "@propops/ui";
import { AdminShell } from "../../components/admin-shell";
import {
  reportingApi,
  type PropertySummary
} from "../../lib/reporting-api";
import {
  adminAssetsApi,
  type AdminAssetPropertySummary
} from "../../lib/admin-assets-api";

function formatVnd(amount: number | string) {
  const num = typeof amount === "string" ? Number(amount) : amount;
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(num);
}

function getDefaultPeriod() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0, 23, 59, 59);

  return {
    from: firstDay.toISOString().slice(0, 10),
    to: lastDay.toISOString().slice(0, 10)
  };
}

export function ReportsClient() {
  const defaultPeriod = getDefaultPeriod();
  const [fromDate, setFromDate] = useState(defaultPeriod.from);
  const [toDate, setToDate] = useState(defaultPeriod.to);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");

  const [properties, setProperties] = useState<AdminAssetPropertySummary[]>([]);
  const [summaryData, setSummaryData] = useState<PropertySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fromIso = fromDate ? new Date(fromDate + "T00:00:00").toISOString() : undefined;
      const toIso = toDate ? new Date(toDate + "T23:59:59").toISOString() : undefined;

      const [propRes, summaryRes] = await Promise.all([
        adminAssetsApi.overview().catch(() => null),
        reportingApi.propertySummary({ fromDate: fromIso, toDate: toIso })
      ]);

      if (propRes?.properties) {
        setProperties(propRes.properties);
      }
      setSummaryData(summaryRes.properties);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải dữ liệu báo cáo.");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleExport(reportType: string) {
    setExporting(reportType);
    setExportSuccess(null);
    try {
      const fromIso = fromDate ? new Date(fromDate + "T00:00:00").toISOString() : undefined;
      const toIso = toDate ? new Date(toDate + "T23:59:59").toISOString() : undefined;
      const params = {
        propertyId: selectedPropertyId || undefined,
        fromDate: fromIso,
        toDate: toIso
      };

      switch (reportType) {
        case "meter-readings":
          await reportingApi.downloadMeterReadings(params);
          break;
        case "revenue-debt":
          await reportingApi.downloadRevenueDebt(params);
          break;
        case "cashflow":
          await reportingApi.downloadCashflow(params);
          break;
        case "property-summary":
          await reportingApi.downloadPropertySummary({ fromDate: fromIso, toDate: toIso });
          break;
      }
      setExportSuccess("Đã tải xuống thành công!");
      setTimeout(() => setExportSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi tải xuống báo cáo.");
    } finally {
      setExporting(null);
    }
  }

  // Aggregate summary
  const totalRooms = summaryData.reduce((s, p) => s + p.total_rooms, 0);
  const occupiedRooms = summaryData.reduce((s, p) => s + p.occupied_rooms, 0);
  const totalRevenue = summaryData.reduce((s, p) => s + Number(p.total_revenue_vnd), 0);
  const totalExpense = summaryData.reduce((s, p) => s + Number(p.total_expense_vnd), 0);
  const netIncome = totalRevenue - totalExpense;
  const totalDebt = summaryData.reduce((s, p) => s + Number(p.outstanding_debt_vnd), 0);
  const avgOccupancy = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;

  return (
    <AdminShell title="Báo cáo" activeNav="/reports">
      <div className="finance-page">
        <PageHeader title="Báo cáo & Xuất dữ liệu" />

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            ⚠ {error}
          </div>
        )}
        {exportSuccess && (
          <div className="alert alert-success" style={{ marginBottom: 16 }}>
            ✅ {exportSuccess}
          </div>
        )}

        {/* Filters */}
        <div className="report-filters">
          <div className="report-filters__row">
            <div className="form-group" style={{ minWidth: 160 }}>
              <label className="form-label">Từ ngày</label>
              <input
                type="date"
                className="form-input"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ minWidth: 160 }}>
              <label className="form-label">Đến ngày</label>
              <input
                type="date"
                className="form-input"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ minWidth: 200 }}>
              <label className="form-label">Cơ sở</label>
              <select
                className="form-select"
                value={selectedPropertyId}
                onChange={(e) => setSelectedPropertyId(e.target.value)}
              >
                <option value="">Tất cả cơ sở</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="loading-state">Đang tải dữ liệu báo cáo…</div>
        ) : (
          <>
            {/* Summary KPIs */}
            <div className="metric-grid" style={{ marginTop: 20 }}>
              <div className="metric-card metric-card--primary">
                <div className="metric-card__label">Tổng doanh thu</div>
                <div className="metric-card__value">{formatVnd(totalRevenue)}</div>
              </div>
              <div className="metric-card metric-card--danger">
                <div className="metric-card__label">Tổng chi phí</div>
                <div className="metric-card__value">{formatVnd(totalExpense)}</div>
              </div>
              <div className={`metric-card ${netIncome >= 0 ? "metric-card--success" : "metric-card--danger"}`}>
                <div className="metric-card__label">Lợi nhuận ròng</div>
                <div className="metric-card__value">{formatVnd(netIncome)}</div>
              </div>
              <div className="metric-card metric-card--warning">
                <div className="metric-card__label">Nợ phải thu</div>
                <div className="metric-card__value">{formatVnd(totalDebt)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-card__label">Tỷ lệ lấp đầy</div>
                <div className="metric-card__value">
                  {avgOccupancy}% <span style={{ fontSize: "0.75em", opacity: 0.7 }}>({occupiedRooms}/{totalRooms})</span>
                </div>
              </div>
            </div>

            {/* Export actions */}
            <div className="report-export-section" style={{ marginTop: 28 }}>
              <h3 className="section-title">Xuất báo cáo CSV</h3>
              <div className="export-card-grid">
                <div className="export-card">
                  <div className="export-card__icon">📊</div>
                  <div className="export-card__body">
                    <h4>Chỉ số đồng hồ</h4>
                    <p>Xuất tất cả chỉ số điện, nước theo kỳ và cơ sở</p>
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={() => handleExport("meter-readings")}
                    disabled={!!exporting}
                  >
                    {exporting === "meter-readings" ? "Đang tải…" : "Tải CSV"}
                  </button>
                </div>

                <div className="export-card">
                  <div className="export-card__icon">💰</div>
                  <div className="export-card__body">
                    <h4>Doanh thu & Công nợ</h4>
                    <p>Hóa đơn đã phát hành, đã thu, còn nợ theo kỳ</p>
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={() => handleExport("revenue-debt")}
                    disabled={!!exporting}
                  >
                    {exporting === "revenue-debt" ? "Đang tải…" : "Tải CSV"}
                  </button>
                </div>

                <div className="export-card">
                  <div className="export-card__icon">📈</div>
                  <div className="export-card__body">
                    <h4>Dòng tiền Thu - Chi</h4>
                    <p>Chi tiết thu nhập và chi phí hoạt động theo thời gian</p>
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={() => handleExport("cashflow")}
                    disabled={!!exporting}
                  >
                    {exporting === "cashflow" ? "Đang tải…" : "Tải CSV"}
                  </button>
                </div>

                <div className="export-card">
                  <div className="export-card__icon">🏢</div>
                  <div className="export-card__body">
                    <h4>Tổng hợp cơ sở</h4>
                    <p>Lấp đầy, doanh thu, chi phí, lợi nhuận từng cơ sở</p>
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={() => handleExport("property-summary")}
                    disabled={!!exporting}
                  >
                    {exporting === "property-summary" ? "Đang tải…" : "Tải CSV"}
                  </button>
                </div>
              </div>
            </div>

            {/* Property breakdown table */}
            {summaryData.length > 0 && (
              <div className="data-table-wrapper" style={{ marginTop: 28 }}>
                <h3 className="section-title">Chi tiết theo cơ sở</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Cơ sở</th>
                      <th>Mã</th>
                      <th style={{ textAlign: "right" }}>Tổng phòng</th>
                      <th style={{ textAlign: "right" }}>Đang thuê</th>
                      <th style={{ textAlign: "right" }}>Lấp đầy</th>
                      <th style={{ textAlign: "right" }}>Doanh thu</th>
                      <th style={{ textAlign: "right" }}>Chi phí</th>
                      <th style={{ textAlign: "right" }}>Lợi nhuận</th>
                      <th style={{ textAlign: "right" }}>Nợ phải thu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryData.map((p) => {
                      const net = Number(p.total_revenue_vnd) - Number(p.total_expense_vnd);
                      return (
                        <tr key={p.property_code}>
                          <td>{p.property_name}</td>
                          <td><code>{p.property_code}</code></td>
                          <td style={{ textAlign: "right" }}>{p.total_rooms}</td>
                          <td style={{ textAlign: "right" }}>{p.occupied_rooms}</td>
                          <td style={{ textAlign: "right" }}>
                            <StatusBadge
                              tone={Number(p.occupancy_rate) >= 80 ? "success" : Number(p.occupancy_rate) >= 50 ? "warning" : "danger"}
                            >
                              {p.occupancy_rate}%
                            </StatusBadge>
                          </td>
                          <td style={{ textAlign: "right", color: "var(--color-success)" }}>
                            {formatVnd(p.total_revenue_vnd)}
                          </td>
                          <td style={{ textAlign: "right", color: "var(--color-danger)" }}>
                            {formatVnd(p.total_expense_vnd)}
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 600, color: net >= 0 ? "var(--color-success)" : "var(--color-danger)" }}>
                            {formatVnd(net)}
                          </td>
                          <td style={{ textAlign: "right", color: Number(p.outstanding_debt_vnd) > 0 ? "var(--color-warning)" : undefined }}>
                            {formatVnd(p.outstanding_debt_vnd)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 700 }}>
                      <td colSpan={2}>TỔNG CỘNG</td>
                      <td style={{ textAlign: "right" }}>{totalRooms}</td>
                      <td style={{ textAlign: "right" }}>{occupiedRooms}</td>
                      <td style={{ textAlign: "right" }}>{avgOccupancy}%</td>
                      <td style={{ textAlign: "right", color: "var(--color-success)" }}>{formatVnd(totalRevenue)}</td>
                      <td style={{ textAlign: "right", color: "var(--color-danger)" }}>{formatVnd(totalExpense)}</td>
                      <td style={{ textAlign: "right", color: netIncome >= 0 ? "var(--color-success)" : "var(--color-danger)" }}>{formatVnd(netIncome)}</td>
                      <td style={{ textAlign: "right", color: totalDebt > 0 ? "var(--color-warning)" : undefined }}>{formatVnd(totalDebt)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </AdminShell>
  );
}
