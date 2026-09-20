import { StatusBadge } from "@propops/ui";

const lines = [
  ["Tiền phòng", "3.500.000đ"],
  ["Điện · 78 kWh", "327.600đ"],
  ["Nước · 8 m³", "120.000đ"],
  ["Dịch vụ", "80.000đ"]
];

export default function PublicInvoicePage() {
  return (
    <main className="invoice-page">
      <article className="invoice-card">
        <header className="invoice-header">
          <div><span className="invoice-kicker">PHÒNG P201 · NGUYỄN TRÃI 1</span><h1>Hóa đơn tháng 09/2026</h1></div>
          <StatusBadge tone="warning">CHƯA THANH TOÁN</StatusBadge>
        </header>
        <section className="amount-block" aria-label="Số tiền cần thanh toán">
          <span>Cần thanh toán</span><strong>4.027.600đ</strong><small>Hạn thanh toán 05/10/2026</small>
        </section>
        <section className="invoice-lines" aria-label="Chi tiết hóa đơn">
          {lines.map(([label, amount]) => <div className="invoice-line" key={label}><span>{label}</span><strong>{amount}</strong></div>)}
          <div className="invoice-line invoice-line--total"><span>Tổng cộng</span><strong>4.027.600đ</strong></div>
        </section>
        <section className="payment-box">
          <div className="qr-placeholder" aria-label="Vị trí mã VietQR"><span>VIETQR</span></div>
          <div className="payment-copy"><span className="invoice-kicker">THANH TOÁN NHANH</span><h2>Quét QR hoặc mở ứng dụng ngân hàng</h2><p>Số tiền và nội dung chuyển khoản sẽ được điền sẵn ở bước tích hợp thanh toán.</p></div>
        </section>
        <button className="pay-button">Mở app ngân hàng</button>
        <p className="security-note">Trang mẫu chưa thực hiện giao dịch thật. Public token, VietQR động và trạng thái realtime sẽ được nối trong Billing/Payments slice.</p>
      </article>
    </main>
  );
}
