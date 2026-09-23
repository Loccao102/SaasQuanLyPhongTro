"use client";

import { useCallback, useEffect, useState } from "react";
import { ProgressBar, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../components/admin-shell";
import {
  meteringProgressApi,
  type MeteringProgressResponse
} from "../../lib/metering-progress-api";

function todayIso() {
  const now = new Date();
  return (
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0")
  );
}

export function MeteringProgressClient() {
  const [readingDate, setReadingDate] = useState(todayIso);
  const [data, setData] = useState<MeteringProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      setData(await meteringProgressApi.load(date));
    } catch (loadError) {
      setData(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không thể tải tiến độ chốt số."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(readingDate);
  }, [load, readingDate]);

  return (
    <AdminShell
      title="Tiến độ chốt số"
      eyebrow="METERING · LIVE PROGRESS"
      activeNav="Chốt số"
    >
      <section className="asset-context">
        <div>
          <span className="eyebrow">METER.READ</span>
          <h2>{data?.organization.name ?? "Chốt điện nước"}</h2>
          <p>
            Theo dõi số phòng đã có đủ chỉ số điện/nước cho ngày chốt trong
            phạm vi membership hiện tại.
          </p>
        </div>
        <label className="metering-date-filter">
          <span>Ngày chốt</span>
          <input
            type="date"
            value={readingDate}
            onChange={(event) => setReadingDate(event.target.value)}
          />
        </label>
      </section>

      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Không thể tải tiến độ.</strong>
          <span>{error}</span>
        </div>
      ) : loading ? (
        <div className="admin-state">Đang tải tiến độ chốt số…</div>
      ) : !data || data.properties.length === 0 ? (
        <div className="admin-state">
          <strong>Không có cơ sở trong scope hiện tại.</strong>
          <span>Kiểm tra membership scope hoặc cấu hình tài sản.</span>
        </div>
      ) : (
        <>
          <section className="billing-cycle-card__stats">
            <div>
              <span>Phòng</span>
              <strong>{data.summary.roomCount}</strong>
            </div>
            <div>
              <span>Đã chốt</span>
              <strong>{data.summary.completedRoomCount}</strong>
            </div>
            <div>
              <span>Còn lại</span>
              <strong>{data.summary.pendingRoomCount}</strong>
            </div>
            <div>
              <span>Thiếu meter</span>
              <strong>{data.summary.missingMeterRoomCount}</strong>
            </div>
          </section>

          <section className="panel">
            <div className="asset-section-heading">
              <div>
                <span className="eyebrow">PROPERTY PROGRESS</span>
                <h2>Tiến độ theo cơ sở</h2>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void load(readingDate)}
              >
                Refresh
              </button>
            </div>

            <div className="billing-cycle-list">
              {data.properties.map((property) => (
                <article className="billing-cycle-card" key={property.id}>
                  <div className="billing-cycle-card__heading">
                    <div>
                      <span className="eyebrow">{property.code}</span>
                      <h3>{property.name}</h3>
                      <p>
                        {property.completedRoomCount}/{property.roomCount} phòng
                        đã đủ điện + nước.
                      </p>
                    </div>
                    <StatusBadge
                      tone={
                        property.pendingRoomCount === 0
                          ? "success"
                          : property.missingMeterRoomCount > 0
                            ? "warning"
                            : "info"
                      }
                    >
                      {property.pendingRoomCount === 0
                        ? "HOÀN TẤT"
                        : property.missingMeterRoomCount > 0
                          ? "CẦN CẤU HÌNH"
                          : "ĐANG CHỐT"}
                    </StatusBadge>
                  </div>

                  <ProgressBar
                    value={property.completedRoomCount}
                    max={property.roomCount}
                    label={
                      property.completedRoomCount +
                      " / " +
                      property.roomCount +
                      " phòng"
                    }
                  />
                  {property.missingMeterRoomCount > 0 ? (
                    <p className="inline-note">
                      {property.missingMeterRoomCount} phòng chưa đủ đồng hồ điện
                      và nước đang hoạt động.
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      <p className="inline-note">
        Baseline hiện dùng membership scope làm phạm vi giao việc cho Staff.
        Dedicated StaffAssignment chỉ cần thêm khi cần lịch ca/điều phối tách khỏi
        quyền truy cập.
      </p>
    </AdminShell>
  );
}
