"use client";

import { MoneyDisplay, PageHeader, StatusBadge } from "@propops/ui";
import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "../../components/admin-shell";
import {
  renterPaymentsApi,
  type ProviderPaymentReviewItem
} from "../../lib/renter-payments-api";

function reasonLabel(code: string | null): string {
  switch (code) {
    case "RENTER_PAYMENT_OVERPAYMENT":
      return "Chuyển dư tiền";
    case "RENTER_PAYMENT_DESTINATION_ACCOUNT_MISMATCH":
      return "Sai tài khoản nhận";
    case "RENTER_PAYMENT_DESTINATION_PROFILE_MISSING":
      return "Thiếu cấu hình tài khoản";
    case "RENTER_INVOICE_ALREADY_PAID":
      return "Hóa đơn đã thanh toán";
    case "RENTER_INVOICE_NOT_ISSUED":
      return "Hóa đơn chưa phát hành";
    default:
      return code ?? "Cần kiểm tra";
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

export function PaymentReviewClient() {
  const [items, setItems] = useState<ProviderPaymentReviewItem[]>([]);
  const [selected, setSelected] = useState<ProviderPaymentReviewItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [allocationId, setAllocationId] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await renterPaymentsApi.reviewQueue();
      setItems(response.items);
      if (selected) {
        setSelected(
          response.items.find((item) => item.id === selected.id) ?? null
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Không thể tải hàng chờ đối soát."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selected) return;
    const suggested = Math.min(
      selected.unallocatedVnd,
      selected.invoice.remainingVnd
    );
    setAmount(String(suggested));
    setReason("");
    setSuccess(null);
    setAllocationId(crypto.randomUUID());
  }, [selected?.id]);

  const selectedAmount = Number(amount);
  const canSubmit = useMemo(
    () =>
      Boolean(selected?.canReconcile) &&
      Number.isSafeInteger(selectedAmount) &&
      selectedAmount > 0 &&
      selectedAmount <= (selected?.unallocatedVnd ?? 0) &&
      selectedAmount <= (selected?.invoice.remainingVnd ?? 0) &&
      reason.trim().length >= 3,
    [reason, selected, selectedAmount]
  );

  async function reconcile() {
    if (!selected || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await renterPaymentsApi.allocateReview(selected.id, {
        allocationId,
        amountVnd: selectedAmount,
        reason: reason.trim()
      });
      setSuccess(
        result.unallocatedVnd === 0
          ? "Đã phân bổ toàn bộ giao dịch và đóng review."
          : "Đã phân bổ phần hợp lệ. Phần tiền dư vẫn được giữ ở REVIEW_REQUIRED."
      );
      await load();
      const refreshed = await renterPaymentsApi.reviewDetail(selected.id).catch(
        () => null
      );
      setSelected(refreshed);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Không thể ghi nhận đối soát."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminShell title="Thu tiền" activeNav="Thu tiền">
      <PageHeader
        eyebrow="RENTER PAYMENT OPERATIONS"
        title="Giao dịch cần đối soát"
        description="Chỉ các giao dịch ngân hàng đã xác định được workspace và hóa đơn tham chiếu mới xuất hiện ở đây. Habi không tự đoán hóa đơn khi confidence thấp."
        action={
          <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
            Tải lại
          </button>
        }
      />

      {error ? (
        <div className="state-panel state-panel--error" role="alert">
          <strong>Không thể hoàn tất yêu cầu.</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {success ? (
        <div className="state-panel state-panel--success" role="status">
          <strong>Đã ghi nhận.</strong>
          <span>{success}</span>
        </div>
      ) : null}

      {loading ? (
        <section className="panel">Đang tải giao dịch cần kiểm tra…</section>
      ) : items.length === 0 ? (
        <section className="panel empty-state">
          <strong>Không có giao dịch cần đối soát.</strong>
          <span>Webhook an toàn đã được tự động phân bổ hoặc chưa có giao dịch mới.</span>
        </section>
      ) : (
        <section className="payment-review-layout">
          <div className="panel payment-review-list">
            <div className="payment-review-list__header">
              <strong>{items.length} giao dịch cần xử lý</strong>
              <span>Ưu tiên giao dịch mới nhất</span>
            </div>

            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={
                  selected?.id === item.id
                    ? "payment-review-row payment-review-row--active"
                    : "payment-review-row"
                }
                onClick={() => setSelected(item)}
              >
                <div>
                  <strong><MoneyDisplay amountVnd={item.amountVnd} /></strong>
                  <span>{item.provider} · {item.providerTransactionId}</span>
                </div>
                <div>
                  <StatusBadge tone="warning">{reasonLabel(item.reason.code)}</StatusBadge>
                  <span>{formatDate(item.occurredAt)}</span>
                </div>
                <div>
                  <strong>{item.invoice.number}</strong>
                  <span>{item.invoice.property.name} · {item.invoice.roomCode}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="panel payment-review-detail">
            {!selected ? (
              <div className="empty-state">
                <strong>Chọn một giao dịch.</strong>
                <span>Chi tiết và hành động đối soát sẽ hiển thị tại đây.</span>
              </div>
            ) : (
              <>
                <div className="review-detail-heading">
                  <div>
                    <span className="page-header__eyebrow">GIAO DỊCH PROVIDER</span>
                    <h2><MoneyDisplay amountVnd={selected.amountVnd} /></h2>
                    <p>{selected.provider} · {selected.providerTransactionId}</p>
                  </div>
                  <StatusBadge tone="warning">REVIEW REQUIRED</StatusBadge>
                </div>

                <dl className="review-detail-list">
                  <div><dt>Lý do</dt><dd>{reasonLabel(selected.reason.code)}</dd></div>
                  <div><dt>Payment reference</dt><dd>{selected.paymentReference}</dd></div>
                  <div><dt>Đã phân bổ</dt><dd><MoneyDisplay amountVnd={selected.allocatedVnd} /></dd></div>
                  <div><dt>Chưa phân bổ</dt><dd><MoneyDisplay amountVnd={selected.unallocatedVnd} /></dd></div>
                  <div><dt>Hóa đơn tham chiếu</dt><dd>{selected.invoice.number}</dd></div>
                  <div><dt>Còn phải thu HĐ</dt><dd><MoneyDisplay amountVnd={selected.invoice.remainingVnd} /></dd></div>
                </dl>

                {selected.reason.message ? (
                  <div className="review-reason-note">{selected.reason.message}</div>
                ) : null}

                {selected.canReconcile &&
                selected.invoice.status === "ISSUED" &&
                selected.invoice.remainingVnd > 0 &&
                selected.unallocatedVnd > 0 ? (
                  <div className="review-action">
                    <h3>Phân bổ thủ công vào hóa đơn tham chiếu</h3>
                    <p>
                      Hành động này ghi financial allocation và audit. Nếu giao dịch chuyển dư,
                      phần chưa phân bổ tiếp tục ở REVIEW_REQUIRED — không tự tạo credit.
                    </p>

                    <label>
                      <span>Số tiền phân bổ</span>
                      <input
                        inputMode="numeric"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))}
                      />
                    </label>

                    <label>
                      <span>Lý do xác nhận</span>
                      <textarea
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        rows={3}
                        placeholder="Ví dụ: Đã đối chiếu sao kê và xác nhận đúng khoản thu của phòng này."
                      />
                    </label>

                    <div className="financial-confirmation">
                      <strong>Ảnh hưởng sau khi xác nhận</strong>
                      <span>
                        Hóa đơn sẽ tăng paid amount đúng số tiền trên. Lịch sử provider transaction,
                        webhook và audit không bị xóa.
                      </span>
                    </div>

                    <button
                      className="danger-button"
                      type="button"
                      disabled={!canSubmit || submitting}
                      onClick={() => void reconcile()}
                    >
                      {submitting ? "Đang ghi nhận…" : "Xác nhận phân bổ giao dịch"}
                    </button>
                  </div>
                ) : (
                  <div className="review-blocked">
                    <strong>Chưa có hành động phân bổ an toàn.</strong>
                    <span>
                      Hóa đơn có thể đã thanh toán, chưa phát hành hoặc tài khoản hiện tại không có quyền payment.reconcile.
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </AdminShell>
  );
}
