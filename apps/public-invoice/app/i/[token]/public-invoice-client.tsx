"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircleOutlined,
  CloseOutlined,
  CopyOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  HistoryOutlined,
  HomeOutlined,
  MobileOutlined,
  PrinterOutlined,
  ToolOutlined
} from "@ant-design/icons";
import { MoneyDisplay, StatusBadge, formatDateVi } from "@propops/ui";

type CollectionStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID";

type PublicMaintenanceTicket = {
  id: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  description: string;
  residentName: string;
  residentPhone: string | null;
  images: string[];
  reportedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
};

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
    signatureDataUrl?: string | null;
    signedAt?: string | null;
    signedByName?: string | null;
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
  const [tickets, setTickets] = useState<PublicMaintenanceTicket[]>([]);
  const [showSignModal, setShowSignModal] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

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
      const ticketRes = await fetch(apiBase + "/public/maintenance/" + encodedToken, {
        cache: "no-store"
      });
      if (ticketRes.ok) {
        const tList = (await ticketRes.json()) as PublicMaintenanceTicket[];
        setTickets(tList);
      }
    } catch {
      // fallback
    } finally {
      setLoadingPortal(false);
    }
  }

  function startDrawing(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const touch = "touches" in e && e.touches.length > 0 ? e.touches[0] : null;
    const clientX = touch ? touch.clientX : ("clientX" in e ? e.clientX : 0);
    const clientY = touch ? touch.clientY : ("clientY" in e ? e.clientY : 0);
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1e3a8a";
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasDrawn(true);
  }

  function draw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const touch = "touches" in e && e.touches.length > 0 ? e.touches[0] : null;
    const clientX = touch ? touch.clientX : ("clientX" in e ? e.clientX : 0);
    const clientY = touch ? touch.clientY : ("clientY" in e ? e.clientY : 0);
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function stopDrawing() {
    setIsDrawing(false);
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  async function handleSignSubmit() {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) {
      setSignError("Vui lòng vẽ chữ ký của bạn vào khung trắng.");
      return;
    }
    const name = (signerName || portalData?.primaryResident?.fullName || "").trim();
    if (!name || name.length < 2) {
      setSignError("Vui lòng nhập họ và tên người ký (tối thiểu 2 ký tự).");
      return;
    }
    setSigning(true);
    setSignError(null);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const res = await fetch(apiBase + "/public/renter-invoices/" + encodedToken + "/sign-lease", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signatureDataUrl: dataUrl,
          signedByName: name
        })
      });
      const body = (await res.json()) as { message?: string };
      if (!res.ok) {
        throw new Error(body.message || "Không thể lưu chữ ký điện tử.");
      }
      setShowSignModal(false);
      void loadPortal();
    } catch (err) {
      setSignError(err instanceof Error ? err.message : "Có lỗi xảy ra khi ký hợp đồng.");
    } finally {
      setSigning(false);
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
    if (data.collectionStatus === "PAID") {
      setLive(true);
      return;
    }
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
      if (status.collectionStatus === "PAID") {
        stream.close();
      }
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
                      {portalData.lease.signedAt ? (
                        <div className="signature-box" style={{ gridColumn: "1 / -1", marginTop: "6px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                            <span style={{ fontSize: "12px", color: "#166534", fontWeight: 700 }}>
                              ✓ ĐÃ KÝ ĐIỆN TỬ
                            </span>
                            <span style={{ fontSize: "11px", color: "#64748b" }}>
                              {formatDateVi(portalData.lease.signedAt)}
                            </span>
                          </div>
                          <div style={{ fontSize: "12px", color: "#334155" }}>
                            Người ký: <strong>{portalData.lease.signedByName || portalData.primaryResident?.fullName || "Khách thuê"}</strong>
                          </div>
                          {portalData.lease.signatureDataUrl ? (
                            <div style={{ marginTop: "6px", background: "white", padding: "4px 8px", borderRadius: "6px", display: "inline-block", border: "1px solid #dcfce7" }}>
                              <img
                                src={portalData.lease.signatureDataUrl}
                                alt="Chữ ký điện tử"
                                style={{ maxHeight: "40px", maxWidth: "150px", display: "block" }}
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div style={{ gridColumn: "1 / -1", marginTop: "6px", padding: "10px 14px", background: "#f8fafc", borderRadius: "10px", border: "1px dashed #cbd5e1", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                          <div>
                            <span style={{ fontSize: "12px", fontWeight: 600, color: "#334155", display: "block" }}>
                              Chưa có chữ ký điện tử online
                            </span>
                            <span style={{ fontSize: "11px", color: "#64748b" }}>
                              Xác nhận hợp đồng tiện lợi trực tiếp trên điện thoại
                            </span>
                          </div>
                          <button
                            type="button"
                            className="no-print"
                            style={{
                              padding: "6px 14px",
                              background: "#0284c7",
                              color: "white",
                              border: "none",
                              borderRadius: "6px",
                              fontSize: "12px",
                              fontWeight: 600,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px"
                            }}
                            onClick={() => {
                              setSignerName(portalData.primaryResident?.fullName || "");
                              setShowSignModal(true);
                            }}
                          >
                            <EditOutlined /> Ký hợp đồng online
                          </button>
                        </div>
                      )}
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

                  {tickets && tickets.length > 0 ? (
                    <div style={{ marginTop: "16px" }}>
                      <h4 style={{ fontSize: "13px", fontWeight: 700, margin: "0 0 10px 0", color: "#334155" }}>
                        Yêu cầu sự cố đã gửi ({tickets.length})
                      </h4>
                      {tickets.map((t) => (
                        <div className="ticket-item" key={t.id}>
                          <div className="ticket-header">
                            <strong style={{ fontSize: "13px", color: "#1e293b" }}>{t.title}</strong>
                            <StatusBadge tone={t.status === "RESOLVED" || t.status === "CLOSED" ? "success" : t.status === "IN_PROGRESS" ? "info" : "warning"}>
                              {t.status === "OPEN" ? "Chờ xử lý" : t.status === "IN_PROGRESS" ? "Đang sửa" : t.status === "RESOLVED" ? "Đã giải quyết" : t.status === "CLOSED" ? "Đã đóng" : "Đã hủy"}
                            </StatusBadge>
                          </div>
                          <p style={{ margin: "4px 0 6px 0", fontSize: "12px", color: "#475569", lineHeight: 1.4 }}>
                            {t.description}
                          </p>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "#94a3b8" }}>
                            <span>Ngày báo: {formatDateVi(t.reportedAt)}</span>
                            {t.resolutionNote ? (
                              <span style={{ color: "#15803d", fontWeight: 600 }}>Ghi chú: {t.resolutionNote}</span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
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

        {showSignModal ? (
          <div
            className="no-print"
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(15, 23, 42, 0.65)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
              zIndex: 9999
            }}
          >
            <div
              style={{
                background: "white",
                borderRadius: "16px",
                width: "min(100%, 460px)",
                padding: "20px",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h3 style={{ margin: 0, fontSize: "16px", color: "#1e293b", display: "flex", alignItems: "center", gap: "8px" }}>
                  <EditOutlined style={{ color: "#0284c7" }} /> Ký hợp đồng điện tử
                </h3>
                <button
                  type="button"
                  onClick={() => setShowSignModal(false)}
                  style={{ background: "none", border: "none", fontSize: "16px", cursor: "pointer", color: "#64748b" }}
                >
                  <CloseOutlined />
                </button>
              </div>

              <p style={{ margin: "0 0 12px 0", fontSize: "12px", color: "#64748b", lineHeight: 1.5 }}>
                Bằng việc ký tên bên dưới, bạn xác nhận đã đọc, hiểu và đồng ý với các điều khoản trong Hợp đồng thuê phòng <strong>{portalData?.lease?.code}</strong>.
              </p>

              {signError ? (
                <div style={{ padding: "8px 12px", background: "#fef2f2", color: "#b91c1c", borderRadius: "8px", fontSize: "12px", marginBottom: "12px" }}>
                  {signError}
                </div>
              ) : null}

              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "12px" }}>
                <span>Họ và tên người ký *</span>
                <input
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Nhập họ và tên của bạn"
                  style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                />
              </label>

              <div style={{ marginBottom: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>Vẽ chữ ký tay (chạm hoặc rê chuột) *</span>
                  <button
                    type="button"
                    onClick={clearCanvas}
                    style={{ background: "none", border: "none", color: "#0284c7", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}
                  >
                    Xóa vẽ lại
                  </button>
                </div>
                <div className="signature-canvas-wrap">
                  <canvas
                    ref={canvasRef}
                    width={400}
                    height={140}
                    style={{ width: "100%", height: "140px", display: "block" }}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                  />
                </div>
                <span style={{ fontSize: "11px", color: "#94a3b8", display: "block", marginTop: "4px" }}>
                  Chữ ký sẽ được lưu cùng dấu thời gian và địa chỉ IP để làm bằng chứng pháp lý.
                </span>
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  disabled={signing}
                  onClick={handleSignSubmit}
                  style={{
                    flex: 1,
                    padding: "10px",
                    background: "#0284c7",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    fontWeight: 600,
                    fontSize: "13px",
                    cursor: "pointer"
                  }}
                >
                  {signing ? "Đang lưu chữ ký..." : "Xác nhận & Hoàn tất ký"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSignModal(false)}
                  style={{
                    padding: "10px 14px",
                    background: "#f1f5f9",
                    border: "none",
                    borderRadius: "8px",
                    color: "#475569",
                    fontSize: "13px",
                    cursor: "pointer"
                  }}
                >
                  Hủy
                </button>
              </div>
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
