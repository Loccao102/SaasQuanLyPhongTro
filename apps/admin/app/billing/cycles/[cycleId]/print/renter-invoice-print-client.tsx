"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeftOutlined, PrinterOutlined } from "@ant-design/icons";
import {
  renterBillingApi,
  type RenterBillingDetailResponse
} from "../../../../../lib/renter-billing-api";

function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(amount) + " đ";
}

function formatDateVi(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const [year, month, day] = dateStr.slice(0, 10).split("-");
  if (!year || !month || !day) return dateStr;
  return `${day}/${month}/${year}`;
}

type MeterSnapshot = {
  quantitySource?: string;
  meter?: {
    previous: string | number;
    current: string | number;
    unit: string;
  };
  occupantCount?: number;
  vehicleCount?: number;
};

export function RenterInvoicePrintClient({
  cycleId,
  initialInvoiceId
}: {
  cycleId: string;
  initialInvoiceId: string | null;
}) {
  const [data, setData] = useState<RenterBillingDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(
    initialInvoiceId ?? "ALL"
  );
  const [printLayout, setPrintLayout] = useState<"A4_FULL" | "A5_COMPACT">(
    "A4_FULL"
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const detailData = await renterBillingApi.detail(cycleId);
        if (active) {
          setData(detailData);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Không thể tải dữ liệu hóa đơn để in."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [cycleId]);

  const invoicesToPrint = useMemo(() => {
    if (!data) return [];
    if (selectedInvoiceId === "ALL") {
      return data.invoices;
    }
    return data.invoices.filter((inv) => inv.id === selectedInvoiceId);
  }, [data, selectedInvoiceId]);

  if (loading) {
    return (
      <div className="invoice-print-page">
        <div className="admin-state">Đang tải phiếu thu để in…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="invoice-print-page">
        <div className="invoice-print-toolbar">
          <a
            className="secondary-link-button"
            href={`/billing/cycles/${cycleId}`}
          >
            <ArrowLeftOutlined aria-hidden="true" /> Quay lại chu kỳ hóa đơn
          </a>
        </div>
        <div className="admin-state admin-state--error">
          <strong>Lỗi tải dữ liệu in.</strong>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  const { organization, cycle, paymentProfile } = data;

  return (
    <div className={`invoice-print-page invoice-print-page--${printLayout.toLowerCase()}`}>
      <div className="invoice-print-toolbar no-print">
        <div className="invoice-print-toolbar__left">
          <a
            className="secondary-link-button"
            href={`/billing/cycles/${cycleId}`}
          >
            <ArrowLeftOutlined aria-hidden="true" /> {cycle.code} ({cycle.property.name})
          </a>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <span>Phòng in:</span>
            <select
              value={selectedInvoiceId}
              onChange={(e) => setSelectedInvoiceId(e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: "#fff",
                fontSize: 13
              }}
            >
              <option value="ALL">
                Tất cả các phòng ({data.invoices.length} phiếu thu)
              </option>
              {data.invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  Phòng {inv.room.code} · {inv.primaryResidentName} ({inv.number})
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <span>Định dạng:</span>
            <select
              value={printLayout}
              onChange={(e) =>
                setPrintLayout(e.target.value as typeof printLayout)
              }
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: "#fff",
                fontSize: 13
              }}
            >
              <option value="A4_FULL">Khổ A4 (1 phiếu / trang)</option>
              <option value="A5_COMPACT">Khổ A5 / Tiết kiệm (2 phiếu / trang)</option>
            </select>
          </label>
        </div>

        <div className="invoice-print-toolbar__right">
          <span style={{ fontSize: 12, color: "#64748b" }}>
            Khuyến nghị: Bật &quot;Background graphics&quot; khi in
          </span>
          <button
            className="primary-button"
            type="button"
            onClick={() => window.print()}
          >
            <PrinterOutlined style={{ marginRight: 6 }} /> In phiếu thu (Ctrl + P)
          </button>
        </div>
      </div>

      {invoicesToPrint.length === 0 ? (
        <div className="admin-state">
          <span>Không có hóa đơn nào phù hợp với bộ lọc đã chọn.</span>
        </div>
      ) : (
        <div className="invoice-print-container">
          {invoicesToPrint.map((invoice, index) => {
            const isLast = index === invoicesToPrint.length - 1;
            const vietQrUrl =
              paymentProfile && invoice.remainingVnd > 0
                ? `https://img.vietqr.io/image/${encodeURIComponent(
                    paymentProfile.bankId
                  )}-${encodeURIComponent(paymentProfile.accountNo)}-${encodeURIComponent(
                    paymentProfile.vietQrTemplate || "compact"
                  )}.png?amount=${invoice.remainingVnd}&addInfo=${encodeURIComponent(
                    invoice.paymentReference
                  )}&accountName=${encodeURIComponent(paymentProfile.accountName)}`
                : null;

            return (
              <article
                className={`rent-receipt-sheet ${printLayout === "A4_FULL" && !isLast ? "rent-receipt-sheet--pagebreak" : ""}`}
                key={invoice.id}
              >
                <header className="receipt-header">
                  <div className="receipt-header__org">
                    <h2 className="receipt-org-name">{organization.name}</h2>
                    <p className="receipt-property-name">
                      Cơ sở: <strong>{cycle.property.name}</strong> (Mã: {cycle.property.code})
                    </p>
                  </div>
                  <div className="receipt-header__meta">
                    <span className="receipt-number">Mã HĐ: {invoice.number}</span>
                    <span className="receipt-date">
                      Ngày lập: {formatDateVi(invoice.issuedAt ?? cycle.periodEnd)}
                    </span>
                  </div>
                </header>

                <div className="receipt-title-block">
                  <h1 className="receipt-title">GIẤY BÁO TIỀN PHÒNG &amp; DỊCH VỤ</h1>
                  <p className="receipt-period">
                    Kỳ thanh toán: {formatDateVi(cycle.periodStart)} – {formatDateVi(cycle.periodEnd)} · Hạn đóng:{" "}
                    <strong>{formatDateVi(cycle.dueDate)}</strong>
                  </p>
                </div>

                <div className="receipt-info-grid">
                  <div className="receipt-info-item">
                    <span className="receipt-info-label">Phòng:</span>
                    <strong className="receipt-info-val highlight-room">
                      {invoice.room.code}
                    </strong>
                  </div>
                  <div className="receipt-info-item">
                    <span className="receipt-info-label">Người thuê:</span>
                    <strong className="receipt-info-val">
                      {invoice.primaryResidentName || "—"}
                    </strong>
                  </div>
                  <div className="receipt-info-item">
                    <span className="receipt-info-label">Hợp đồng:</span>
                    <span className="receipt-info-val">{invoice.lease.code}</span>
                  </div>
                  <div className="receipt-info-item">
                    <span className="receipt-info-label">Trạng thái:</span>
                    <span
                      className={`receipt-badge receipt-badge--${invoice.collectionStatus.toLowerCase()}`}
                    >
                      {invoice.collectionStatus === "PAID"
                        ? "ĐÃ THANH TOÁN"
                        : invoice.collectionStatus === "PARTIALLY_PAID"
                        ? "THANH TOÁN MỘT PHẦN"
                        : "CHƯA THANH TOÁN"}
                    </span>
                  </div>
                </div>

                <table className="receipt-table">
                  <thead>
                    <tr>
                      <th style={{ width: "38px", textAlign: "center" }}>STT</th>
                      <th>Khoản mục chi phí</th>
                      <th style={{ width: "70px", textAlign: "right" }}>CS đầu</th>
                      <th style={{ width: "70px", textAlign: "right" }}>CS cuối</th>
                      <th style={{ width: "80px", textAlign: "right" }}>Số lượng</th>
                      <th style={{ width: "100px", textAlign: "right" }}>Đơn giá</th>
                      <th style={{ width: "120px", textAlign: "right" }}>Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.lines.map((line, lineIndex) => {
                      const snap = line.snapshot as MeterSnapshot | null | undefined;
                      const hasMeter = Boolean(snap?.meter);
                      const isPreviousDebt = line.type === "PREVIOUS_DEBT";

                      return (
                        <tr
                          key={line.id || lineIndex}
                          className={isPreviousDebt ? "row-previous-debt" : ""}
                        >
                          <td style={{ textAlign: "center" }}>{lineIndex + 1}</td>
                          <td>
                            <strong>{line.description}</strong>
                            {isPreviousDebt && (
                              <span className="debt-tag"> (Dư nợ các kỳ trước)</span>
                            )}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {hasMeter && snap?.meter?.previous != null
                              ? String(snap.meter.previous)
                              : "—"}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {hasMeter && snap?.meter?.current != null
                              ? String(snap.meter.current)
                              : "—"}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {isPreviousDebt ? "—" : line.quantity}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {isPreviousDebt ? "—" : formatVnd(line.unitPriceVnd)}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <strong>{formatVnd(line.amountVnd)}</strong>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={6} style={{ textAlign: "right", fontWeight: 600 }}>
                        Tổng cộng tiền phòng &amp; dịch vụ:
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>
                        {formatVnd(invoice.totalVnd)}
                      </td>
                    </tr>
                    {invoice.paidVnd > 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: "right", color: "#166534" }}>
                          Đã thanh toán:
                        </td>
                        <td style={{ textAlign: "right", color: "#166534", fontWeight: 600 }}>
                          - {formatVnd(invoice.paidVnd)}
                        </td>
                      </tr>
                    )}
                    <tr className="total-due-row">
                      <td colSpan={6} style={{ textAlign: "right" }}>
                        <strong>SỐ TIỀN CÒN PHẢI NỘP:</strong>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <strong className="total-due-amount">
                          {formatVnd(invoice.remainingVnd)}
                        </strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>

                <div className="receipt-footer-section">
                  <div className="receipt-bank-block">
                    {invoice.collectionStatus === "PAID" ? (
                      <div className="paid-stamp">
                        <span>ĐÃ THANH TOÁN ĐỦ</span>
                        <small>Cảm ơn quý khách!</small>
                      </div>
                    ) : paymentProfile ? (
                      <div className="payment-guide">
                        <div className="payment-guide-info">
                          <strong>THÔNG TIN CHUYỂN KHOẢN (24/7):</strong>
                          <p>Ngân hàng: <strong>{paymentProfile.bankId}</strong></p>
                          <p>Số tài khoản: <strong>{paymentProfile.accountNo}</strong></p>
                          <p>Chủ tài khoản: <strong>{paymentProfile.accountName}</strong></p>
                          <p>
                            Nội dung CK: <strong className="highlight-memo">{invoice.paymentReference}</strong>
                          </p>
                          <small style={{ color: "#64748b" }}>
                            * Vui lòng chuyển chính xác nội dung để hệ thống tự động gạch nợ.
                          </small>
                        </div>
                        {vietQrUrl && (
                          <div className="payment-guide-qr">
                            <img
                              src={vietQrUrl}
                              alt="Mã QR VietQR"
                              className="qr-img-mini"
                            />
                            <span style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>
                              Quét bằng App Ngân hàng
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="payment-guide">
                        <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                          Vui lòng thanh toán tiền phòng theo thỏa thuận với chủ nhà.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="receipt-signatures">
                    <div className="sig-col">
                      <span className="sig-title">Người nộp tiền</span>
                      <span className="sig-note">(Ký &amp; ghi rõ họ tên)</span>
                    </div>
                    <div className="sig-col">
                      <span className="sig-title">Người lập phiếu / Chủ nhà</span>
                      <span className="sig-note">(Ký &amp; ghi rõ họ tên)</span>
                    </div>
                  </div>
                </div>

                {printLayout === "A5_COMPACT" && !isLast && (
                  <div className="receipt-cut-line no-print">
                    <span>✂ ----------------- ĐƯỜNG XÉ CẮT PHIẾU ----------------- ✂</span>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
