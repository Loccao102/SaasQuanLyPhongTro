import { MetricCard, ProgressBar, SectionHeader, StatusBadge } from "@propops/ui";
import Link from "next/link";
import { AdminShell } from "../components/admin-shell";

const areas = [
  { name: "Phường Thanh Xuân", rooms: 68, occupied: 63, progress: 97, debt: "18,4 tr" },
  { name: "Phường Hà Đông", rooms: 142, occupied: 131, progress: 91, debt: "31,7 tr" },
  { name: "Bắc Ninh", rooms: 421, occupied: 389, progress: 84, debt: "72,3 tr" }
];

const attention = [
  { label: "9 hợp đồng sắp hết hạn trong 30 ngày", tone: "warning" as const, href: "/leases" },
  { label: "17 phòng quá hạn thanh toán", tone: "danger" as const, href: "#" },
  { label: "2 thông báo cần xử lý lại", tone: "warning" as const, href: "#" }
];

export default function AdminDashboardPage() {
  return (
    <AdminShell
      title="Tổng quan vận hành"
      eyebrow="THỨ HAI · 21/09/2026"
      activeNav="Tổng quan"
    >
      <section className="metrics-grid" aria-label="Chỉ số tổng quan">
        <MetricCard label="Tổng số phòng" value="1.842" detail="+26 phòng trong 30 ngày" tone="info" />
        <MetricCard label="Tỷ lệ lấp đầy" value="92,1%" detail="1.697 phòng đang có hợp đồng" tone="success" />
        <MetricCard label="Đã thu kỳ này" value="1,20 tỷ" detail="86,4% tổng cần thu" tone="success" />
        <MetricCard label="Còn phải thu" value="184 tr" detail="17 phòng đã quá hạn" tone="warning" />
      </section>

      <section className="dashboard-grid">
        <article className="panel panel--cycle">
          <SectionHeader title="Kỳ chốt tháng 09/2026" action={<StatusBadge tone="info">ĐANG THỰC HIỆN</StatusBadge>} />
          <ProgressBar value={1680} max={1842} label="1.680 / 1.842 phòng đã chốt" />
          <div className="cycle-stats">
            <div><span>Chưa chốt</span><strong>162</strong></div>
            <div><span>Cảnh báo bất thường</span><strong>11</strong></div>
            <div><span>Nhân viên đang làm</span><strong>8</strong></div>
          </div>
          <button className="secondary-button">Xem tiến độ chi tiết</button>
        </article>

        <article className="panel">
          <SectionHeader title="Cần xử lý" action={<Link className="text-link" href="/leases">Xem hợp đồng</Link>} />
          <div className="attention-list">
            {attention.map((item) => (
              <Link href={item.href} className="attention-item" key={item.label}>
                <StatusBadge tone={item.tone}>!</StatusBadge><span>{item.label}</span><span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </article>
      </section>

      <section className="panel">
        <SectionHeader title="Theo khu vực" action={<button className="secondary-button secondary-button--compact">Quản lý tài sản</button>} />
        <div className="area-table" role="table" aria-label="Tình trạng vận hành theo khu vực">
          <div className="area-table__row area-table__head" role="row">
            <span role="columnheader">Khu vực</span><span role="columnheader">Phòng</span><span role="columnheader">Đang thuê</span><span role="columnheader">Chốt số</span><span role="columnheader">Còn nợ</span><span aria-hidden="true" />
          </div>
          {areas.map((area) => (
            <a className="area-table__row" href="#" role="row" key={area.name}>
              <strong role="cell">{area.name}</strong><span role="cell">{area.rooms}</span><span role="cell">{area.occupied}</span><span role="cell">{area.progress}%</span><span role="cell">{area.debt}</span><span role="cell" aria-hidden="true">→</span>
            </a>
          ))}
        </div>
      </section>

      <p className="prototype-note">Foundation UI dùng dữ liệu mẫu. Data thật, authentication và permission enforcement sẽ được nối ở các slice tiếp theo.</p>
    </AdminShell>
  );
}
