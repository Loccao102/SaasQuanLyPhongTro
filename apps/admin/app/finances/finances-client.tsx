"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  MetricCard,
  MoneyDisplay,
  PageHeader,
  ProgressBar,
  SectionHeader,
  StatusBadge
} from "@propops/ui";
import { AdminShell } from "../../components/admin-shell";
import {
  adminFinancesApi,
  type CashflowSummary,
  type ExpensePaymentMethod,
  type OperatingExpense,
  type OperatingExpenseCategory
} from "../../lib/admin-finances-api";
import {
  adminAssetsApi,
  type AdminAssetPropertySummary
} from "../../lib/admin-assets-api";

function formatVnd(amount: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}

function expenseCategoryMeta(cat: OperatingExpenseCategory) {
  switch (cat) {
    case "REPAIR_MAINTENANCE":
      return { label: "Sửa chữa, bảo trì", tone: "warning" as const };
    case "UTILITIES":
      return { label: "Điện, nước, internet", tone: "info" as const };
    case "MANAGEMENT_SERVICE":
      return { label: "Quản lý, dịch vụ", tone: "neutral" as const };
    case "CLEANING_WASTE":
      return { label: "Vệ sinh, gom rác", tone: "neutral" as const };
    case "TAX_FEES":
      return { label: "Thuế, phí môn bài", tone: "danger" as const };
    case "OTHER":
    default:
      return { label: "Chi phí khác", tone: "neutral" as const };
  }
}

function paymentMethodLabel(method: ExpensePaymentMethod) {
  switch (method) {
    case "BANK_TRANSFER":
      return "Chuyển khoản";
    case "CASH":
      return "Tiền mặt";
    default:
      return "Khác";
  }
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

export function FinancesClient() {
  const defaultPeriod = getDefaultPeriod();
  const [fromDate, setFromDate] = useState(defaultPeriod.from);
  const [toDate, setToDate] = useState(defaultPeriod.to);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");

  const [properties, setProperties] = useState<AdminAssetPropertySummary[]>([]);
  const [summary, setSummary] = useState<CashflowSummary | null>(null);
  const [expenses, setExpenses] = useState<OperatingExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fromIso = fromDate ? new Date(fromDate + "T00:00:00").toISOString() : undefined;
      const toIso = toDate ? new Date(toDate + "T23:59:59").toISOString() : undefined;

      const [overviewRes, summaryRes, expensesRes] = await Promise.all([
        adminAssetsApi.overview().catch(() => null),
        adminFinancesApi.cashflowSummary({
          propertyId: selectedPropertyId || undefined,
          fromDate: fromIso,
          toDate: toIso
        }),
        adminFinancesApi.expenses({
          propertyId: selectedPropertyId || undefined,
          category: selectedCategory || undefined,
          fromDate: fromIso,
          toDate: toIso,
          limit: 100
        })
      ]);

      if (overviewRes) {
        setProperties(overviewRes.properties);
      }
      setSummary(summaryRes);
      setExpenses(expensesRes.expenses);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải dữ liệu sổ quỹ.");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, selectedPropertyId, selectedCategory]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleCreateExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);

    const propertyId = String(form.get("propertyId") ?? "").trim() || null;
    const category = String(form.get("category") ?? "OTHER") as OperatingExpenseCategory;
    const amountVnd = Number(form.get("amountVnd") ?? 0);
    const occurredAt = String(form.get("occurredAt") ?? "").trim();
    const paidTo = String(form.get("paidTo") ?? "").trim() || null;
    const paymentMethod = String(form.get("paymentMethod") ?? "CASH") as ExpensePaymentMethod;
    const note = String(form.get("note") ?? "").trim() || null;
    const receiptUrl = String(form.get("receiptUrl") ?? "").trim() || null;

    try {
      await adminFinancesApi.createExpense({
        propertyId,
        category,
        amountVnd,
        occurredAt: new Date(occurredAt).toISOString(),
        paidTo,
        paymentMethod,
        note,
        receiptUrl
      });

      setModalOpen(false);
      setActionSuccess("Đã ghi nhận khoản chi vận hành thành công.");
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Không thể ghi nhận khoản chi.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteExpense(expenseId: string) {
    if (!confirm("Bạn có chắc chắn muốn xóa khoản chi này khỏi sổ quỹ?")) return;
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      await adminFinancesApi.deleteExpense(expenseId);
      setActionSuccess("Đã xóa khoản chi thành công.");
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Không thể xóa khoản chi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell title="Sổ quỹ Thu - Chi Vận Hành" activeNav="Sổ quỹ Thu - Chi">
      <PageHeader
        eyebrow="TÀI CHÍNH & VẬN HÀNH"
        title="Sổ quỹ Thu - Chi"
        description="Theo dõi dòng tiền thu phòng, quản lý các khoản chi vận hành (bảo trì, điện nước, vệ sinh) và lợi nhuận ròng theo từng cơ sở."
        action={
          <div className="button-row">
            <button
              className="primary-button"
              type="button"
              onClick={() => setModalOpen(!modalOpen)}
            >
              {modalOpen ? "Đóng form chi" : "+ Ghi nhận khoản chi mới"}
            </button>
          </div>
        }
      />

      {actionError ? (
        <div className="admin-state admin-state--error">
          <strong>Lỗi thực hiện:</strong>
          <span>{actionError}</span>
        </div>
      ) : null}

      {actionSuccess ? (
        <div className="admin-state admin-state--success">
          <strong>Thành công:</strong>
          <span>{actionSuccess}</span>
        </div>
      ) : null}

      {/* FILTER BAR */}
      <section className="panel" style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
            <span style={{ fontWeight: 600 }}>Cơ sở</span>
            <select
              value={selectedPropertyId}
              onChange={(e) => setSelectedPropertyId(e.target.value)}
              style={{ minWidth: "180px", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--color-border)" }}
            >
              <option value="">Tất cả cơ sở</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
            <span style={{ fontWeight: 600 }}>Danh mục chi</span>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              style={{ minWidth: "160px", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--color-border)" }}
            >
              <option value="">Tất cả danh mục</option>
              <option value="REPAIR_MAINTENANCE">Sửa chữa, bảo trì</option>
              <option value="UTILITIES">Điện, nước, internet</option>
              <option value="MANAGEMENT_SERVICE">Quản lý, dịch vụ</option>
              <option value="CLEANING_WASTE">Vệ sinh, rác</option>
              <option value="TAX_FEES">Thuế, phí</option>
              <option value="OTHER">Khác</option>
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
            <span style={{ fontWeight: 600 }}>Từ ngày</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--color-border)" }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
            <span style={{ fontWeight: 600 }}>Đến ngày</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--color-border)" }}
            />
          </label>

          <button
            className="secondary-button"
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            style={{ height: "38px" }}
          >
            {loading ? "Đang tải…" : "Lọc dữ liệu"}
          </button>
        </div>
      </section>

      {/* CREATE EXPENSE MODAL / PANEL */}
      {modalOpen ? (
        <section
          className="panel"
          style={{
            border: "2px solid var(--color-primary)",
            marginBottom: "24px",
            background: "var(--color-bg-secondary, #f8fafc)"
          }}
        >
          <SectionHeader
            title="Ghi nhận khoản chi vận hành mới"
            action={
              <button
                className="secondary-button"
                type="button"
                onClick={() => setModalOpen(false)}
              >
                Đóng
              </button>
            }
          />
          <p className="inline-note" style={{ marginBottom: "16px" }}>
            Ghi nhận chính xác các khoản tiền đã chi ra để tính toán chính xác dòng tiền và lợi nhuận ròng cơ sở.
          </p>
          <form className="asset-form" onSubmit={(e) => void handleCreateExpense(e)}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <label>
                <span>Thuộc cơ sở</span>
                <select name="propertyId" defaultValue={selectedPropertyId}>
                  <option value="">Chi phí chung (Toàn tổ chức)</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Danh mục chi phí *</span>
                <select name="category" required defaultValue="REPAIR_MAINTENANCE">
                  <option value="REPAIR_MAINTENANCE">Sửa chữa, bảo trì thiết bị/phòng</option>
                  <option value="UTILITIES">Điện, nước, internet tổng khu trọ</option>
                  <option value="MANAGEMENT_SERVICE">Phí dịch vụ, quản lý, bảo vệ</option>
                  <option value="CLEANING_WASTE">Vệ sinh, thu gom rác</option>
                  <option value="TAX_FEES">Thuế, phí môn bài, giấy tờ pháp lý</option>
                  <option value="OTHER">Chi phí khác</option>
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
              <label>
                <span>Số tiền chi (VND) *</span>
                <input
                  name="amountVnd"
                  type="number"
                  min="1000"
                  step="1000"
                  required
                  placeholder="VD: 500000"
                />
              </label>

              <label>
                <span>Ngày phát sinh chi *</span>
                <input
                  name="occurredAt"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </label>

              <label>
                <span>Hình thức thanh toán</span>
                <select name="paymentMethod" defaultValue="CASH">
                  <option value="CASH">Tiền mặt</option>
                  <option value="BANK_TRANSFER">Chuyển khoản</option>
                  <option value="OTHER">Khác</option>
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <label>
                <span>Người / Đơn vị nhận tiền</span>
                <input
                  name="paidTo"
                  placeholder="VD: Thợ sửa điện lạnh Tuấn, Cty Môi trường Đô thị..."
                />
              </label>

              <label>
                <span>Link / Đường dẫn ảnh hóa đơn chứng từ</span>
                <input
                  name="receiptUrl"
                  placeholder="https://..."
                />
              </label>
            </div>

            <label>
              <span>Nội dung diễn giải chi tiết</span>
              <textarea
                name="note"
                rows={2}
                placeholder="VD: Thay thế block máy lạnh phòng 204 và bơm gas..."
              />
            </label>

            <div className="button-row" style={{ marginTop: "16px" }}>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setModalOpen(false)}
              >
                Hủy
              </button>
              <button className="primary-button" type="submit" disabled={saving}>
                {saving ? "Đang lưu…" : "Ghi nhận khoản chi"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {/* KPI METRIC CARDS */}
      {summary ? (
        <section className="metrics-grid" aria-label="Chỉ số thu chi" style={{ marginBottom: "24px" }}>
          <MetricCard
            label="Tổng thu khách thuê (Inflow)"
            value={formatVnd(summary.totalIncomeVnd)}
            detail={`${summary.incomeCount} giao dịch thanh toán xác nhận`}
            tone="success"
          />
          <MetricCard
            label="Tổng chi vận hành (Outflow)"
            value={formatVnd(summary.totalExpenseVnd)}
            detail={`${summary.expenseCount} khoản chi phí đã phát sinh`}
            tone="warning"
          />
          <MetricCard
            label="Dòng tiền ròng / Lợi nhuận"
            value={formatVnd(summary.netCashflowVnd)}
            detail={
              summary.totalIncomeVnd > 0
                ? `Tỷ suất lợi nhuận: ${Math.round(
                    (summary.netCashflowVnd / summary.totalIncomeVnd) * 100
                  )}%`
                : "Thu vào - Chi ra"
            }
            tone={summary.netCashflowVnd >= 0 ? "success" : "danger"}
          />
        </section>
      ) : null}

      {/* CATEGORY BREAKDOWN */}
      {summary && summary.categoryBreakdown.length > 0 ? (
        <section className="panel" style={{ marginBottom: "24px" }}>
          <SectionHeader
            title="Cơ cấu chi phí theo danh mục"
            action={<span className="scope-label">Tổng: {formatVnd(summary.totalExpenseVnd)}</span>}
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px", marginTop: "12px" }}>
            {summary.categoryBreakdown.map((item) => {
              const meta = expenseCategoryMeta(item.category);
              const percent = summary.totalExpenseVnd > 0
                ? Math.round((item.totalVnd / summary.totalExpenseVnd) * 100)
                : 0;
              return (
                <div
                  key={item.category}
                  style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: "8px",
                    padding: "14px",
                    background: "var(--color-surface)"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                    <span style={{ fontSize: "12px", color: "var(--color-muted)", fontWeight: 600 }}>{percent}%</span>
                  </div>
                  <div style={{ fontSize: "18px", fontWeight: 700, margin: "6px 0" }}>
                    <MoneyDisplay amountVnd={item.totalVnd} />
                  </div>
                  <ProgressBar value={item.totalVnd} max={summary.totalExpenseVnd} label={`${item.count} khoản chi`} />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* EXPENSE RECORDS TABLE */}
      <section className="panel">
        <SectionHeader
          title="Nhật ký chi phí vận hành"
          action={<span className="scope-label">{expenses.length} khoản chi</span>}
        />

        {loading ? (
          <div className="admin-state">Đang tải danh sách khoản chi…</div>
        ) : expenses.length === 0 ? (
          <div className="admin-state">Chưa có khoản chi nào trong khoảng thời gian đã chọn.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--color-border)", textAlign: "left", color: "var(--color-muted)" }}>
                  <th style={{ padding: "10px" }}>Ngày chi</th>
                  <th style={{ padding: "10px" }}>Cơ sở</th>
                  <th style={{ padding: "10px" }}>Danh mục</th>
                  <th style={{ padding: "10px", textAlign: "right" }}>Số tiền</th>
                  <th style={{ padding: "10px" }}>Người nhận / Diễn giải</th>
                  <th style={{ padding: "10px" }}>Phương thức</th>
                  <th style={{ padding: "10px" }}>Chứng từ</th>
                  <th style={{ padding: "10px", textAlign: "right" }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((exp) => {
                  const catMeta = expenseCategoryMeta(exp.category);
                  return (
                    <tr
                      key={exp.id}
                      style={{ borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}
                    >
                      <td style={{ padding: "10px", whiteSpace: "nowrap" }}>
                        {new Date(exp.occurredAt).toLocaleDateString("vi-VN")}
                      </td>
                      <td style={{ padding: "10px", fontWeight: 500 }}>
                        {exp.propertyName ? `${exp.propertyName} (${exp.propertyCode})` : "Chi phí chung"}
                      </td>
                      <td style={{ padding: "10px" }}>
                        <StatusBadge tone={catMeta.tone}>{catMeta.label}</StatusBadge>
                      </td>
                      <td style={{ padding: "10px", textAlign: "right", fontWeight: 700, color: "var(--color-danger, #ef4444)" }}>
                        <MoneyDisplay amountVnd={exp.amountVnd} />
                      </td>
                      <td style={{ padding: "10px" }}>
                        {exp.paidTo ? <strong>{exp.paidTo} - </strong> : null}
                        <span>{exp.note ?? "—"}</span>
                      </td>
                      <td style={{ padding: "10px", whiteSpace: "nowrap" }}>
                        {paymentMethodLabel(exp.paymentMethod)}
                      </td>
                      <td style={{ padding: "10px" }}>
                        {exp.receiptUrl ? (
                          <a
                            href={exp.receiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--color-primary)", textDecoration: "underline" }}
                          >
                            Xem chứng từ
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ padding: "10px", textAlign: "right" }}>
                        <button
                          className="danger-button danger-button--compact"
                          type="button"
                          disabled={saving}
                          onClick={() => void handleDeleteExpense(exp.id)}
                        >
                          Xóa
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
