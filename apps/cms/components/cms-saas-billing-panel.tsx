"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CopyOutlined,
  EyeOutlined,
  FilterOutlined,
  ReloadOutlined,
  SearchOutlined
} from "@ant-design/icons";
import {
  MetricCard,
  SectionHeader,
  StatusBadge
} from "@propops/ui";
import {
  cmsBillingDetailApi,
  type CmsInvoiceStatistics,
  type CmsInvoiceSummaryItem
} from "../lib/cms-billing-detail-api";

function money(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(amount) + "đ";
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString("vi-VN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return dateStr;
  }
}

export function CmsSaasBillingPanel() {
  const [invoices, setInvoices] = useState<CmsInvoiceSummaryItem[]>([]);
  const [statistics, setStatistics] = useState<CmsInvoiceStatistics | null>(null);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 1
  });

  const [filters, setFilters] = useState({
    status: "ALL",
    plan: "ALL",
    q: ""
  });
  const [searchInput, setSearchInput] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const fetchInvoices = useCallback(
    async (targetFilters = filters, page = 1) => {
      setLoading(true);
      setError(null);
      try {
        const response = await cmsBillingDetailApi.listInvoices({
          status: targetFilters.status,
          plan: targetFilters.plan,
          q: targetFilters.q,
          page,
          limit: 20
        });
        setInvoices(response.items);
        setStatistics(response.statistics);
        setPagination(response.pagination);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Không thể tải danh sách hóa đơn SaaS."
        );
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    void fetchInvoices(filters, 1);
  }, [fetchInvoices, filters]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters((prev) => ({ ...prev, q: searchInput }));
  };

  const handleStatusFilterChange = (newStatus: string) => {
    setFilters((prev) => ({ ...prev, status: newStatus }));
  };

  const handlePlanFilterChange = (newPlan: string) => {
    setFilters((prev) => ({ ...prev, plan: newPlan }));
  };

  const handleCopy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice(`Đã sao chép ${label}: ${text}`);
      setTimeout(() => setCopyNotice(null), 3000);
    } catch {
      setCopyNotice(`Không thể sao chép ${label}`);
    }
  };

  const statusTone = (
    status: string
  ): "success" | "warning" | "danger" | "info" | "neutral" => {
    switch (status) {
      case "PAID":
        return "success";
      case "OPEN":
        return "warning";
      case "PARTIALLY_PAID":
        return "info";
      case "VOID":
        return "neutral";
      default:
        return "neutral";
    }
  };

  const statusLabelVi = (status: string): string => {
    switch (status) {
      case "PAID":
        return "Đã thanh toán";
      case "OPEN":
        return "Chờ chuyển khoản";
      case "PARTIALLY_PAID":
        return "Thanh toán một phần";
      case "VOID":
        return "Đã hủy";
      default:
        return status;
    }
  };

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      {/* COPY NOTIFICATION */}
      {copyNotice && (
        <div
          style={{
            padding: "10px 16px",
            borderRadius: "8px",
            backgroundColor: "#ecfdf5",
            border: "1px solid #a7f3d0",
            color: "#065f46",
            fontSize: "13px",
            fontWeight: 600
          }}
        >
          {copyNotice}
        </div>
      )}

      {/* METRICS ROW */}
      <section
        className="cms-metrics"
        aria-label="Thống kê doanh thu & đơn mua gói SaaS"
      >
        <MetricCard
          label="Tổng doanh thu SaaS thực thu"
          value={money(statistics?.totalRevenueVnd ?? 0)}
          detail={`${statistics?.paidInvoicesCount ?? 0} đơn thanh toán thành công`}
          tone="success"
        />
        <MetricCard
          label="Đang chờ thanh toán (VietQR)"
          value={money(statistics?.pendingRevenueVnd ?? 0)}
          detail={`${statistics?.openInvoicesCount ?? 0} đơn đang chờ chuyển khoản`}
          tone={(statistics?.pendingRevenueVnd ?? 0) > 0 ? "warning" : "neutral"}
        />
        <MetricCard
          label="Doanh thu Tháng · Năm"
          value={`${money(statistics?.monthlyRevenueVnd ?? 0)} / Tháng`}
          detail={`${money(statistics?.yearlyRevenueVnd ?? 0)} / Năm`}
          tone="info"
        />
        <MetricCard
          label="Tổng đơn nâng cấp phát hành"
          value={String(statistics?.totalInvoicesCount ?? 0)}
          detail={`${statistics?.voidInvoicesCount ?? 0} đơn đã hủy / void`}
          tone="neutral"
        />
      </section>

      {/* REVENUE & SUBSCRIPTION BREAKDOWN CARDS */}
      <section className="cms-dashboard-grid">
        <article className="cms-panel">
          <SectionHeader
            title="Doanh thu theo Gói SaaS"
            action={<span className="cms-note">Tổng doanh thu lũy kế từ đơn PAID</span>}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "12px",
              marginTop: "14px"
            }}
          >
            {(statistics?.planBreakdown ?? []).map((pb) => (
              <div
                key={pb.planCode}
                style={{
                  padding: "14px",
                  borderRadius: "10px",
                  border: "1px solid var(--color-border, #e2e8f0)",
                  backgroundColor: "#f8fafc"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "6px"
                  }}
                >
                  <strong style={{ fontSize: "14px", color: "var(--brand-navy, #25355c)" }}>
                    {pb.planCode}
                  </strong>
                  <span
                    style={{
                      fontSize: "11px",
                      padding: "2px 6px",
                      borderRadius: "6px",
                      backgroundColor: "#e2e8f0",
                      fontWeight: 600
                    }}
                  >
                    {pb.paidCount} / {pb.invoiceCount} đơn
                  </span>
                </div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#0f766e" }}>
                  {money(pb.revenueVnd)}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="cms-panel">
          <SectionHeader
            title="Hiện trạng Gói cước của các Tenant"
            action={<span className="cms-note">Số tổ chức theo từng gói hiện tại</span>}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: "10px",
              marginTop: "14px"
            }}
          >
            {(() => {
              const planGroups = new Map<string, { active: number; trialing: number; pastDue: number }>();
              (statistics?.subscriptionDistribution ?? []).forEach((item) => {
                const current = planGroups.get(item.planCode) ?? { active: 0, trialing: 0, pastDue: 0 };
                if (item.status === "ACTIVE") current.active += item.count;
                else if (item.status === "TRIALING") current.trialing += item.count;
                else if (item.status === "PAST_DUE") current.pastDue += item.count;
                planGroups.set(item.planCode, current);
              });

              return Array.from(planGroups.entries()).map(([planCode, counts]) => (
                <div
                  key={planCode}
                  style={{
                    padding: "12px",
                    borderRadius: "10px",
                    border: "1px solid var(--color-border, #e2e8f0)",
                    backgroundColor: "#fdfefe"
                  }}
                >
                  <strong style={{ fontSize: "13px", color: "var(--brand-navy, #25355c)" }}>
                    {planCode}
                  </strong>
                  <div style={{ marginTop: "6px", fontSize: "11px", display: "grid", gap: "2px" }}>
                    <span style={{ color: "#16a34a", fontWeight: 600 }}>
                      • {counts.active} đang kích hoạt
                    </span>
                    {counts.trialing > 0 && (
                      <span style={{ color: "#d97706" }}>• {counts.trialing} dùng thử</span>
                    )}
                    {counts.pastDue > 0 && (
                      <span style={{ color: "#dc2626" }}>• {counts.pastDue} quá hạn</span>
                    )}
                  </div>
                </div>
              ));
            })()}
          </div>
        </article>
      </section>

      {/* FILTER & SEARCH TOOLBAR */}
      <article className="cms-panel">
        <SectionHeader
          title="Theo dõi Hóa đơn & Đơn Nâng cấp SaaS"
          action={
            <span className="cms-note">
              {pagination.total} hóa đơn · Tự động đối soát qua SePay Webhook
            </span>
          }
        />

        <form
          className="billing-search-form"
          onSubmit={handleSearchSubmit}
          style={{ marginTop: "16px" }}
        >
          <label className="billing-search-form__query">
            <span>Tìm kiếm</span>
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Tên tổ chức, slug, mã VietQR (SUB-...) hoặc UUID"
              maxLength={200}
            />
          </label>

          <label>
            <span>Trạng thái</span>
            <select
              value={filters.status}
              onChange={(e) => handleStatusFilterChange(e.target.value)}
            >
              <option value="ALL">Tất cả trạng thái</option>
              <option value="PAID">Đã thanh toán (PAID)</option>
              <option value="OPEN">Chờ chuyển khoản (OPEN)</option>
              <option value="PARTIALLY_PAID">Thanh toán 1 phần</option>
              <option value="VOID">Đã hủy (VOID)</option>
            </select>
          </label>

          <label>
            <span>Gói cước</span>
            <select
              value={filters.plan}
              onChange={(e) => handlePlanFilterChange(e.target.value)}
            >
              <option value="ALL">Tất cả gói</option>
              <option value="STARTER">STARTER</option>
              <option value="GROWTH">GROWTH</option>
              <option value="PRO">PRO</option>
              <option value="BUSINESS">BUSINESS</option>
            </select>
          </label>

          <div className="billing-search-form__actions">
            <button className="primary-button" type="submit">
              <SearchOutlined style={{ marginRight: "6px" }} />
              Tìm kiếm
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setSearchInput("");
                setFilters({ status: "ALL", plan: "ALL", q: "" });
              }}
            >
              <FilterOutlined style={{ marginRight: "6px" }} />
              Xóa bộ lọc
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void fetchInvoices(filters, pagination.page)}
            >
              <ReloadOutlined style={{ marginRight: "6px" }} />
              Làm mới
            </button>
          </div>
        </form>

        {/* ERROR STATE */}
        {error && (
          <div className="cms-state cms-state--error" style={{ marginBottom: "16px" }}>
            <strong>Lỗi tải dữ liệu:</strong>
            <span>{error}</span>
          </div>
        )}

        {/* LOADING & EMPTY STATES */}
        {loading ? (
          <div className="cms-state">Đang tải danh sách đơn nâng cấp SaaS…</div>
        ) : invoices.length === 0 ? (
          <div className="empty-state">
            Không tìm thấy hóa đơn SaaS nào phù hợp với bộ lọc hiện tại.
          </div>
        ) : (
          <>
            {/* DATA TABLE */}
            <div className="cms-table-wrap">
              <table className="cms-table">
                <thead>
                  <tr>
                    <th>Mã đơn / Tham chiếu VietQR</th>
                    <th>Tổ chức (Tenant)</th>
                    <th>Gói & Chu kỳ</th>
                    <th>Số tiền</th>
                    <th>Trạng thái</th>
                    <th>Ngày tạo / Hạn trả</th>
                    <th>Thanh toán lúc</th>
                    <th style={{ textAlign: "right" }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <strong
                          style={{
                            fontFamily: "monospace",
                            fontSize: "13px",
                            color: "var(--brand-navy, #25355c)"
                          }}
                        >
                          {inv.paymentReference}
                        </strong>
                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                          <small style={{ fontFamily: "monospace" }}>{inv.id.slice(0, 8)}…</small>
                          <button
                            type="button"
                            className="text-button"
                            style={{ padding: "0 4px", fontSize: "11px" }}
                            title="Sao chép mã tham chiếu VietQR"
                            onClick={() => void handleCopy("Mã VietQR", inv.paymentReference)}
                          >
                            <CopyOutlined />
                          </button>
                        </div>
                      </td>

                      <td>
                        <strong>
                          <Link
                            href={`/organizations/${inv.organizationId}`}
                            className="detail-link"
                            style={{ color: "var(--color-primary, #0ea5e9)", fontWeight: 700 }}
                          >
                            {inv.organizationName}
                          </Link>
                        </strong>
                        <small>{inv.organizationSlug}</small>
                      </td>

                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <strong
                            style={{
                              padding: "2px 8px",
                              borderRadius: "6px",
                              backgroundColor: "#f1f5f9",
                              fontSize: "12px",
                              color: "var(--brand-navy, #25355c)"
                            }}
                          >
                            {inv.planCode}
                          </strong>
                          <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                            {inv.billingInterval === "YEARLY" ? "12 tháng" : "1 tháng"}
                          </span>
                        </div>
                      </td>

                      <td>
                        <strong style={{ fontSize: "13px" }}>{money(inv.amountVnd)}</strong>
                        {inv.remainingAmountVnd > 0 && inv.status !== "PAID" && (
                          <small style={{ color: "#d97706" }}>
                            Còn thiếu: {money(inv.remainingAmountVnd)}
                          </small>
                        )}
                      </td>

                      <td>
                        <StatusBadge tone={statusTone(inv.status)}>
                          {statusLabelVi(inv.status)}
                        </StatusBadge>
                        {inv.isOverdue && (
                          <small style={{ color: "var(--color-danger, #ef4444)", fontWeight: 700 }}>
                            Quá hạn
                          </small>
                        )}
                      </td>

                      <td>
                        <small>{formatDate(inv.createdAt)}</small>
                        <small style={{ color: "var(--color-text-muted)" }}>
                          Hạn: {formatDate(inv.dueAt)}
                        </small>
                      </td>

                      <td>
                        <small>
                          {inv.paidAt ? (
                            <span style={{ color: "#16a34a", fontWeight: 600 }}>
                              {formatDate(inv.paidAt)}
                            </span>
                          ) : (
                            <span style={{ color: "var(--color-text-muted)" }}>Chưa thanh toán</span>
                          )}
                        </small>
                      </td>

                      <td style={{ textAlign: "right" }}>
                        <Link
                          href={`/billing/invoices/${inv.id}`}
                          className="secondary-button"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "4px 10px",
                            fontSize: "12px",
                            textDecoration: "none"
                          }}
                        >
                          <EyeOutlined />
                          Chi tiết
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* PAGINATION */}
            <div className="billing-search-footer">
              <span className="cms-note">
                Trang {pagination.page} / {pagination.totalPages} (Tổng cộng {pagination.total} hóa đơn)
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pagination.page <= 1}
                  onClick={() => void fetchInvoices(filters, pagination.page - 1)}
                >
                  Trang trước
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => void fetchInvoices(filters, pagination.page + 1)}
                >
                  Trang sau
                </button>
              </div>
            </div>
          </>
        )}
      </article>
    </div>
  );
}
