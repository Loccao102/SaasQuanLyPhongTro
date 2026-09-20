import { MoneyDisplay, PageHeader, SectionHeader, StatusBadge } from "@propops/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "../../../../components/admin-shell";
import { findDemoLease } from "../../../../lib/demo-leases";

const steps = [
  { label: "Ngày hiệu lực", state: "complete" },
  { label: "Chốt điện / nước", state: "complete" },
  { label: "Công nợ cuối", state: "current" },
  { label: "Xử lý tiền cọc", state: "complete" },
  { label: "Kiểm tra & hoàn tất", state: "pending" }
] as const;

export default async function TerminateLeasePage({
  params
}: {
  params: Promise<{ leaseId: string }>;
}) {
  const { leaseId } = await params;
  const lease = findDemoLease(leaseId);

  if (!lease) {
    notFound();
  }

  return (
    <AdminShell title="Chấm dứt hợp đồng" activeNav="Hợp đồng">
      <PageHeader
        eyebrow={`${lease.code} · ${lease.property} · ${lease.room}`}
        title="Quy trình trả phòng"
        description="Đây là domain transition có ảnh hưởng lịch sử hợp đồng, công nợ, tiền cọc và trạng thái phòng. Không xóa hợp đồng cũ."
        action={<Link className="secondary-link-button" href={`/leases/${lease.id}`}>← Quay lại hợp đồng</Link>}
      />

      <section className="destructive-banner" aria-label="Ảnh hưởng khi chấm dứt hợp đồng">
        <div>
          <strong>Sau khi hoàn tất</strong>
          <p>Hợp đồng {lease.code} chuyển sang TERMINATED. Phòng {lease.room} trở thành sẵn sàng cho một hợp đồng mới; lịch sử người thuê và hóa đơn cũ được giữ nguyên.</p>
        </div>
        <StatusBadge tone="danger">HÀNH ĐỘNG NHẠY CẢM</StatusBadge>
      </section>

      <section className="termination-layout">
        <aside className="panel termination-steps">
          <SectionHeader title="Tiến trình" />
          <ol>
            {steps.map((step, index) => (
              <li className={`termination-step termination-step--${step.state}`} key={step.label}>
                <span className="termination-step__index">{index + 1}</span>
                <div><strong>{step.label}</strong><span>{step.state === "complete" ? "Đã sẵn sàng" : step.state === "current" ? "Cần xử lý" : "Chưa mở"}</span></div>
              </li>
            ))}
          </ol>
        </aside>

        <div className="termination-main">
          <article className="panel">
            <SectionHeader title="1. Ngày hiệu lực & lý do" action={<StatusBadge tone="success">ĐÃ XÁC ĐỊNH</StatusBadge>} />
            <dl className="detail-list">
              <div><dt>Ngày trả phòng hiệu lực</dt><dd>30/09/2026</dd></div>
              <div><dt>Lý do</dt><dd>Người thuê chuyển sang nơi ở mới</dd></div>
            </dl>
          </article>

          <article className="panel">
            <SectionHeader title="2–4. Readiness từ các module liên quan" />
            <div className="readiness-list">
              <div className="readiness-row">
                <div><strong>Chỉ số điện / nước cuối</strong><span>Metering sẽ giữ reading source-of-truth</span></div>
                <StatusBadge tone="success">READY</StatusBadge>
              </div>
              <div className="readiness-row">
                <div><strong>Công nợ cuối</strong><span>Còn hóa đơn / phí cuối kỳ cần xử lý</span></div>
                <StatusBadge tone="warning">PENDING</StatusBadge>
              </div>
              <div className="readiness-row">
                <div><strong>Tiền cọc</strong><span>Yêu cầu cọc theo HĐ: <MoneyDisplay amountVnd={lease.depositRequiredVnd} /></span></div>
                <StatusBadge tone="success">READY</StatusBadge>
              </div>
            </div>
          </article>

          <article className="panel review-panel">
            <SectionHeader title="5. Kiểm tra trước khi hoàn tất" />
            <ul className="consequence-list">
              <li>Hợp đồng hiện tại sẽ kết thúc hiệu lực ngày 30/09/2026.</li>
              <li>Phòng {lease.room} không còn bị lease này chiếm dụng và có thể tạo hợp đồng mới.</li>
              <li>Không xóa resident, lease, invoice hoặc lịch sử audit.</li>
              <li>Không thể hoàn tất khi bất kỳ readiness bắt buộc nào còn PENDING.</li>
            </ul>
            <div className="final-action">
              <div>
                <strong>Chưa thể hoàn tất</strong>
                <span>“Công nợ cuối” vẫn đang PENDING.</span>
              </div>
              <button className="danger-button" disabled>Hoàn tất chấm dứt hợp đồng</button>
            </div>
          </article>
        </div>
      </section>

      <p className="prototype-note">Workflow này phản ánh state machine thật nhưng chưa gửi mutation; auth/principal + transactional application service sẽ là bước backend kế tiếp.</p>
    </AdminShell>
  );
}
