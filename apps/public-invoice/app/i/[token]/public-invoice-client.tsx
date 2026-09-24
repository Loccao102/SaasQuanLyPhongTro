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

  const encodedToken = useMemo(() => encodeURIComponent(token), [token]);

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

        <footer className="invoice-footer">
          <span>{data.organizationName}</span>
          <span>{live ? "● Đang tự cập nhật thanh toán" : "Đang kết nối cập nhật…"}</span>
        </footer>
      </article>
    </main>
  );
}
