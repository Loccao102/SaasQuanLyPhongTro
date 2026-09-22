"use client";

import { useCallback, useEffect, useState } from "react";
import { MetricCard, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../components/admin-shell";
import {
  adminAssetsApi,
  type AdminAssetOverview
} from "../../lib/admin-assets-api";

function percent(occupied: number, total: number): string {
  if (total === 0) return "0%";
  return ((occupied / total) * 100).toLocaleString("vi-VN", {
    maximumFractionDigits: 1
  }) + "%";
}

export function AssetOverviewClient() {
  const [data, setData] = useState<AdminAssetOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminAssetsApi.overview());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không thể tải tài sản."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminShell
      title="Tài sản & phòng"
      eyebrow="ADMIN · LIVE DATA"
      activeNav="Tài sản"
    >
      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Không thể tải dữ liệu tài sản.</strong>
          <span>{error}</span>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            Thử lại
          </button>
        </div>
      ) : loading || !data ? (
        <div className="admin-state">Đang tải tài sản trong phạm vi được cấp…</div>
      ) : (
        <>
          <section className="asset-context">
            <div>
              <span className="eyebrow">WORKSPACE</span>
              <h2>{data.organization.name}</h2>
              <p>
                Hiển thị đúng property scope của membership hiện tại · {data.principal.role}
              </p>
            </div>
            <StatusBadge tone="success">POSTGRESQL LIVE</StatusBadge>
          </section>

          <section className="metrics-grid" aria-label="Tổng quan tài sản">
            <MetricCard
              label="Cơ sở"
              value={String(data.summary.propertyCount)}
              detail={String(data.summary.floorCount) + " tầng"}
              tone="info"
            />
            <MetricCard
              label="Phòng"
              value={String(data.summary.roomCount)}
              detail={String(data.summary.vacantRoomCount) + " phòng trống"}
              tone="info"
            />
            <MetricCard
              label="Đang có hợp đồng"
              value={String(data.summary.occupiedRoomCount)}
              detail={percent(data.summary.occupiedRoomCount, data.summary.roomCount) + " lấp đầy"}
              tone="success"
            />
            <MetricCard
              label="Phòng trống"
              value={String(data.summary.vacantRoomCount)}
              detail="Sẵn sàng cho hợp đồng mới"
              tone={data.summary.vacantRoomCount > 0 ? "warning" : "success"}
            />
          </section>

          <section className="panel">
            <div className="asset-section-heading">
              <div>
                <span className="eyebrow">PROPERTY DIRECTORY</span>
                <h2>Cơ sở trong phạm vi của bạn</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => void load()}>
                Refresh
              </button>
            </div>

            {data.properties.length === 0 ? (
              <div className="admin-state">
                <strong>Chưa có cơ sở nào trong phạm vi hiện tại.</strong>
                <span>
                  Nếu tổ chức đã có tài sản, kiểm tra membership scope hoặc quyền property.read.
                </span>
              </div>
            ) : (
              <div className="asset-grid">
                {data.properties.map((property) => (
                  <a
                    className="asset-card"
                    href={"/assets/properties/" + property.id}
                    key={property.id}
                  >
                    <div className="asset-card__heading">
                      <div>
                        <span className="asset-card__code">{property.code}</span>
                        <h3>{property.name}</h3>
                      </div>
                      <span aria-hidden="true">→</span>
                    </div>
                    <p>{property.address ?? property.administrativeArea ?? "Chưa cập nhật địa chỉ"}</p>
                    <div className="asset-card__stats">
                      <div><span>Tầng</span><strong>{property.floors}</strong></div>
                      <div><span>Phòng</span><strong>{property.rooms}</strong></div>
                      <div><span>Đang thuê</span><strong>{property.occupiedRooms}</strong></div>
                      <div><span>Trống</span><strong>{property.vacantRooms}</strong></div>
                    </div>
                    <div className="asset-card__footer">
                      <StatusBadge tone={property.vacantRooms > 0 ? "warning" : "success"}>
                        {percent(property.occupiedRooms, property.rooms)} lấp đầy
                      </StatusBadge>
                      <small>{property.type}</small>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </AdminShell>
  );
}
