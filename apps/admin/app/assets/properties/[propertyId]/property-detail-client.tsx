"use client";

import { useCallback, useEffect, useState } from "react";
import { MetricCard, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../../../components/admin-shell";
import {
  adminAssetsApi,
  type AdminPropertyDetail
} from "../../../../lib/admin-assets-api";

function occupancyTone(value: "OCCUPIED" | "VACANT") {
  return value === "OCCUPIED" ? "success" as const : "warning" as const;
}

export function PropertyDetailClient({
  propertyId
}: {
  propertyId: string;
}) {
  const [data, setData] = useState<AdminPropertyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminAssetsApi.property(propertyId));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không thể tải cơ sở."
      );
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminShell
      title={data?.property.name ?? "Chi tiết cơ sở"}
      eyebrow="TÀI SẢN · PROPERTY DETAIL"
      activeNav="Tài sản"
    >
      <a className="back-link" href="/assets">← Danh sách tài sản</a>

      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Không thể tải cơ sở.</strong>
          <span>{error}</span>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            Thử lại
          </button>
        </div>
      ) : loading || !data ? (
        <div className="admin-state">Đang tải cơ sở và phòng…</div>
      ) : (
        <>
          <section className="asset-context">
            <div>
              <span className="eyebrow">{data.property.code}</span>
              <h2>{data.property.name}</h2>
              <p>
                {data.property.address ??
                  data.property.administrativeArea ??
                  "Chưa cập nhật địa chỉ"}
              </p>
            </div>
            <StatusBadge tone="info">{data.property.type}</StatusBadge>
          </section>

          <section className="metrics-grid" aria-label="Tình trạng cơ sở">
            <MetricCard
              label="Tầng"
              value={String(data.property.floors)}
              detail="Đang hoạt động"
              tone="info"
            />
            <MetricCard
              label="Phòng"
              value={String(data.property.rooms)}
              detail="Đang hoạt động"
              tone="info"
            />
            <MetricCard
              label="Đang thuê"
              value={String(data.property.occupiedRooms)}
              detail="Có hợp đồng hiện tại"
              tone="success"
            />
            <MetricCard
              label="Phòng trống"
              value={String(data.property.vacantRooms)}
              detail="Có thể tạo hợp đồng mới"
              tone={data.property.vacantRooms > 0 ? "warning" : "success"}
            />
          </section>

          {data.floors.length === 0 ? (
            <div className="admin-state">
              <strong>Chưa có phòng trong cơ sở này.</strong>
              <span>
                Slice hiện tại là read-only; chức năng tạo tầng/phòng sẽ dùng
                property.manage ở bước tiếp theo.
              </span>
            </div>
          ) : (
            <div className="floor-stack">
              {data.floors.map((floor) => (
                <section className="panel floor-panel" key={floor.id ?? "no-floor"}>
                  <div className="asset-section-heading">
                    <div>
                      <span className="eyebrow">{floor.code}</span>
                      <h2>{floor.name}</h2>
                    </div>
                    <span className="panel-meta">
                      {floor.rooms.length} phòng
                    </span>
                  </div>

                  <div className="room-grid">
                    {floor.rooms.map((room) => (
                      <a
                        className="room-card"
                        href={"/assets/rooms/" + room.id}
                        key={room.id}
                      >
                        <div className="room-card__heading">
                          <div>
                            <span>{room.code}</span>
                            <strong>{room.name}</strong>
                          </div>
                          <StatusBadge tone={occupancyTone(room.occupancy)}>
                            {room.occupancy === "OCCUPIED" ? "ĐANG THUÊ" : "TRỐNG"}
                          </StatusBadge>
                        </div>
                        {room.lease ? (
                          <div className="room-card__lease">
                            <span>Hợp đồng hiện tại</span>
                            <strong>{room.lease.code}</strong>
                            <small>{room.lease.status}</small>
                          </div>
                        ) : (
                          <div className="room-card__lease">
                            <span>Hợp đồng hiện tại</span>
                            <strong>Chưa có</strong>
                            <small>Sẵn sàng tạo hợp đồng mới</small>
                          </div>
                        )}
                      </a>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </AdminShell>
  );
}
