"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ExclamationCircleOutlined,
  ReloadOutlined,
  RightOutlined
} from "@ant-design/icons";
import {
  MetricCard,
  ProgressBar,
  SectionHeader,
  StatusBadge
} from "@propops/ui";
import Link from "next/link";
import { AdminShell } from "../components/admin-shell";
import { useAdminAuth } from "../components/admin-auth-provider";
import {
  adminDashboardApi,
  type DashboardOverview
} from "../lib/admin-dashboard-api";

const integer = new Intl.NumberFormat("vi-VN");
const money = new Intl.NumberFormat("vi-VN", {
  notation: "compact",
  maximumFractionDigits: 1
});

function formatMoney(value: number | null): string {
  return value === null ? "—" : money.format(value) + " ₫";
}

function pageDate(): string {
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh"
  }).format(new Date()).toLocaleUpperCase("vi-VN");
}

export default function AdminDashboardPage() {
  const { selectedOrganizationId } = useAdminAuth();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrganizationId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await adminDashboardApi.overview();
      setData(result);
    } catch (reason) {
      setData(null);
      setError(
        reason instanceof Error
          ? reason.message
          : "Không thể tải dữ liệu vận hành."
      );
    } finally {
      setLoading(false);
    }
  }, [selectedOrganizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = data?.summary;
  const cycle = data?.billingProgress;
  const month = data?.monthLabel ?? "";
  const occupancy = summary && summary.roomCount > 0
    ? integer.format(Math.round(summary.occupiedRoomCount / summary.roomCount * 1000) / 10) + "%"
    : summary ? "0%" : "—";

  const items: Array<{
    label: string;
    href: string;
    tone: "warning" | "danger";
  }> = [];

  if (summary?.expiringLeases) {
    items.push({
      label: integer.format(summary.expiringLeases) +
        " hợp đồng sắp hết hạn trong 30 ngày",
      href: "/leases",
      tone: "warning"
    });
  }
  if (summary?.overdueRooms) {
    items.push({
      label: integer.format(summary.overdueRooms) +
        " phòng có hóa đơn quá hạn",
      href: "/billing",
      tone: "danger"
    });
  }
  if (cycle?.reviewInvoices) {
    items.push({
      label: integer.format(cycle.reviewInvoices) +
        " hóa đơn tháng này cần rà soát",
      href: "/billing",
      tone: "warning"
    });
  }
  if (summary?.failedNotifications) {
    items.push({
      label: integer.format(summary.failedNotifications) +
        " thông báo gửi lỗi hoặc cần kiểm tra",
      href: "/notifications",
      tone: "warning"
    });
  }

  return (
    <AdminShell
      title="Tổng quan vận hành"
      eyebrow={pageDate()}
      activeNav="Tổng quan"
      notificationCount={summary?.failedNotifications ?? null}
    >
      {error ? (
        <section className="panel" role="alert" style={{ marginBottom: 18 }}>
          <strong>Chưa tải được dữ liệu từ máy chủ.</strong>
          <p>{error}</p>
          <button className="secondary-button" onClick={() => void load()}>
            <ReloadOutlined /> Thử lại
          </button>
        </section>
      ) : null}

      {loading && !data ? (
        <section className="panel" aria-live="polite">
          Đang tải số liệu vận hành từ database…
        </section>
      ) : null}

      {data ? (
        <>
          <section className="metrics-grid" aria-label="Chỉ số vận hành thực tế">
            <MetricCard
              label="Tổng số phòng"
              value={integer.format(summary?.roomCount ?? 0)}
              detail={"+" + integer.format(summary?.newRoomsLast30Days ?? 0) + " phòng trong 30 ngày"}
              tone="info"
            />
            <MetricCard
              label="Tỷ lệ lấp đầy"
              value={occupancy}
              detail={integer.format(summary?.occupiedRoomCount ?? 0) + " phòng có hợp đồng hiệu lực"}
              tone="success"
            />
            <MetricCard
              label="Đã thu tháng này"
              value={formatMoney(summary?.collectedThisMonthVnd ?? null)}
              detail={summary?.collectedThisMonthVnd === null
                ? "Không có quyền xem giao dịch"
                : "Tiền đã phân bổ vào hóa đơn"}
              tone="success"
            />
            <MetricCard
              label="Còn phải thu"
              value={formatMoney(summary?.outstandingVnd ?? null)}
              detail={summary?.overdueRooms === null
                ? "Không có quyền xem hóa đơn"
                : integer.format(summary?.overdueRooms ?? 0) + " phòng có hóa đơn quá hạn"}
              tone="warning"
            />
          </section>

          <section className="dashboard-grid">
            <article className="panel panel--cycle">
              <SectionHeader
                title={"Tiến độ lập hóa đơn tháng " + month}
                action={
                  <StatusBadge tone="info">
                    {cycle?.billedRooms === null
                      ? "KHÔNG CÓ QUYỀN XEM"
                      : cycle?.totalOccupiedRooms === 0
                        ? "CHƯA CÓ PHÒNG ĐANG THUÊ"
                        : (cycle?.billedRooms ?? 0) >= (cycle?.totalOccupiedRooms ?? 0)
                          ? "ĐÃ HOÀN THÀNH"
                          : "ĐANG THỰC HIỆN"}
                  </StatusBadge>
                }
              />
              {cycle?.billedRooms === null ? (
                <p>Vai trò hiện tại không có quyền xem dữ liệu hóa đơn.</p>
              ) : (
                <>
                  <ProgressBar
                    value={cycle?.billedRooms ?? 0}
                    max={Math.max(1, cycle?.totalOccupiedRooms ?? 0)}
                    label={integer.format(cycle?.billedRooms ?? 0) + " / " +
                      integer.format(cycle?.totalOccupiedRooms ?? 0) +
                      " phòng đang thuê đã có hóa đơn tháng này"}
                  />
                  <div className="cycle-stats">
                    <div>
                      <span>Chưa lập hóa đơn</span>
                      <strong>{integer.format(Math.max(0,
                        (cycle?.totalOccupiedRooms ?? 0) - (cycle?.billedRooms ?? 0)))}</strong>
                    </div>
                    <div>
                      <span>Cần rà soát</span>
                      <strong>{integer.format(cycle?.reviewInvoices ?? 0)}</strong>
                    </div>
                    <div>
                      <span>Phòng quá hạn</span>
                      <strong>{integer.format(cycle?.overdueRooms ?? 0)}</strong>
                    </div>
                  </div>
                </>
              )}
              <Link className="secondary-button" href="/billing">
                Xem hóa đơn chi tiết
              </Link>
            </article>

            <article className="panel">
              <SectionHeader
                title="Cần xử lý"
                action={<Link className="text-link" href="/notifications">Xem thông báo</Link>}
              />
              <div className="attention-list">
                {items.length ? items.map((item) => (
                  <Link href={item.href} className="attention-item" key={item.label}>
                    <StatusBadge tone={item.tone}>
                      <ExclamationCircleOutlined aria-hidden="true" />
                    </StatusBadge>
                    <span>{item.label}</span>
                    <span aria-hidden="true"><RightOutlined /></span>
                  </Link>
                )) : (
                  <p style={{ padding: "12px 0", color: "var(--color-muted, #64748b)" }}>
                    Chưa có cảnh báo từ các dữ liệu bạn được phép xem.
                  </p>
                )}
              </div>
            </article>
          </section>

          <section className="panel">
            <SectionHeader
              title="Theo cơ sở"
              action={<Link className="secondary-button secondary-button--compact" href="/assets">
                Quản lý tài sản
              </Link>}
            />
            {data.properties.length ? (
              <div className="area-table" role="table" aria-label="Tình trạng vận hành theo cơ sở">
                <div className="area-table__row area-table__head" role="row">
                  <span role="columnheader">Cơ sở</span>
                  <span role="columnheader">Phòng</span>
                  <span role="columnheader">Đang thuê</span>
                  <span role="columnheader">Đã lập HĐ tháng</span>
                  <span role="columnheader">Còn phải thu</span>
                  <span aria-hidden="true" />
                </div>
                {data.properties.map((property) => (
                  <Link className="area-table__row" href="/assets" role="row" key={property.id}>
                    <strong role="cell" title={property.administrativeArea ?? undefined}>
                      {property.name}
                    </strong>
                    <span role="cell">{integer.format(property.rooms)}</span>
                    <span role="cell">{integer.format(property.occupiedRooms)}</span>
                    <span role="cell">
                      {property.billedRooms === null ? "—" :
                        integer.format(property.billedRooms) + " / " +
                        integer.format(property.occupiedRooms)}
                    </span>
                    <span role="cell">{formatMoney(property.outstandingVnd)}</span>
                    <span role="cell" aria-hidden="true"><RightOutlined /></span>
                  </Link>
                ))}
              </div>
            ) : (
              <div style={{ padding: "12px 0 8px" }}>
                <p>Workspace hiện chưa có cơ sở hoặc phòng nào được tạo.</p>
                <Link className="secondary-button" href="/assets">
                  Thêm cơ sở đầu tiên <RightOutlined />
                </Link>
              </div>
            )}
          </section>

          <p className="prototype-note">
            Số liệu lấy từ database của tenant hiện tại. Doanh thu là khoản phân bổ
            cho hóa đơn từ giao dịch đã ghi nhận trong tháng; công nợ chỉ tính
            hóa đơn đã phát hành. Trang tự cập nhật khi tải lại.
          </p>
        </>
      ) : null}
    </AdminShell>
  );
}
