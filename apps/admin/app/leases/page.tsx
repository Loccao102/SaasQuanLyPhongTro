import { MetricCard, MoneyDisplay, PageHeader, StatusBadge } from "@propops/ui";
import Link from "next/link";
import { AdminShell } from "../../components/admin-shell";
import { demoLeases, type DemoLeaseStatus } from "../../lib/demo-leases";

function statusMeta(status: DemoLeaseStatus) {
  switch (status) {
    case "ACTIVE":
      return { label: "ĐANG HIỆU LỰC", tone: "success" as const };
    case "TERMINATION_SCHEDULED":
      return { label: "ĐÃ LÊN LỊCH TRẢ", tone: "warning" as const };
    case "DRAFT":
      return { label: "BẢN NHÁP", tone: "neutral" as const };
    case "TERMINATED":
      return { label: "ĐÃ KẾT THÚC", tone: "neutral" as const };
  }
}

export default function LeasesPage() {
  return (
    <AdminShell title="Hợp đồng" activeNav="Hợp đồng">
      <PageHeader
        eyebrow="RESIDENTS & LEASES"
        title="Quản lý hợp đồng thuê"
        description="Theo dõi hợp đồng hiện tại, lịch sử người thuê và các trường hợp sắp hết hạn hoặc đang chấm dứt."
        action={<button className="primary-button" disabled title="Sẽ nối secure write API ở slice tiếp theo">+ Tạo hợp đồng</button>}
      />

      <section className="metrics-grid" aria-label="Tình trạng hợp đồng">
        <MetricCard label="Đang hiệu lực" value="1.697" detail="Chiếm dụng phòng hiện tại" tone="success" />
        <MetricCard label="Sắp hết hạn 30 ngày" value="9" detail="Cần gia hạn hoặc xác nhận trả phòng" tone="warning" />
        <MetricCard label="Đã lên lịch trả" value="4" detail="Đang chờ các bước quyết toán" tone="warning" />
        <MetricCard label="Bản nháp" value="5" detail="Chưa kích hoạt / chưa chiếm phòng" tone="neutral" />
      </section>

      <section className="panel">
        <div className="lease-toolbar">
          <div className="lease-search">
            <label htmlFor="lease-search">Tìm hợp đồng</label>
            <input id="lease-search" placeholder="Mã HĐ, phòng hoặc người thuê" />
          </div>
          <label className="compact-field">
            <span>Trạng thái</span>
            <select defaultValue="CURRENT">
              <option value="CURRENT">Đang hiện hành</option>
              <option value="ACTIVE">Đang hiệu lực</option>
              <option value="TERMINATION_SCHEDULED">Đã lên lịch trả</option>
              <option value="DRAFT">Bản nháp</option>
              <option value="ALL">Tất cả</option>
            </select>
          </label>
          <label className="compact-field">
            <span>Cơ sở</span>
            <select defaultValue="ALL">
              <option value="ALL">Tất cả cơ sở</option>
              <option>Nguyễn Trãi 1</option>
              <option>Hà Đông 2</option>
              <option>Bắc Ninh 4</option>
            </select>
          </label>
        </div>

        <div className="lease-table" role="table" aria-label="Danh sách hợp đồng">
          <div className="lease-table__row lease-table__head" role="row">
            <span role="columnheader">Hợp đồng</span>
            <span role="columnheader">Phòng</span>
            <span role="columnheader">Người thuê chính</span>
            <span role="columnheader">Thời hạn</span>
            <span role="columnheader">Tiền phòng</span>
            <span role="columnheader">Trạng thái</span>
            <span aria-hidden="true" />
          </div>

          {demoLeases.map((lease) => {
            const meta = statusMeta(lease.status);

            return (
              <Link className="lease-table__row" href={`/leases/${lease.id}`} role="row" key={lease.id}>
                <span role="cell"><strong>{lease.code}</strong><small>{lease.property}</small></span>
                <strong role="cell">{lease.room}</strong>
                <span role="cell"><strong>{lease.primaryTenant}</strong><small>{lease.phone}</small></span>
                <span role="cell"><strong>{lease.startDate}</strong><small>đến {lease.plannedEndDate ?? "Không thời hạn"}</small></span>
                <strong role="cell"><MoneyDisplay amountVnd={lease.baseRentVnd} /></strong>
                <span role="cell"><StatusBadge tone={meta.tone}>{meta.label}</StatusBadge></span>
                <span role="cell" aria-hidden="true">→</span>
              </Link>
            );
          })}
        </div>
      </section>

      <p className="prototype-note">UI hiện dùng dữ liệu mẫu. Nút tạo mới được khóa cho tới khi secure mutation API và principal context được nối.</p>
    </AdminShell>
  );
}
