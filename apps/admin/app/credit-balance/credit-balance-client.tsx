"use client";

import { useCallback, useEffect, useState } from "react";
import { MoneyDisplay, PageHeader, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../components/admin-shell";
import {
  creditBalanceApi,
  type CreditBalance,
  type CreditMovement,
  type CreditMovementType,
  type Refund
} from "../../lib/credit-balance-api";

function formatVnd(amount: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function movementMeta(type: CreditMovementType) {
  switch (type) {
    case "OVERPAYMENT_CREDIT":
      return { label: "Tín dụng thừa", tone: "success" as const, icon: "↗" };
    case "CREDIT_APPLIED":
      return { label: "Áp dụng tín dụng", tone: "info" as const, icon: "↙" };
    case "MANUAL_CREDIT":
      return { label: "Cộng thủ công", tone: "success" as const, icon: "+" };
    case "MANUAL_DEBIT":
      return { label: "Trừ thủ công", tone: "warning" as const, icon: "−" };
    case "REFUND_ISSUED":
      return { label: "Hoàn trả", tone: "danger" as const, icon: "↩" };
    case "ALLOCATION_REVERSAL":
      return { label: "Đảo phân bổ", tone: "warning" as const, icon: "⟲" };
    default:
      return { label: type, tone: "neutral" as const, icon: "•" };
  }
}

function uuid() {
  return crypto.randomUUID();
}

type Tab = "movements" | "refunds";
type ModalType = "credit" | "debit" | "refund" | null;

export function CreditBalanceClient() {
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [movements, setMovements] = useState<CreditMovement[]>([]);
  const [movementsTotal, setMovementsTotal] = useState(0);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [refundsTotal, setRefundsTotal] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>("movements");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<ModalType>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Form state
  const [formAmount, setFormAmount] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formNote, setFormNote] = useState("");
  const [formRefundMethod, setFormRefundMethod] = useState<"CASH" | "BANK_TRANSFER" | "OTHER">("CASH");
  const [formRecipientName, setFormRecipientName] = useState("");
  const [formRecipientAccount, setFormRecipientAccount] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [balRes, movRes, refRes] = await Promise.all([
        creditBalanceApi.getBalance(),
        creditBalanceApi.listMovements({ limit: 50 }),
        creditBalanceApi.listRefunds({ limit: 50 })
      ]);
      setBalance(balRes);
      setMovements(movRes.movements);
      setMovementsTotal(movRes.total);
      setRefunds(refRes.refunds);
      setRefundsTotal(refRes.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải dữ liệu tín dụng.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function resetForm() {
    setFormAmount("");
    setFormDescription("");
    setFormNote("");
    setFormRefundMethod("CASH");
    setFormRecipientName("");
    setFormRecipientAccount("");
    setActionError(null);
  }

  async function handleManualCredit() {
    const amount = Math.floor(Number(formAmount));
    if (!amount || amount <= 0) {
      setActionError("Số tiền phải là số dương.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await creditBalanceApi.manualCredit({
        movementId: uuid(),
        amountVnd: amount,
        description: formDescription || null,
        note: formNote || null
      });
      setActionSuccess("Đã cộng tín dụng thành công!");
      setModal(null);
      resetForm();
      await loadData();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Lỗi khi cộng tín dụng.");
    } finally {
      setSaving(false);
    }
  }

  async function handleManualDebit() {
    const amount = Math.floor(Number(formAmount));
    if (!amount || amount <= 0) {
      setActionError("Số tiền phải là số dương.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await creditBalanceApi.manualDebit({
        movementId: uuid(),
        amountVnd: amount,
        description: formDescription || null,
        note: formNote || null
      });
      setActionSuccess("Đã trừ tín dụng thành công!");
      setModal(null);
      resetForm();
      await loadData();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Lỗi khi trừ tín dụng.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRefund() {
    const amount = Math.floor(Number(formAmount));
    if (!amount || amount <= 0) {
      setActionError("Số tiền hoàn trả phải là số dương.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await creditBalanceApi.issueRefund({
        refundId: uuid(),
        movementId: uuid(),
        amountVnd: amount,
        refundMethod: formRefundMethod,
        recipientName: formRecipientName || null,
        recipientAccount: formRecipientAccount || null,
        note: formNote || null
      });
      setActionSuccess("Đã hoàn trả tín dụng thành công!");
      setModal(null);
      resetForm();
      await loadData();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Lỗi khi hoàn trả.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell title="Quản lý Tín dụng" activeNav="/credit-balance">
      <div className="finance-page">
        <PageHeader title="Tín dụng Khách thuê" />

        {actionSuccess && (
          <div className="alert alert-success" style={{ marginBottom: 16 }}>
            ✅ {actionSuccess}
          </div>
        )}

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            ⚠ {error}
          </div>
        )}

        {loading ? (
          <div className="loading-state">Đang tải dữ liệu tín dụng…</div>
        ) : (
          <>
            {/* Balance Card */}
            <div className="credit-balance-card">
              <div className="credit-balance-card__header">
                <h2 className="credit-balance-card__title">Số dư tín dụng hiện tại</h2>
                <span className="credit-balance-card__amount">
                  {formatVnd(balance?.balanceVnd ?? 0)}
                </span>
              </div>
              <div className="credit-balance-card__actions">
                <button
                  className="btn btn-primary"
                  onClick={() => { resetForm(); setModal("credit"); }}
                >
                  + Cộng tín dụng
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => { resetForm(); setModal("debit"); }}
                  disabled={!balance?.balanceVnd}
                >
                  − Trừ tín dụng
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => { resetForm(); setModal("refund"); }}
                  disabled={!balance?.balanceVnd}
                >
                  ↩ Hoàn trả
                </button>
              </div>
            </div>

            {/* Tab navigation */}
            <div className="tab-nav" style={{ marginTop: 24 }}>
              <button
                className={`tab-nav__item${activeTab === "movements" ? " tab-nav__item--active" : ""}`}
                onClick={() => setActiveTab("movements")}
              >
                Lịch sử biến động ({movementsTotal})
              </button>
              <button
                className={`tab-nav__item${activeTab === "refunds" ? " tab-nav__item--active" : ""}`}
                onClick={() => setActiveTab("refunds")}
              >
                Hoàn trả ({refundsTotal})
              </button>
            </div>

            {/* Movements tab */}
            {activeTab === "movements" && (
              <div className="data-table-wrapper" style={{ marginTop: 16 }}>
                {movements.length === 0 ? (
                  <div className="empty-state">Chưa có biến động tín dụng nào.</div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Thời gian</th>
                        <th>Loại</th>
                        <th>Số tiền</th>
                        <th>Số dư sau</th>
                        <th>Mô tả</th>
                        <th>Người thực hiện</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.map((m) => {
                        const meta = movementMeta(m.movementType);
                        const isPositive = m.amountVnd > 0;
                        return (
                          <tr key={m.id}>
                            <td>{formatDate(m.createdAt)}</td>
                            <td>
                              <StatusBadge tone={meta.tone}>
                                {meta.icon} {meta.label}
                              </StatusBadge>
                            </td>
                            <td style={{ color: isPositive ? "var(--color-success)" : "var(--color-danger)", fontWeight: 600 }}>
                              {isPositive ? "+" : ""}{formatVnd(m.amountVnd)}
                            </td>
                            <td>{formatVnd(m.balanceAfterVnd)}</td>
                            <td>{m.description || m.note || "—"}</td>
                            <td>{m.createdByName || "Hệ thống"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Refunds tab */}
            {activeTab === "refunds" && (
              <div className="data-table-wrapper" style={{ marginTop: 16 }}>
                {refunds.length === 0 ? (
                  <div className="empty-state">Chưa có hoàn trả nào.</div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Thời gian</th>
                        <th>Số tiền</th>
                        <th>Phương thức</th>
                        <th>Người nhận</th>
                        <th>Trạng thái</th>
                        <th>Ghi chú</th>
                        <th>Người thực hiện</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refunds.map((r) => (
                        <tr key={r.id}>
                          <td>{formatDate(r.createdAt)}</td>
                          <td style={{ fontWeight: 600 }}>{formatVnd(r.amountVnd)}</td>
                          <td>
                            <StatusBadge tone="neutral">
                              {r.refundMethod === "CASH" ? "Tiền mặt" : r.refundMethod === "BANK_TRANSFER" ? "Chuyển khoản" : "Khác"}
                            </StatusBadge>
                          </td>
                          <td>{r.recipientName || "—"}</td>
                          <td>
                            <StatusBadge tone={r.status === "COMPLETED" ? "success" : r.status === "PENDING" ? "warning" : "neutral"}>
                              {r.status === "COMPLETED" ? "Hoàn tất" : r.status === "PENDING" ? "Đang xử lý" : "Đã hủy"}
                            </StatusBadge>
                          </td>
                          <td>{r.note || "—"}</td>
                          <td>{r.createdByName || "Hệ thống"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}

        {/* Modal */}
        {modal && (
          <div className="modal-overlay" onClick={() => { setModal(null); resetForm(); }}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3 className="modal-title">
                {modal === "credit" ? "Cộng tín dụng thủ công" :
                 modal === "debit" ? "Trừ tín dụng thủ công" :
                 "Hoàn trả tín dụng"}
              </h3>

              {actionError && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  ⚠ {actionError}
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Số tiền (VND) *</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="Ví dụ: 500000"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  min={1}
                  disabled={saving}
                />
              </div>

              {modal !== "refund" && (
                <div className="form-group">
                  <label className="form-label">Mô tả</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Lý do cộng/trừ tín dụng"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    disabled={saving}
                  />
                </div>
              )}

              {modal === "refund" && (
                <>
                  <div className="form-group">
                    <label className="form-label">Phương thức hoàn trả *</label>
                    <select
                      className="form-select"
                      value={formRefundMethod}
                      onChange={(e) => setFormRefundMethod(e.target.value as any)}
                      disabled={saving}
                    >
                      <option value="CASH">Tiền mặt</option>
                      <option value="BANK_TRANSFER">Chuyển khoản</option>
                      <option value="OTHER">Khác</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Người nhận</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Tên người nhận hoàn trả"
                      value={formRecipientName}
                      onChange={(e) => setFormRecipientName(e.target.value)}
                      disabled={saving}
                    />
                  </div>
                  {formRefundMethod === "BANK_TRANSFER" && (
                    <div className="form-group">
                      <label className="form-label">Tài khoản nhận</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Số tài khoản ngân hàng"
                        value={formRecipientAccount}
                        onChange={(e) => setFormRecipientAccount(e.target.value)}
                        disabled={saving}
                      />
                    </div>
                  )}
                </>
              )}

              <div className="form-group">
                <label className="form-label">Ghi chú</label>
                <textarea
                  className="form-input"
                  placeholder="Ghi chú thêm (nếu có)"
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  rows={2}
                  disabled={saving}
                />
              </div>

              <div className="modal-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => { setModal(null); resetForm(); }}
                  disabled={saving}
                >
                  Hủy
                </button>
                <button
                  className={`btn ${modal === "refund" ? "btn-danger" : "btn-primary"}`}
                  onClick={
                    modal === "credit" ? handleManualCredit :
                    modal === "debit" ? handleManualDebit :
                    handleRefund
                  }
                  disabled={saving}
                >
                  {saving ? "Đang xử lý…" :
                   modal === "credit" ? "Xác nhận cộng" :
                   modal === "debit" ? "Xác nhận trừ" :
                   "Xác nhận hoàn trả"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
