"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
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
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  async function mutate(action: () => Promise<unknown>) {
    setSaving(true);
    setMutationError(null);
    try {
      await action();
      await load();
    } catch (mutation) {
      setMutationError(
        mutation instanceof Error ? mutation.message : "Không thể lưu thay đổi."
      );
    } finally {
      setSaving(false);
    }
  }

  function submitProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate(() =>
      adminAssetsApi.updateProperty(propertyId, {
        code: String(form.get("code") ?? ""),
        name: String(form.get("name") ?? ""),
        propertyType: String(form.get("propertyType") ?? "BOARDING_HOUSE") as
          | "BOARDING_HOUSE"
          | "MINI_APARTMENT"
          | "APARTMENT"
          | "OTHER",
        addressText: String(form.get("addressText") ?? "") || null
      })
    );
  }

  function submitFloor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate(async () => {
      await adminAssetsApi.createFloor(propertyId, {
        id: crypto.randomUUID(),
        code: String(form.get("code") ?? ""),
        name: String(form.get("name") ?? ""),
        sortOrder: Number(form.get("sortOrder") ?? 0)
      });
      event.currentTarget.reset();
    });
  }

  function submitRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate(async () => {
      await adminAssetsApi.createRoom(propertyId, {
        id: crypto.randomUUID(),
        floorId: String(form.get("floorId") ?? "") || null,
        code: String(form.get("code") ?? ""),
        name: String(form.get("name") ?? ""),
        sortOrder: Number(form.get("sortOrder") ?? 0)
      });
      event.currentTarget.reset();
    });
  }

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
            <MetricCard label="Tầng" value={String(data.property.floors)} detail="Đang hoạt động" tone="info" />
            <MetricCard label="Phòng" value={String(data.property.rooms)} detail="Đang hoạt động" tone="info" />
            <MetricCard label="Đang thuê" value={String(data.property.occupiedRooms)} detail="Có hợp đồng hiện tại" tone="success" />
            <MetricCard label="Phòng trống" value={String(data.property.vacantRooms)} detail="Có thể tạo hợp đồng mới" tone={data.property.vacantRooms > 0 ? "warning" : "success"} />
          </section>

          {mutationError ? (
            <div className="admin-state admin-state--error">
              <strong>Không thể lưu thay đổi.</strong>
              <span>{mutationError}</span>
            </div>
          ) : null}

          <section className="asset-management-grid">
            <div className="panel">
              <div className="asset-section-heading">
                <div>
                  <span className="eyebrow">PROPERTY.MANAGE</span>
                  <h2>Thông tin cơ sở</h2>
                </div>
              </div>
              <form className="asset-form" onSubmit={submitProperty}>
                <label>
                  <span>Mã</span>
                  <input name="code" defaultValue={data.property.code} required />
                </label>
                <label>
                  <span>Tên</span>
                  <input name="name" defaultValue={data.property.name} required />
                </label>
                <label>
                  <span>Loại</span>
                  <select name="propertyType" defaultValue={data.property.type}>
                    <option value="BOARDING_HOUSE">Nhà trọ</option>
                    <option value="MINI_APARTMENT">Chung cư mini</option>
                    <option value="APARTMENT">Căn hộ</option>
                    <option value="OTHER">Khác</option>
                  </select>
                </label>
                <label className="asset-form__wide">
                  <span>Địa chỉ</span>
                  <input name="addressText" defaultValue={data.property.address ?? ""} />
                </label>
                <div className="button-row asset-form__wide">
                  <button className="primary-button" type="submit" disabled={saving}>
                    Lưu cơ sở
                  </button>
                </div>
              </form>
            </div>

            <div className="panel">
              <div className="asset-section-heading">
                <div>
                  <span className="eyebrow">FLOOR</span>
                  <h2>Thêm tầng</h2>
                </div>
              </div>
              <form className="asset-form asset-form--single" onSubmit={submitFloor}>
                <label><span>Mã tầng</span><input name="code" required placeholder="T1" /></label>
                <label><span>Tên tầng</span><input name="name" required placeholder="Tầng 1" /></label>
                <label><span>Thứ tự</span><input name="sortOrder" type="number" defaultValue="0" /></label>
                <div className="button-row asset-form__wide">
                  <button className="primary-button" type="submit" disabled={saving}>+ Thêm tầng</button>
                </div>
              </form>
            </div>

            <div className="panel asset-management-grid__wide">
              <div className="asset-section-heading">
                <div>
                  <span className="eyebrow">ROOM · QUOTA ENFORCED</span>
                  <h2>Thêm phòng</h2>
                </div>
              </div>
              <form className="asset-form" onSubmit={submitRoom}>
                <label>
                  <span>Tầng</span>
                  <select name="floorId" defaultValue="">
                    <option value="">Chưa gán tầng</option>
                    {data.floors.filter((floor) => floor.id).map((floor) => (
                      <option key={floor.id!} value={floor.id!}>
                        {floor.code} · {floor.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label><span>Mã phòng</span><input name="code" required placeholder="101" /></label>
                <label><span>Tên phòng</span><input name="name" required placeholder="Phòng 101" /></label>
                <label><span>Thứ tự</span><input name="sortOrder" type="number" defaultValue="0" /></label>
                <div className="button-row asset-form__wide">
                  <button className="primary-button" type="submit" disabled={saving}>+ Thêm phòng</button>
                </div>
              </form>
            </div>
          </section>

          {data.floors.length === 0 ? (
            <div className="admin-state">
              <strong>Chưa có phòng trong cơ sở này.</strong>
              <span>Tạo tầng và phòng ở khu vực quản lý phía trên.</span>
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
                    <div className="button-row">
                      <span className="panel-meta">{floor.rooms.length} phòng</span>
                      {floor.id && floor.rooms.length === 0 ? (
                        <button
                          className="danger-button"
                          type="button"
                          disabled={saving}
                          onClick={() => void mutate(() => adminAssetsApi.deactivateFloor(floor.id!))}
                        >
                          Ngưng tầng
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {floor.id ? (
                    <form
                      className="asset-inline-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        void mutate(() =>
                          adminAssetsApi.updateFloor(floor.id!, {
                            code: String(form.get("code") ?? ""),
                            name: String(form.get("name") ?? ""),
                            sortOrder: Number(form.get("sortOrder") ?? 0)
                          })
                        );
                      }}
                    >
                      <input name="code" defaultValue={floor.code} aria-label="Mã tầng" />
                      <input name="name" defaultValue={floor.name} aria-label="Tên tầng" />
                      <input name="sortOrder" type="number" defaultValue={floor.sortOrder} aria-label="Thứ tự tầng" />
                      <button className="secondary-button" type="submit" disabled={saving}>Lưu tầng</button>
                    </form>
                  ) : null}

                  <div className="room-grid">
                    {floor.rooms.map((room) => (
                      <a className="room-card" href={"/assets/rooms/" + room.id} key={room.id}>
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

          {data.property.floors === 0 && data.property.rooms === 0 ? (
            <section className="destructive-banner">
              <div>
                <strong>Ngưng cơ sở</strong>
                <p>Chỉ cho phép khi không còn tầng hoặc phòng hoạt động.</p>
              </div>
              <button
                className="danger-button"
                type="button"
                disabled={saving}
                onClick={() =>
                  void mutate(async () => {
                    await adminAssetsApi.deactivateProperty(propertyId);
                    window.location.assign("/assets");
                  })
                }
              >
                Ngưng cơ sở
              </button>
            </section>
          ) : null}
        </>
      )}
    </AdminShell>
  );
}
