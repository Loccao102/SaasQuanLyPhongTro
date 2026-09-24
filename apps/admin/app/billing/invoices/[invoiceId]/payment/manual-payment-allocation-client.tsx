"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent
} from "react";
import { MoneyDisplay, PageHeader, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../../../../components/admin-shell";
import {
  renterPaymentsApi,
  type RenterCollectionStatus,
  type RenterPaymentDetailResponse
} from "../../../../../lib/renter-payments-api";

type PendingPayment = {
  transactionId: string;
  allocationId: string;
  invoiceId: string;
  amountVnd: number;
  occurredAt: string;
  payerName: string | null;
  note: string | null;
};

function collectionTone(status: RenterCollectionStatus) {
  if (status === "PAID") return "success" as const;
  if (status === "PARTIALLY_PAID") return "warning" as const;
  return "neutral" as const;
}

function collectionLabel(status: RenterCollectionStatus) {
  if (status === "PAID") return "ĐÃ THANH TOÁN";
  if (status === "PARTIALLY_PAID") return "THANH TOÁN MỘT PHẦN";
  return "CHƯA THANH TOÁN";
}

function localDateTimeDefault() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function ManualPaymentAllocationClient({
  invoiceId
}: {
  invoiceId: string;
}) {
  const [data, setData] = useState<RenterPaymentDetailResponse | null>(null);
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await renterPaymentsApi.detail(invoiceId));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không thể tải trạng thái thanh toán."
      );
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    setError(null);
    setSuccess(null);

    const form = new FormData(event.currentTarget);
    const amountVnd = Number(form.get("amountVnd") ?? 0);
    if (!Number.isSafeInteger(amountVnd) || amountVnd <= 0) {
      setError("Số tiền thu phải là số nguyên VND lớn hơn 0.");
      return;
    }
    if (amountVnd > data.invoice.remainingVnd) {
      setError(
        "Khoản thu vượt số tiền còn lại. Overpayment cần quy trình review riêng."
      );
      return;
    }

    const localOccurredAt = String(form.get("occurredAt") ?? "");
    const occurredAt = new Date(localOccurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      setError("Thời điểm nhận tiền không hợp lệ.");
      return;
    }

    setPending({
      transactionId: crypto.randomUUID(),
      allocationId: crypto.randomUUID(),
      invoiceId,
      amountVnd,
      occurredAt: occurredAt.toISOString(),
      payerName: String(form.get("payerName") ?? "").trim() || null,
      note: String(form.get("note") ?? "").trim() || null
    });
  }

  async function confirm() {
    if (!pending) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await renterPaymentsApi.createManualAllocation(pending);
      setSuccess(
        "Đã ghi nhận " +
          new Intl.NumberFormat("vi-VN").format(pending.amountVnd) +
          "đ. Còn lại " +
          new Intl.NumberFormat("vi-VN").format(result.invoice.remainingVnd) +
          "đ."
      );
      setPending(null);
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Không thể ghi nhận khoản thu."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell
      title="Ghi nhận thanh toán"
      eyebrow="RENTER PAYMENT · MANUAL RECONCILIATION"
      activeNav="Hóa đơn"
    >
      <PageHeader
        eyebrow="PAYMENT.RECONCILE"
        title={data?.invoice.number ?? "Thanh toán hóa đơn"}
        description="Ghi nhận khoản tiền thực tế đã nhận và phân bổ vào một hóa đơn đã phát hành. Thao tác tạo dấu vết giao dịch và allocation, không sửa snapshot dòng tiền của hóa đơn."
        action={
          <a className="secondary-link-button" href="/billing">
            ← Hóa đơn
          </a>
        }
      />

      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Chưa ghi nhận thanh toán.</strong>
          <span>{error}</span>
        </div>
      ) : null}
      {success ? (
        <div className="admin-state admin-state--success">
          <strong>Đã ghi nhận khoản thu.</strong>
          <span>{success}</span>
        </div>
      ) : null}

      {loading || !data ? (
        <div className="admin-state">Đang tải trạng thái công nợ…</div>
      ) : (
        <>
          <section className="asset-context">
            <div>
              <span className="eyebrow">
                {data.invoice.property.code} · PHÒNG {data.invoice.roomCode}
              </span>
              <h2>{data.invoice.primaryResidentName}</h2>
              <p>
                Hạn {data.invoice.dueDate} · Invoice {data.invoice.status}
              </p>
              <code>{data.invoice.paymentReference}</code>
            </div>
            <StatusBadge tone={collectionTone(data.invoice.collectionStatus)}>
              {collectionLabel(data.invoice.collectionStatus)}
            </StatusBadge>
          </section>

          <section className="billing-cycle-card__stats">
            <div>
              <span>Tổng hóa đơn</span>
              <strong><MoneyDisplay amountVnd={data.invoice.totalVnd} /></strong>
            </div>
            <div>
              <span>Đã thu</span>
              <strong><MoneyDisplay amountVnd={data.invoice.paidVnd} /></strong>
            </div>
            <div>
              <span>Còn lại</span>
              <strong><MoneyDisplay amountVnd={data.invoice.remainingVnd} /></strong>
            </div>
            <div>
              <span>Lần thu</span>
              <strong>{data.allocations.length}</strong>
            </div>
          </section>

          {data.permissions.reconcile &&
          data.invoice.status === "ISSUED" &&
          data.invoice.remainingVnd > 0 ? (
            <section className="panel">
              <div className="asset-section-heading">
                <div>
                  <span className="eyebrow">MANUAL PAYMENT</span>
                  <h2>Khoản tiền đã nhận</h2>
                </div>
              </div>
              <form className="asset-form" onSubmit={prepare}>
                <label>
                  <span>Số tiền · VND</span>
                  <input
                    name="amountVnd"
                    type="number"
                    min="1"
                    max={data.invoice.remainingVnd}
                    step="1"
                    required
                    defaultValue={data.invoice.remainingVnd}
                  />
                </label>
                <label>
                  <span>Thời điểm nhận tiền</span>
                  <input
                    name="occurredAt"
                    type="datetime-local"
                    required
                    defaultValue={localDateTimeDefault()}
                  />
                </label>
                <label>
                  <span>Người chuyển / người nộp</span>
                  <input
                    name="payerName"
                    placeholder={data.invoice.primaryResidentName}
                  />
                </label>
                <label>
                  <span>Ghi chú</span>
                  <input
                    name="note"
                    placeholder="Ví dụ: chuyển khoản MB Bank"
                  />
                </label>
                <div className="button-row">
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={saving}
                  >
                    Xem lại khoản thu
                  </button>
                </div>
              </form>
            </section>
          ) : data.invoice.remainingVnd === 0 ? (
            <div className="admin-state admin-state--success">
              <strong>Hóa đơn đã thanh toán đủ.</strong>
              <span>Không cần ghi nhận thêm allocation.</span>
            </div>
          ) : !data.permissions.reconcile ? (
            <div className="admin-state">
              <strong>Chỉ xem lịch sử thanh toán.</strong>
              <span>
                Membership hiện tại không có payment.reconcile trên cơ sở này.
              </span>
            </div>
          ) : null}

          {pending ? (
            <section className="panel">
              <div className="asset-section-heading">
                <div>
                  <span className="eyebrow">REVIEW FINANCIAL EFFECT</span>
                  <h2>Xác nhận phân bổ khoản thu</h2>
                </div>
                <StatusBadge tone="warning">FINANCIAL CHANGE</StatusBadge>
              </div>
              <dl className="detail-list">
                <div>
                  <dt>Invoice</dt>
                  <dd>{data.invoice.number}</dd>
                </div>
                <div>
                  <dt>Khoản thu</dt>
                  <dd><MoneyDisplay amountVnd={pending.amountVnd} /></dd>
                </div>
                <div>
                  <dt>Đã thu sau thao tác</dt>
                  <dd>
                    <MoneyDisplay
                      amountVnd={data.invoice.paidVnd + pending.amountVnd}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Còn lại sau thao tác</dt>
                  <dd>
                    <MoneyDisplay
                      amountVnd={data.invoice.remainingVnd - pending.amountVnd}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Trạng thái sau thao tác</dt>
                  <dd>
                    {data.invoice.remainingVnd - pending.amountVnd === 0
                      ? "PAID"
                      : "PARTIALLY_PAID"}
                  </dd>
                </div>
              </dl>
              <p className="inline-note">
                Xác nhận sẽ tạo PaymentTransaction + PaymentAllocation có audit.
                Khoản thu không thể vượt remaining amount; hoàn/đảo giao dịch sẽ
                dùng flow riêng.
              </p>
              <div className="button-row">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => setPending(null)}
                >
                  Quay lại chỉnh
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => void confirm()}
                >
                  {saving
                    ? "Đang ghi nhận…"
                    : "Ghi nhận " +
                      new Intl.NumberFormat("vi-VN").format(pending.amountVnd) +
                      "đ"}
                </button>
              </div>
            </section>
          ) : null}

          <section className="panel">
            <div className="asset-section-heading">
              <div>
                <span className="eyebrow">ALLOCATION HISTORY</span>
                <h2>Lịch sử thu tiền</h2>
              </div>
              <StatusBadge tone="neutral">
                {data.allocations.length} KHOẢN
              </StatusBadge>
            </div>
            {data.allocations.length === 0 ? (
              <div className="admin-state">
                <strong>Chưa ghi nhận khoản thu nào.</strong>
                <span>Hóa đơn hiện còn nguyên số tiền phải thu.</span>
              </div>
            ) : (
              <div className="renter-invoice-lines">
                {[...data.allocations].reverse().map((allocation) => (
                  <div className="renter-invoice-line" key={allocation.id}>
                    <div>
                      <strong>
                        {allocation.type} · {allocation.transaction.source}
                      </strong>
                      <span>
                        {new Date(
                          allocation.transaction.occurredAt
                        ).toLocaleString("vi-VN")}
                        {allocation.transaction.payerName
                          ? " · " + allocation.transaction.payerName
                          : ""}
                      </span>
                      {allocation.transaction.note ? (
                        <span>{allocation.transaction.note}</span>
                      ) : null}
                    </div>
                    <MoneyDisplay amountVnd={allocation.amountVnd} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </AdminShell>
  );
}
