"use client";

import { useCallback, useEffect, useState } from "react";
import { MetricCard, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../../../components/admin-shell";
import {
  adminAssetsApi,
  type AdminRoomDetail
} from "../../../../lib/admin-assets-api";

function money(value: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(value);
}

export function RoomDetailClient({ roomId }: { roomId: string }) {
  const [data, setData] = useState<AdminRoomDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminAssetsApi.room(roomId));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không thể tải phòng."
      );
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminShell
      title={data ? data.room.code + " · " + data.room.name : "Chi tiết phòng"}
      eyebrow="TÀI SẢN · ROOM DETAIL"
      activeNav="Tài sản"
    >
      {data ? (
        <a
          className="back-link"
          href={"/assets/properties/" + data.property.id}
        >
          ← {data.property.name}
        </a>
      ) : (
        <a className="back-link" href="/assets">← Danh sách tài sản</a>
      )}

      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Không thể tải phòng.</strong>
          <span>{error}</span>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            Thử lại
          </button>
        </div>
      ) : loading || !data ? (
        <div className="admin-state">Đang tải phòng…</div>
      ) : (
        <>
          <section className="asset-context">
            <div>
              <span className="eyebrow">
                {data.property.code}
                {data.floor ? " · " + data.floor.code : ""}
              </span>
              <h2>{data.room.code} · {data.room.name}</h2>
              <p>
                {data.property.name}
                {data.floor?.name ? " · " + data.floor.name : " · Chưa gán tầng"}
              </p>
            </div>
            <StatusBadge tone={data.room.occupancy === "OCCUPIED" ? "success" : "warning"}>
              {data.room.occupancy === "OCCUPIED" ? "ĐANG THUÊ" : "TRỐNG"}
            </StatusBadge>
          </section>

          {data.currentLease ? (
            <>
              <section className="metrics-grid">
                <MetricCard
                  label="Tiền thuê"
                  value={money(data.currentLease.baseRentVnd)}
                  detail="Snapshot trên hợp đồng hiện tại"
                  tone="info"
                />
                <MetricCard
                  label="Tiền cọc yêu cầu"
                  value={money(data.currentLease.depositRequiredVnd)}
                  detail="Snapshot trên hợp đồng hiện tại"
                  tone="info"
                />
                <MetricCard
                  label="Bắt đầu"
                  value={data.currentLease.startDate ?? "—"}
                  detail={data.currentLease.code}
                  tone="success"
                />
                <MetricCard
                  label="Kết thúc dự kiến"
                  value={data.currentLease.plannedEndDate ?? "Chưa đặt"}
                  detail={data.currentLease.status}
                  tone="warning"
                />
              </section>

              <section className="panel">
                <div className="asset-section-heading">
                  <div>
                    <span className="eyebrow">CURRENT LEASE</span>
                    <h2>{data.currentLease.code}</h2>
                  </div>
                  <a
                    className="secondary-button secondary-button--link"
                    href={"/leases/" + data.currentLease.id}
                  >
                    Mở hợp đồng
                  </a>
                </div>

                <div className="detail-grid">
                  <div><span>Lease ID</span><strong>{data.currentLease.id}</strong></div>
                  <div><span>Trạng thái</span><strong>{data.currentLease.status}</strong></div>
                  <div><span>Ngày bắt đầu</span><strong>{data.currentLease.startDate ?? "—"}</strong></div>
                  <div><span>Ngày kết thúc dự kiến</span><strong>{data.currentLease.plannedEndDate ?? "—"}</strong></div>
                </div>
              </section>
            </>
          ) : (
            <section className="panel">
              <div className="empty-room-state">
                <StatusBadge tone="warning">PHÒNG TRỐNG</StatusBadge>
                <h2>Phòng chưa có hợp đồng hiện tại</h2>
                <p>
                  Room history không bị xoá. Bước tiếp theo sẽ nối workflow tạo
                  hợp đồng mới với kiểm tra conflict trước khi activate.
                </p>
                <a className="secondary-button secondary-button--link" href="/leases">
                  Xem danh sách hợp đồng
                </a>
              </div>
            </section>
          )}
        </>
      )}
    </AdminShell>
  );
}
