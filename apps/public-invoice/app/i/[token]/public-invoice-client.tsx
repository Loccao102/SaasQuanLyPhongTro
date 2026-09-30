"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircleOutlined,
  CloseOutlined,
  CopyOutlined,
  DownloadOutlined,
  FileTextOutlined,
  HistoryOutlined,
  HomeOutlined,
  MobileOutlined,
  PrinterOutlined,
  ToolOutlined
} from "@ant-design/icons";
import { MoneyDisplay, StatusBadge, formatDateVi } from "@propops/ui";

type CollectionStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID";

type PortalData = {
  organizationName: string;
  propertyName: string;
  roomCode: string;
  lease: {
    code: string;
    status: string;
    startDate: string;
    plannedEndDate: string | null;
    baseRentVnd: number;
    depositVnd: number;
    billingDay: number;
  } | null;
  primaryResident: {
    fullName: string | null;
    phone: string | null;
  } | null;
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    totalVnd: number;
    paidVnd: number;
    remainingVnd: number;
    collectionStatus: CollectionStatus;
    issuedAt: string;
  }>;
  equipment: Array<{
    id: string;
    name: string;
    brand: string | null;
    modelOrSerial: string | null;
    quantity: number;
    conditionStatus: string;
    note: string | null;
  }>;
};

type PublicInvoice = {
  organizationName: string;
  propertyName: string;
  roomCode: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  issuedAt: string;
  subtotalVnd?: number;
  adjustmentVnd?: number;
  previousBalanceVnd?: number;
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

function updateQrAmount(qrUrl: string, amount: number): string {
  try {
    const url = new URL(qrUrl);
    url.searchParams.set("amount", String(amount));
    return url.toString();
  } catch {
    return qrUrl;
  }
}

export function PublicInvoiceClient({ token }: { token: string }) {
  const [data, setData] = useState<PublicInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [live, setLive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"INVOICE" | "PORTAL">("INVOICE");
  const [portalData, setPortalData] = useState<PortalData | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);

  async function loadPortal() {
    setLoadingPortal(true);
    try {
      const res = await fetch(apiBase + "/public/renter-invoices/" + encodedToken + "/portal", {
        cache: "no-store"
      });
      if (res.ok) {
        const p = (await res.json()) as PortalData;
        setPortalData(p);
      }
    } catch {
      // fallback
    } finally {
      setLoadingPortal(false);
    }
  }

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
      setData((current) => {
        if (!current) return current;
        const nextPayment =
          current.payment.configured && status.remainingVnd > 0
            ? {
                ...current.payment,
                qrImageUrl: updateQrAmount(
                  current.payment.qrImageUrl,
                  status.remainingVnd
                )
              }
            : current.payment;
        return {
          ...current,
          paidVnd: status.paidVnd,
          remainingVnd: status.remainingVnd,
          collectionStatus: status.collectionStatus,
          updatedAt: status.updatedAt,
          payment: nextPayment
        };
      });
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

  async function copySingleField(key: string, val: string) {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // fallback
    }
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

  const configuredPayment = data.payment.configured ? data.payment : null;

  return (
    <main className="invoice-page">
      <article className="invoice-card">
        <nav className="portal-tabs no-print" aria-label="Chuyển chế độ xem">
          <button
            type="button"
            className={`portal-tab-btn ${activeTab === "INVOICE" ? "portal-tab-btn--active" : ""}`}
            onClick={() => setActiveTab("INVOICE")}
          >
            <FileTextOutlined /> Hóa đơn kỳ này
          </button>
          <button
            type="button"
            className={`portal-tab-btn ${activeTab === "PORTAL" ? "portal-tab-btn--active" : ""}`}
            onClick={() => {
              setActiveTab("PORTAL");
              if (!portalData && !loadingPortal) {
                void loadPortal();
              }
            }}
          >
            <HomeOutlined /> Cổng cư dân & Tiện ích
          </button>
        </nav>

        {activeTab === "PORTAL" ? (
          <div>
            <header className="invoice-header" style={{ marginBottom: "16px" }}>
              <div>
                <span className="invoice-kicker">CỔNG TRA CỨU CƯ DÂN</span>
                <h1>Phòng {data.roomCode}</h1>
                <p className="invoice-period">{data.propertyName}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: "11px", color: "var(--color-text-muted)", display: "block" }}>Người thuê chính</span>
                <strong style={{ fontSize: "14px", color: "var(--color-text)" }}>
                  {portalData?.primaryResident?.fullName || "Khách thuê"}
                </strong>
                {portalData?.primaryResident?.phone ? (
                  <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                    {portalData.primaryResident.phone}
                  </div>
                ) : null}
              </div>
            </header>

            {loadingPortal ? (
              <div style={{ padding: "36px 0", textAlign: "center", color: "var(--color-text-muted)" }}>
                Đang tải dữ liệu phòng & tiện ích…
              </div>
            ) : portalData ? (
              <>
                <section className="portal-section" aria-label="Thông tin hợp đồng">
                  <h3><FileTextOutlined style={{ color: "var(--color-primary)" }} /> Hợp đồng thuê phòng</h3>
                  {portalData.lease ? (
                    <div className="portal-grid">
                      <div className="portal-info-box">
                        <span>Mã hợp đồng</span>
                        <strong>{portalData.lease.code}</strong>
                      </div>
                      <div className="portal-info-box">
                        <span>Giá thuê cơ bản</span>
                        <strong><MoneyDisplay amountVnd={portalData.lease.baseRentVnd} /> / tháng</strong>
                      </div>
                      <div className="portal-info-box">
                        <span>Tiền đặt cọc</span>
                        <strong><MoneyDisplay amountVnd={portalData.lease.depositVnd} /></strong>
                      </div>
                      <div className="portal-info-box">
                        <span>Thời hạn hợp đồng</span>
                        <strong>
                          {formatDateVi(portalData.lease.startDate)}
                          {portalData.lease.plannedEndDate ? ` – ${formatDateVi(portalData.lease.plannedEndDate)}` : " (Lâu dài)"}
                        </strong>
                      </div>
                    </div>
                  ) : (
                    <p style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                      Hợp đồng chưa được lưu trên hệ thống hoặc đã hết hiệu lực.
                    </p>
                  )}
                </section>

                <section className="portal-section" aria-label="Lịch sử hóa đơn">
                  <h3><HistoryOutlined style={{ color: "var(--color-primary)" }} /> Lịch sử hóa đơn tiền phòng</h3>
                  {portalData.invoices && portalData.invoices.length > 0 ? (
                    <div>
                      {portalData.invoices.map((inv) => (
                        <div className="history-item" key={inv.id}>
                          <div>
                            <strong style={{ display: "block" }}>{inv.invoiceNumber}</strong>
                            <span style={{ fontSize: "11px", color: "#64748b" }}>
                              Kỳ: {formatDateVi(inv.periodStart)} – {formatDateVi(inv.periodEnd)}
                            </span>
                          </div>
                          <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                            <strong><MoneyDisplay amountVnd={inv.totalVnd} /></strong>
                            <StatusBadge tone={tone(inv.collectionStatus)}>
                              {label(inv.collectionStatus)}
                            </StatusBadge>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                      Chưa có hóa đơn nào khác ngoài kỳ hiện tại.
                    </p>
                  )}
                </section>

                <section className="portal-section" aria-label="Trang thiết bị phòng">
                  <h3><CheckCircleOutlined style={{ color: "var(--color-primary)" }} /> Tiện nghi & Trang thiết bị</h3>
                  {portalData.equipment && portalData.equipment.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {portalData.equipment.map((eq) => (
                        <div className="equipment-badge" key={eq.id}>
                          <span style={{ color: "#16a34a" }}>✓</span>
                          <strong>{eq.name}</strong>
                          {eq.quantity > 1 ? <span>(x{eq.quantity})</span> : null}
                          {eq.brand ? <span style={{ color: "#64748b" }}>· {eq.brand}</span> : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                      Phòng đã được trang bị các tiện ích cơ bản theo thỏa thuận hợp đồng.
                    </p>
                  )}
                </section>

                <section className="portal-section no-print">
                  <h3><ToolOutlined style={{ color: "var(--color-primary)" }} /> Hỗ trợ & Báo hỏng thiết bị</h3>
                  <p style={{ fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "12px" }}>
                    Nếu gặp sự cố điện, nước, internet hoặc hư hỏng thiết bị trong phòng, bạn có thể gửi yêu cầu trực tiếp tới quản lý.
                  </p>
                  <button
                    type="button"
                    className="pay-button"
                    style={{ background: "#475569", minHeight: "44px" }}
                    onClick={() => setShowReportModal(true)}
                  >
                    <ToolOutlined /> Báo hỏng / Gửi yêu cầu sửa chữa
                  </button>
                </section>
              </>
            ) : null}
          </div>
        ) : (
          <>
        <header className="invoice-header">
          <div>
            <span className="invoice-kicker">
              PHÒNG {data.roomCode} · {data.propertyName}
            </span>
            <h1>{data.invoiceNumber}</h1>
            <p className="invoice-period">
              {formatDateVi(data.periodStart)} – {formatDateVi(data.periodEnd)}
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
            <StatusBadge tone={tone(data.collectionStatus)}>
              {label(data.collectionStatus)}
            </StatusBadge>
            <button
              type="button"
              className="no-print"
              onClick={() => window.print()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: 600,
                color: "#475569",
                background: "#f1f5f9",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
                cursor: "pointer"
              }}
              title="In phiếu hoặc lưu dạng PDF"
            >
              <PrinterOutlined /> In phiếu / PDF
            </button>
          </div>
        </header>

        <section className="amount-block" aria-label="Số tiền cần thanh toán">
          <span>Còn phải thanh toán</span>
          <strong><MoneyDisplay amountVnd={data.remainingVnd} /></strong>
          <small>
            Tổng <MoneyDisplay amountVnd={data.totalVnd} /> · đã thanh toán{" "}
            <MoneyDisplay amountVnd={data.paidVnd} /> · hạn {formatDateVi(data.dueDate)}
          </small>
        </section>

        <section className="invoice-lines" aria-label="Chi tiết hóa đơn">
          {data.lines.map((line, index) => (
            <div className="invoice-line" key={line.description + index}>
              <div>
                <span style={line.type === "PREVIOUS_DEBT" ? { color: "#b91c1c", fontWeight: 600 } : undefined}>
                  {line.description}
                </span>
                <small>
                  {line.type === "PREVIOUS_DEBT"
                    ? "Dư nợ các kỳ trước chưa thanh toán"
                    : `${line.quantity} × ${new Intl.NumberFormat("vi-VN").format(line.unitPriceVnd)}đ`}
                </small>
              </div>
              <strong style={line.type === "PREVIOUS_DEBT" ? { color: "#b91c1c" } : undefined}>
                <MoneyDisplay amountVnd={line.amountVnd} />
              </strong>
            </div>
          ))}
          <div className="invoice-line invoice-line--total">
            <span>Tổng hóa đơn</span>
            <strong><MoneyDisplay amountVnd={data.totalVnd} /></strong>
          </div>
        </section>

        {data.collectionStatus === "PAID" ? (
          <section className="payment-complete--celebration">
            <CheckCircleOutlined className="celebration-icon" aria-hidden="true" />
            <h2>Thanh toán thành công!</h2>
            <p>
              Hóa đơn <strong>{data.invoiceNumber}</strong> đã được ghi nhận thanh toán đầy đủ.
              <br />
              Cảm ơn bạn đã hoàn thành tiền phòng đúng hạn. Bạn không cần chuyển thêm tiền.
            </p>
          </section>
        ) : configuredPayment ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="realtime-indicator">
                <span className="pulse-dot" /> Nhận tiền tự động 24/7
              </span>
              <span style={{ fontSize: "11px", color: "#64748b" }}>
                Tự gạch nợ sau khi chuyển
              </span>
            </div>
            <section className="payment-box">
              <div>
                <img
                  className="vietqr-image"
                  src={configuredPayment.qrImageUrl}
                  alt={"VietQR thanh toán " + data.invoiceNumber}
                  referrerPolicy="no-referrer"
                />
                <div className="qr-actions">
                  <a
                    className="qr-action-btn"
                    href={configuredPayment.qrImageUrl}
                    download={`VietQR_${data.invoiceNumber}.png`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <DownloadOutlined aria-hidden="true" /> Tải ảnh QR
                  </a>
                  <a
                    className="qr-action-btn"
                    href={`vietqr://transfer?bank=${encodeURIComponent(configuredPayment.bankId)}&account=${encodeURIComponent(configuredPayment.accountNo)}&amount=${data.remainingVnd}&memo=${encodeURIComponent(configuredPayment.paymentReference)}`}
                  >
                    <MobileOutlined aria-hidden="true" /> Mở App NH
                  </a>
                </div>
              </div>
              <div className="payment-copy">
                <span className="invoice-kicker">VIETQR NAPAS 247</span>
                <h2>Quét mã để chuyển đúng số tiền còn lại</h2>
                <dl>
                  <div>
                    <dt>Ngân hàng</dt>
                    <dd>{configuredPayment.bankId}</dd>
                  </div>
                  <div>
                    <dt>Số tài khoản</dt>
                    <dd>
                      {configuredPayment.accountNo}
                      <button
                        type="button"
                        className={`copy-chip ${copiedKey === "accountNo" ? "copy-chip--copied" : ""}`}
                        onClick={() => void copySingleField("accountNo", configuredPayment.accountNo)}
                      >
                        <CopyOutlined aria-hidden="true" />
                        {copiedKey === "accountNo" ? "Đã chép" : "Chép"}
                      </button>
                    </dd>
                  </div>
                  <div>
                    <dt>Thụ hưởng</dt>
                    <dd>{configuredPayment.accountName}</dd>
                  </div>
                  <div>
                    <dt>Số tiền cần chuyển</dt>
                    <dd>
                      <MoneyDisplay amountVnd={data.remainingVnd} />
                      <button
                        type="button"
                        className={`copy-chip ${copiedKey === "amount" ? "copy-chip--copied" : ""}`}
                        onClick={() => void copySingleField("amount", String(data.remainingVnd))}
                      >
                        <CopyOutlined aria-hidden="true" />
                        {copiedKey === "amount" ? "Đã chép" : "Chép"}
                      </button>
                    </dd>
                  </div>
                  <div>
                    <dt>Nội dung chuyển khoản</dt>
                    <dd>
                      {configuredPayment.paymentReference}
                      <button
                        type="button"
                        className={`copy-chip ${copiedKey === "memo" ? "copy-chip--copied" : ""}`}
                        onClick={() => void copySingleField("memo", configuredPayment.paymentReference)}
                      >
                        <CopyOutlined aria-hidden="true" />
                        {copiedKey === "memo" ? "Đã chép" : "Chép"}
                      </button>
                    </dd>
                  </div>
                </dl>
              </div>
            </section>
            <button className="pay-button" type="button" onClick={() => void copyPayment()}>
              {copied ? "Đã sao chép tất cả thông tin" : "Sao chép toàn bộ thông tin chuyển khoản"}
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
            <ToolOutlined aria-hidden="true" /> Báo hỏng / Yêu cầu sửa chữa
          </button>
        </section>

        </>
        )}

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
                  <CloseOutlined aria-hidden="true" />
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
                  <CheckCircleOutlined aria-hidden="true" /> {reportSuccess}
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
