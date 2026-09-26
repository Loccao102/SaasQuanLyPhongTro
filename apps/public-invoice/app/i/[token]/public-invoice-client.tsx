"use client";

import { useEffect, useMemo, useState } from "react";
import { MoneyDisplay, StatusBadge } from "@propops/ui";

type CollectionStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID";

type PublicInvoice = {
  organizationName: string;
  propertyName: string;
  roomCode: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  issuedAt: string;
  totalVnd: number;
  paidVnd: number;
  remainingVnd: number;
  collectionStatus: CollectionStatus;
  updatedAt: string;
  lines: Array<{
    type: string;
    description: string;
    quantity: string;
    unitPriceVnd: number;
    amountVnd: number;
  }>;
  payment:
    | {
        configured: true;
        bankId: string;
        accountNo: string;
        accountName: string;
        paymentReference: string;
        qrImageUrl: string;
      }
    | {
        configured: false;
        paymentReference: string;
      };
};

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";

function tone(status: CollectionStatus) {
  if (status === "PAID") return "success" as const;
  if (status === "PARTIALLY_PAID") return "warning" as const;
  return "neutral" as const;
}

function label(status: CollectionStatus) {
  if (status === "PAID") return "ĐÃ THANH TOÁN";
  if (status === "PARTIALLY_PAID") return "ĐÃ THANH TOÁN MỘT PHẦN";
  return "CHƯA THANH TOÁN";
}

export function PublicInvoiceClient({ token }: { token: string }) {
  const [data, setData] = useState<PublicInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [live, setLive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const encodedToken = useMemo(() => encodeURIComponent(token), [token]);

  async function handleReportSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setReporting(true);
    setReportError(null);
    setReportSuccess(null);
    try {
      const res = await fetch(apiBase + "/public/maintenance/" + encodedToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(form.get("title") ?? ""),
          category: String(form.get("category") ?? "OTHER"),
          description: String(form.get("description") ?? ""),
          residentName: String(form.get("residentName") ?? "") || undefined,
          residentPhone: String(form.get("residentPhone") ?? "") || undefined
        })
      });
      const body = (await res.json()) as { message?: string };
      if (!res.ok) {
        throw new Error(body.message || "Không thể gửi yêu cầu báo hỏng.");
      }
      setReportSuccess(body.message || "Đã gửi thông báo thành công tới chủ nhà.");
      setTimeout(() => {
        setShowReportModal(false);
        setReportSuccess(null);
      }, 3000);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Có lỗi xảy ra khi gửi.");
    } finally {
      setReporting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(
          apiBase + "/public/renter-invoices/" + encodedToken,
          { cache: "no-store" }
        );
        if (!response.ok) {
          if (!cancelled) setInvalid(true);
          return;
        }
        const invoice = (await response.json()) as PublicInvoice;
        if (!cancelled) {
          setData(invoice);
          setInvalid(false);
        }
      } catch {
        if (!cancelled) setInvalid(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [encodedToken]);

  useEffect(() => {
    if (!data || invalid) return;
    const stream = new EventSource(
      apiBase + "/public/renter-invoices/" + encodedToken + "/events"
    );
    stream.addEventListener("open", () => setLive(true));
    stream.addEventListener("error", () => setLive(false));
    stream.addEventListener("payment-status", (event) => {
      const status = JSON.parse((event as MessageEvent<string>).data) as {
        paidVnd: number;
        remainingVnd: number;
        collectionStatus: CollectionStatus;
        updatedAt: string;
      };
      setData((current) =>
        current
          ? {
              ...current,
              paidVnd: status.paidVnd,
              remainingVnd: status.remainingVnd,
              collectionStatus: status.collectionStatus,
              updatedAt: status.updatedAt
            }
          : current
      );
    });
    return () => stream.close();
  }, [data?.invoiceNumber, encodedToken, invalid]);

  async function copyPayment() {
    if (!data?.payment.configured) return;
    const text = [
      "Ngân hàng: " + data.payment.bankId,
      "Số tài khoản: " + data.payment.accountNo,
      "Tên thụ hưởng: " + data.payment.accountName,
      "Số tiền: " + String(data.remainingVnd) + " VND",
      "Nội dung: " + data.payment.paymentReference
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (loading) {
    return (
      <main className="invoice-page">
        <article className="invoice-card invoice-card--state">
          <span className="invoice-kicker">HABI · PUBLIC INVOICE</span>
          <h1>Đang tải hóa đơn…</h1>
          <p>Đang lấy số tiền và trạng thái thanh toán mới nhất.</p>
        </article>
      </main>
    );
  }

  if (invalid || !data) {
    return (
      <main className="invoice-page">
        <article className="invoice-card invoice-card--state">
          <span className="invoice-kicker">HABI · LINK KHÔNG CÒN HIỆU LỰC</span>
          <h1>Không thể mở hóa đơn này</h1>
          <p>
            Link có thể đã được thu hồi hoặc thay bằng link mới. Hãy liên hệ chủ
            nhà để nhận lại liên kết hóa đơn.
          </p>
        </article>
      </main>
    );
  }

  return (
    <main className="invoice-page">
      <article className="invoice-card">
        <header className="invoice-header">
          <div>
            <span className="invoice-kicker">
              PHÒNG {data.roomCode} · {data.propertyName}
            </span>
            <h1>{data.invoiceNumber}</h1>
            <p className="invoice-period">
              {data.periodStart} → {data.periodEnd}
            </p>
          </div>
          <StatusBadge tone={tone(data.collectionStatus)}>
            {label(data.collectionStatus)}
          </StatusBadge>
        </header>

        <section className="amount-block" aria-label="Số tiền cần thanh toán">
          <span>Còn phải thanh toán</span>
          <strong><MoneyDisplay amountVnd={data.remainingVnd} /></strong>
          <small>
            Tổng <MoneyDisplay amountVnd={data.totalVnd} /> · đã thanh toán{" "}
            <MoneyDisplay amountVnd={data.paidVnd} /> · hạn {data.dueDate}
          </small>
        </section>

        <section className="invoice-lines" aria-label="Chi tiết hóa đơn">
          {data.lines.map((line, index) => (
            <div className="invoice-line" key={line.description + index}>
              <div>
                <span>{line.description}</span>
                <small>
                  {line.quantity} ×{" "}
                  {new Intl.NumberFormat("vi-VN").format(line.unitPriceVnd)}đ
                </small>
              </div>
              <strong><MoneyDisplay amountVnd={line.amountVnd} /></strong>
            </div>
          ))}
          <div className="invoice-line invoice-line--total">
            <span>Tổng hóa đơn</span>
            <strong><MoneyDisplay amountVnd={data.totalVnd} /></strong>
          </div>
        </section>

        {data.collectionStatus === "PAID" ? (
          <section className="payment-complete">
            <strong>Đã nhận đủ thanh toán</strong>
            <p>
              Hóa đơn này đã được cập nhật thanh toán đầy đủ. Bạn không cần
              chuyển thêm tiền.
            </p>
          </section>
        ) : data.payment.configured ? (
          <>
            <section className="payment-box">
              <img
                className="vietqr-image"
                src={data.payment.qrImageUrl}
                alt={"VietQR thanh toán " + data.invoiceNumber}
                referrerPolicy="no-referrer"
              />
              <div className="payment-copy">
                <span className="invoice-kicker">VIETQR</span>
                <h2>Quét mã để chuyển đúng số tiền còn lại</h2>
                <dl>
                  <div><dt>Ngân hàng</dt><dd>{data.payment.bankId}</dd></div>
                  <div><dt>Số tài khoản</dt><dd>{data.payment.accountNo}</dd></div>
                  <div><dt>Thụ hưởng</dt><dd>{data.payment.accountName}</dd></div>
                  <div><dt>Nội dung</dt><dd>{data.payment.paymentReference}</dd></div>
                </dl>
              </div>
            </section>
            <button className="pay-button" type="button" onClick={() => void copyPayment()}>
              {copied ? "Đã sao chép" : "Sao chép thông tin chuyển khoản"}
            </button>
          </>
        ) : (
          <section className="payment-unavailable">
            <strong>Chưa có VietQR cho hóa đơn này</strong>
            <p>
              Chủ nhà chưa cấu hình tài khoản nhận tiền. Vui lòng dùng phương
              thức thanh toán đã được hai bên thống nhất.
            </p>
          </section>
        )}

        <section
          style={{
            marginTop: "1.5rem",
            padding: "1rem",
            background: "#f8fafc",
            borderRadius: "12px",
            border: "1px dashed #cbd5e1",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: "0.5rem"
          }}
        >
          <span style={{ fontSize: "0.85rem", color: "#64748b" }}>
            Phòng gặp sự cố hỏng hóc (điện, nước, điều hòa, đồ đạc)?
          </span>
          <button
            type="button"
            onClick={() => setShowReportModal(true)}
            style={{
              padding: "0.5rem 1rem",
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: "8px",
              fontSize: "0.9rem",
              fontWeight: 600,
              color: "#0f172a",
              cursor: "pointer"
            }}
          >
            🛠 Báo hỏng / Yêu cầu sửa chữa
          </button>
        </section>

        {showReportModal ? (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, 0.6)",
              backdropFilter: "blur(4px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 100,
              padding: "1rem"
            }}
          >
            <div
              style={{
                background: "#ffffff",
                borderRadius: "16px",
                padding: "1.5rem",
                maxWidth: "480px",
                width: "100%",
                boxShadow: "0 20px 25px -5px rgba(0,0,0,0.15)",
                textAlign: "left"
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "1rem"
                }}
              >
                <h3 style={{ margin: 0, fontSize: "1.15rem", color: "#0f172a" }}>
                  Báo hỏng phòng {data.roomCode}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowReportModal(false)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "1.25rem",
                    cursor: "pointer",
                    color: "#64748b"
                  }}
                >
                  ✕
                </button>
              </div>

              {reportSuccess ? (
                <div
                  style={{
                    padding: "1rem",
                    background: "#f0fdf4",
                    color: "#166534",
                    borderRadius: "8px",
                    textAlign: "center",
                    fontWeight: 500
                  }}
                >
                  ✓ {reportSuccess}
                </div>
              ) : (
                <form onSubmit={(e) => void handleReportSubmit(e)}>
                  {reportError ? (
                    <div
                      style={{
                        padding: "0.75rem",
                        background: "#fef2f2",
                        color: "#991b1b",
                        borderRadius: "8px",
                        fontSize: "0.85rem",
                        marginBottom: "1rem"
                      }}
                    >
                      {reportError}
                    </div>
                  ) : null}

                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "#475569" }}>
                      <span>Sự cố cần sửa chữa *</span>
                      <input
                        name="title"
                        placeholder="vd: Máy lạnh chảy nước / Chập điện"
                        required
                        style={{ padding: "0.6rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
                      />
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "#475569" }}>
                      <span>Loại sự cố</span>
                      <select
                        name="category"
                        defaultValue="OTHER"
                        style={{ padding: "0.6rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
                      >
                        <option value="ELECTRICITY">Điện & Ánh sáng</option>
                        <option value="PLUMBING">Ống nước & Bồn cầu</option>
                        <option value="APPLIANCE">Thiết bị máy móc (Máy giặt, Điều hòa...)</option>
                        <option value="STRUCTURAL">Cửa, khóa, tường</option>
                        <option value="INTERNET">Mạng Internet / Wifi</option>
                        <option value="OTHER">Khác</option>
                      </select>
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "#475569" }}>
                      <span>Mô tả chi tiết sự cố *</span>
                      <textarea
                        name="description"
                        rows={3}
                        placeholder="Mô tả cụ thể để thợ mang đúng đồ sửa..."
                        required
                        style={{ padding: "0.6rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
                      />
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "#475569" }}>
                      <span>Tên người báo</span>
                      <input
                        name="residentName"
                        placeholder="Tên của bạn"
                        style={{ padding: "0.6rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
                      />
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", color: "#475569" }}>
                      <span>Số điện thoại liên hệ</span>
                      <input
                        name="residentPhone"
                        placeholder="Số điện thoại thợ liên hệ khi tới"
                        style={{ padding: "0.6rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
                      />
                    </label>

                    <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
                      <button
                        type="submit"
                        disabled={reporting}
                        style={{
                          flex: 1,
                          padding: "0.75rem",
                          background: "#0284c7",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "8px",
                          fontWeight: 600,
                          cursor: "pointer"
                        }}
                      >
                        {reporting ? "Đang gửi..." : "Gửi yêu cầu sửa chữa"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowReportModal(false)}
                        style={{
                          padding: "0.75rem 1rem",
                          background: "#f1f5f9",
                          border: "none",
                          borderRadius: "8px",
                          color: "#475569",
                          cursor: "pointer"
                        }}
                      >
                        Đóng
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </div>
        ) : null}

        <footer className="invoice-footer">
          <span>{data.organizationName}</span>
          <span>{live ? "● Đang tự cập nhật thanh toán" : "Đang kết nối cập nhật…"}</span>
        </footer>
      </article>
    </main>
  );
}
