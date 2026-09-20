import { MoneyDisplay, PageHeader, SectionHeader, StatusBadge } from "@propops/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "../../../components/admin-shell";
import { findDemoLease } from "../../../lib/demo-leases";

export default async function LeaseDetailPage({
  params
}: {
  params: Promise<{ leaseId: string }>;
}) {
  const { leaseId } = await params;
  const lease = findDemoLease(leaseId);

  if (!lease) {
    notFound();
  }

  const terminationScheduled = lease.status === "TERMINATION_SCHEDULED";

  return (
    <AdminShell title={`Hợp đồng ${lease.code}`} activeNav="Hợp đồng">
      <PageHeader
        eyebrow={`${lease.property} · PHÒNG ${lease.room}`}
        title={lease.primaryTenant}
        description="Chi tiết hợp đồng được giữ theo lịch sử. Việc người thuê chuyển đi sẽ chấm dứt hợp đồng này, không sửa Room thành một tenant mới."
        action={
          <div className="button-row">
            <Link className="secondary-link-button" href="/leases">← Danh sách</Link>
            {!terminationScheduled && lease.status === "ACTIVE" ? (
              <Link className="danger-link-button" href={`/leases/${lease.id}/terminate`}>Chấm dứt hợp đồng</Link>
            ) : null}
          </div>
        }
      />

      <section className="lease-detail-grid">
        <article className="panel">
          <SectionHeader
            title="Thông tin hợp đồng"
            action={
              lease.status === "ACTIVE"
                ? <StatusBadge tone="success">ĐANG HIỆU LỰC</StatusBadge>
                : lease.status === "TERMINATION_SCHEDULED"
                  ? <StatusBadge tone="warning">ĐÃ LÊN LỊCH TRẢ</StatusBadge>
                  : <StatusBadge>{lease.status}</StatusBadge>
            }
          />

          <dl className="detail-list">
            <div><dt>Mã hợp đồng</dt><dd>{lease.code}</dd></div>
            <div><dt>Cơ sở / phòng</dt><dd>{lease.property} · {lease.room}</dd></div>
            <div><dt>Ngày bắt đầu</dt><dd>{lease.startDate}</dd></div>
            <div><dt>Ngày kết thúc dự kiến</dt><dd>{lease.plannedEndDate ?? "Không thời hạn"}</dd></div>
            <div><dt>Ngày chốt hàng tháng</dt><dd>Ngày {lease.billingDay}</dd></div>
          </dl>
        </article>

        <article className="panel">
          <SectionHeader title="Điều khoản tiền" />
          <dl className="detail-list">
            <div><dt>Tiền phòng cơ bản</dt><dd><MoneyDisplay amountVnd={lease.baseRentVnd} /> / tháng</dd></div>
            <div><dt>Tiền cọc yêu cầu</dt><dd><MoneyDisplay amountVnd={lease.depositRequiredVnd} /></dd></div>
            <div><dt>Trạng thái cọc thực tế</dt><dd><StatusBadge tone="neutral">CHƯA NỐI PAYMENT</StatusBadge></dd></div>
          </dl>
          <p className="inline-note">Lease chỉ giữ điều khoản hợp đồng. Thu/hoàn/khấu trừ cọc thực tế sẽ thuộc Payment/Settlement và được audit riêng.</p>
        </article>
      </section>

      <section className="panel">
        <SectionHeader title="Người ở / bên thuê" action={<span className="scope-label">lease.manage · property scope</span>} />
        <div className="resident-row">
          <div className="resident-avatar">NM</div>
          <div><strong>{lease.primaryTenant}</strong><span>{lease.phone}</span></div>
          <StatusBadge tone="info">NGƯỜI THUÊ CHÍNH</StatusBadge>
        </div>
      </section>

      <section className="panel">
        <SectionHeader title="Lịch sử hợp đồng" />
        <ol className="timeline">
          <li><span className="timeline__dot" /><div><strong>Kích hoạt hợp đồng</strong><span>{lease.startDate} · Lease trở thành trạng thái ACTIVE</span></div></li>
          <li><span className="timeline__dot timeline__dot--muted" /><div><strong>Các event tiếp theo sẽ xuất hiện tại đây</strong><span>Gia hạn, thay đổi bên thuê, lên lịch trả phòng, hoàn tất chấm dứt…</span></div></li>
        </ol>
      </section>

      <p className="prototype-note">Detail screen đang dùng demo data; domain lifecycle và database constraints phía backend đã là code thật.</p>
    </AdminShell>
  );
}
