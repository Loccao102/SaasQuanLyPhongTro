"use client";

import { useCallback, useEffect, useState } from "react";
import { MoneyDisplay, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../../../components/admin-shell";
import {
  renterBillingApi,
  type RenterBillingDetailResponse
} from "../../../../lib/renter-billing-api";

function collectionTone(
  status: "UNPAID" | "PARTIALLY_PAID" | "PAID"
) {
  if (status === "PAID") return "success" as const;
  if (status === "PARTIALLY_PAID") return "warning" as const;
  return "neutral" as const;
}

function collectionLabel(
  status: "UNPAID" | "PARTIALLY_PAID" | "PAID"
) {
  if (status === "PAID") return "ĐÃ THANH TOÁN";
  if (status === "PARTIALLY_PAID") return "THANH TOÁN MỘT PHẦN";
  return "CHƯA THANH TOÁN";
}

function reviewReasonLabel(reason: Record<string, unknown>) {
  const code = typeof reason.code === "string" ? reason.code : "UNKNOWN";
  const meterType =
    reason.meterType === "ELECTRICITY"
      ? "điện"
      : reason.meterType === "WATER"
        ? "nước"
        : "đồng hồ";

  switch (code) {
    case "MISSING_PRICING_POLICY":
      return "Chưa có biểu giá bao phủ toàn bộ kỳ hóa đơn.";
    case "MISSING_METER":
      return "Phòng chưa có đồng hồ " + meterType + " đang hoạt động.";
    case "MISSING_PREVIOUS_READING":
      return "Thiếu chỉ số đầu kỳ của " + meterType + ".";
    case "MISSING_CURRENT_READING":
      return "Thiếu chỉ số cuối kỳ của " + meterType + ".";
    default:
      return "Dữ liệu tính tiền cần được kiểm tra lại (" + code + ").";
  }
}

export function RenterBillingCycleClient({ cycleId }: { cycleId: string }) {
  const [data, setData] = useState<RenterBillingDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [issuedUrls, setIssuedUrls] = useState<Record<string, string>>({});
  const [linkSaving, setLinkSaving] = useState<string | null>(null);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [notificationRequestKey, setNotificationRequestKey] =
    useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await renterBillingApi.detail(cycleId));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không thể tải chi tiết kỳ hóa đơn."
      );
    } finally {
      setLoading(false);
    }
  }, [cycleId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function issuePublicLink(invoiceId: string, alreadyActive: boolean) {
    if (
      alreadyActive &&
      !window.confirm(
        "Tạo link mới sẽ vô hiệu link công khai cũ của hóa đơn này. Tiếp tục?"
      )
    ) {
      return;
    }
    setLinkSaving(invoiceId);
    setError(null);
    setLinkMessage(null);
    setIssuedUrl(null);
    try {
      const result = await renterBillingApi.issuePublicLink(invoiceId);
      const base =
        process.env.NEXT_PUBLIC_PUBLIC_INVOICE_BASE_URL?.replace(/\/$/, "") ??
        "http://localhost:3002";
      const url = base + "/i/" + result.token;
      setIssuedUrl(url);
      setIssuedUrls((prev) => ({ ...prev, [invoiceId]: url }));
      try {
        await navigator.clipboard.writeText(url);
        setLinkMessage(
          "Đã tạo link công khai và sao chép vào clipboard. Link cũ (nếu có) đã bị vô hiệu."
        );
      } catch {
        setLinkMessage(
          "Đã tạo link công khai. Clipboard không khả dụng; hãy sao chép URL hiển thị bên dưới."
        );
      }
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Không thể tạo link hóa đơn công khai."
      );
    } finally {
      setLinkSaving(null);
    }
  }

  async function sendInvoiceNotifications() {
    if (
      !window.confirm(
        "Gửi hóa đơn sẽ tạo link công khai mới cho tất cả hóa đơn ISSUED còn nợ có số điện thoại người thuê. Link cũ của các hóa đơn đó sẽ bị vô hiệu. Hóa đơn đã thanh toán không gửi; hóa đơn thiếu số điện thoại sẽ được báo skipped. Tiếp tục?"
      )
    ) {
      return;
    }

    const requestKey =
      notificationRequestKey ??
      "invoice-notify:" + cycleId + ":" + crypto.randomUUID();
    setNotificationRequestKey(requestKey);
    setNotificationSaving(true);
    setNotificationMessage(null);
    setError(null);

    try {
      const result = await renterBillingApi.createNotificationCampaign(
        cycleId,
        requestKey
      );
      setNotificationMessage(
        "Đã xếp hàng " +
          String(result.invoiceCount) +
          " hóa đơn cho " +
          String(result.recipientCount) +
          " người nhận. " +
          String(result.skippedInvoiceCount) +
          " hóa đơn bị bỏ qua vì thiếu số điện thoại." +
          (result.replayed ? " Đây là kết quả retry của cùng yêu cầu." : "")
      );
      setNotificationRequestKey(null);
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Không thể tạo chiến dịch gửi hóa đơn."
      );
    } finally {
      setNotificationSaving(false);
    }
  }

  async function revokePublicLink(invoiceId: string) {
    if (
      !window.confirm(
        "Thu hồi link công khai sẽ khiến người đang giữ link không thể mở hóa đơn nữa. Tiếp tục?"
      )
    ) {
      return;
    }
    setLinkSaving(invoiceId);
    setError(null);
    setLinkMessage(null);
    setIssuedUrl(null);
    try {
      await renterBillingApi.revokePublicLink(invoiceId);
      setLinkMessage("Đã thu hồi link hóa đơn công khai.");
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Không thể thu hồi link công khai."
      );
    } finally {
      setLinkSaving(null);
    }
  }

  return (
    <AdminShell
      title={data?.cycle.code ?? "Chi tiết kỳ hóa đơn"}
      eyebrow="RENTER BILLING · CYCLE DETAIL"
      activeNav="Hóa đơn"
    >
      <a className="back-link" href="/billing">← Các kỳ hóa đơn</a>

      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Không thể tải kỳ hóa đơn.</strong>
          <span>{error}</span>
        </div>
      ) : null}
      {notificationMessage ? (
        <div className="admin-state admin-state--success">
          <strong>Chiến dịch gửi hóa đơn đã được tạo.</strong>
          <span>{notificationMessage}</span>
          <a className="text-link" href="/notifications">
            Mở trung tâm thông báo →
          </a>
        </div>
      ) : null}
      {linkMessage ? (
        <div className="admin-state admin-state--success">
          <strong>Public invoice đã cập nhật.</strong>
          <span>{linkMessage}</span>
          {issuedUrl ? (
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" }}>
              <input
                aria-label="Link hóa đơn công khai vừa tạo"
                readOnly
                value={issuedUrl}
                style={{ flex: 1 }}
                onFocus={(event) => event.currentTarget.select()}
              />
              <a
                className="secondary-link-button secondary-link-button--compact"
                href={issuedUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Mở trang khách xem ↗
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
      {loading || !data ? (
        <div className="admin-state">Đang tải invoice snapshots…</div>
      ) : (
        <>
          <section className="asset-context">
            <div>
              <span className="eyebrow">{data.cycle.property.code}</span>
              <h2>{data.cycle.code}</h2>
              <p>
                {data.cycle.periodStart} → {data.cycle.periodEnd} · hạn{" "}
                {data.cycle.dueDate}
              </p>
            </div>
            <div className="button-row">
              <StatusBadge
                tone={data.cycle.status === "FINALIZED" ? "success" : "warning"}
              >
                {data.cycle.status}
              </StatusBadge>
              {data.cycle.status === "FINALIZED" ? (
                <button
                  className="primary-button"
                  type="button"
                  disabled={notificationSaving}
                  onClick={() => void sendInvoiceNotifications()}
                >
                  {notificationSaving ? "Đang xếp hàng…" : "Gửi hóa đơn"}
                </button>
              ) : null}
            </div>
          </section>

          {data.invoices.length === 0 ? (
            <div className="admin-state">
              <strong>Chưa có invoice draft.</strong>
              <span>Quay lại danh sách và chạy “Tính hóa đơn nháp”.</span>
            </div>
          ) : (
            <div className="renter-invoice-stack">
              {data.invoices.map((invoice) => (
                <section className="panel renter-invoice-card" key={invoice.id}>
                  <div className="asset-section-heading">
                    <div>
                      <span className="eyebrow">
                        PHÒNG {invoice.room.code} · {invoice.lease.code}
                      </span>
                      <h2>{invoice.number}</h2>
                      <p className="panel-meta">
                        {invoice.primaryResidentName}
                      </p>
                    </div>
                    <div className="button-row">
                      <StatusBadge
                        tone={
                          invoice.calculationStatus === "READY"
                            ? "success"
                            : "warning"
                        }
                      >
                        {invoice.calculationStatus}
                      </StatusBadge>
                      {invoice.status === "ISSUED" ? (
                        <StatusBadge tone={collectionTone(invoice.collectionStatus)}>
                          {collectionLabel(invoice.collectionStatus)}
                        </StatusBadge>
                      ) : null}
                      <StatusBadge
                        tone={invoice.status === "ISSUED" ? "success" : "neutral"}
                      >
                        {invoice.status}
                      </StatusBadge>
                    </div>
                  </div>

                  {invoice.calculationStatus === "REVIEW_REQUIRED" ? (
                    <div className="admin-state admin-state--error">
                      <strong>Chưa thể phát hành hóa đơn này.</strong>
                      {invoice.reviewReasons.length === 0 ? (
                        <span>Dữ liệu tính tiền chưa sẵn sàng.</span>
                      ) : (
                        invoice.reviewReasons.map((reason, index) => (
                          <span key={index}>{reviewReasonLabel(reason)}</span>
                        ))
                      )}
                    </div>
                  ) : null}

                  <div className="billing-cycle-card__stats">
                    <div>
                      <span>Subtotal</span>
                      <strong><MoneyDisplay amountVnd={invoice.subtotalVnd} /></strong>
                    </div>
                    <div>
                      <span>Adjustment</span>
                      <strong><MoneyDisplay amountVnd={invoice.adjustmentVnd} /></strong>
                    </div>
                    <div>
                      <span>Tổng</span>
                      <strong><MoneyDisplay amountVnd={invoice.totalVnd} /></strong>
                    </div>
                    <div>
                      <span>Đã thu</span>
                      <strong><MoneyDisplay amountVnd={invoice.paidVnd} /></strong>
                    </div>
                    <div>
                      <span>Còn lại</span>
                      <strong><MoneyDisplay amountVnd={invoice.remainingVnd} /></strong>
                    </div>
                  </div>

                  <div className="renter-invoice-lines">
                    {invoice.lines.map((line) => (
                      <div className="renter-invoice-line" key={line.id}>
                        <div>
                          <strong>{line.description}</strong>
                          <span>
                            {line.type} · {line.quantity} ×{" "}
                            {new Intl.NumberFormat("vi-VN").format(line.unitPriceVnd)}
                          </span>
                        </div>
                        <MoneyDisplay amountVnd={line.amountVnd} />
                      </div>
                    ))}
                  </div>

                  {invoice.status === "ISSUED" ? (
                    <div className="button-row">
                      <a
                        className="secondary-link-button"
                        href={
                          "/billing/invoices/" +
                          invoice.id +
                          "/payment"
                        }
                      >
                        {invoice.remainingVnd > 0
                          ? "Ghi nhận thanh toán"
                          : "Xem lịch sử thu tiền"}
                      </a>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={linkSaving === invoice.id}
                        onClick={() =>
                          void issuePublicLink(
                            invoice.id,
                            invoice.publicLinkActive
                          )
                        }
                      >
                        {invoice.publicLinkActive
                          ? "Đổi link công khai"
                          : "Tạo link công khai"}
                      </button>
                      {issuedUrls[invoice.id] ? (
                        <>
                          <a
                            className="secondary-link-button"
                            href={issuedUrls[invoice.id]}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            📱 Mở trang khách xem ↗
                          </a>
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => {
                              const targetUrl = issuedUrls[invoice.id];
                              if (targetUrl) {
                                void navigator.clipboard.writeText(targetUrl);
                                setLinkMessage("Đã sao chép link công khai vào clipboard.");
                              }
                            }}
                          >
                            📋 Sao chép link
                          </button>
                        </>
                      ) : null}
                      {invoice.publicLinkActive ? (
                        <button
                          className="danger-button"
                          type="button"
                          disabled={linkSaving === invoice.id}
                          onClick={() => void revokePublicLink(invoice.id)}
                        >
                          Thu hồi link
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {invoice.issuedAt ? (
                    <p className="inline-note">
                      Issued: {new Date(invoice.issuedAt).toLocaleString("vi-VN")}.
                      Snapshot tài chính không được sửa trực tiếp sau thời điểm này.
                    </p>
                  ) : null}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </AdminShell>
  );
}
