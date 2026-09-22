"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent
} from "react";
import { MetricCard, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../../../components/admin-shell";
import {
  adminAssetsApi,
  type AdminPropertyDetail
} from "../../../../lib/admin-assets-api";

type CreateMode = "floor" | "room" | null;

function occupancyTone(value: "OCCUPIED" | "VACANT") {
  return value === "OCCUPIED" ? "success" as const : "warning" as const;
}

export function PropertyDetailClient({ propertyId }: { propertyId: string }) {
  const [data, setData] = useState<AdminPropertyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationNotice, setMutationNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminAssetsApi.property(propertyId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải cơ sở.");
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { void load(); }, [load]);

  function chooseMode(mode: CreateMode) {
    setCreateMode(mode);
    setMutationError(null);
    setMutationNotice(null);
  }

  async function createFloor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setSaving(true);
    setMutationError(null);
    try {
      await adminAssetsApi.createFloor(propertyId, {
        floorId: crypto.randomUUID(),
        code: String(values.get("code") ?? ""),
        name: String(values.get("name") ?? ""),
        sortOrder: Number(values.get("sortOrder") ?? 0)
      });
      form.reset();
      setCreateMode(null);
      setMutationNotice("Đã tạo tầng. Tầng trống vẫn được hiển thị để tiếp tục thêm phòng.");
      await load();
    } catch (createError) {
      setMutationError(createError instanceof Error ? createError.message : "Không thể tạo tầng.");
    } finally {
      setSaving(false);
    }
  }

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setSaving(true);
    setMutationError(null);
    try {
      await adminAssetsApi.createRoom(propertyId, {
        roomId: crypto.randomUUID(),
        floorId: String(values.get("floorId") ?? "").trim() || null,
        code: String(values.get("code") ?? ""),
        name: String(values.get("name") ?? ""),
        sortOrder: Number(values.get("sortOrder") ?? 0)
      });
      form.reset();
      setCreateMode(null);
      setMutationNotice("Đã tạo phòng và cập nhật room usage theo gói hiện tại.");
      await load();
    } catch (createError) {
      setMutationError(createError instanceof Error ? createError.message : "Không thể tạo phòng.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell title={data?.property.name ?? "Chi tiết cơ sở"} eyebrow="TÀI SẢN · PROPERTY DETAIL" activeNav="Tài sản">
      <a className="back-link" href="/assets">← Danh sách tài sản</a>

      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Không thể tải cơ sở.</strong><span>{error}</span>
          <button className="secondary-button" type="button" onClick={() => void load()}>Thử lại</button>
        </div>
      ) : loading || !data ? (
        <div className="admin-state">Đang tải cơ sở và phòng…</div>
      ) : (
        <>
          <section className="asset-context">
            <div>
              <span className="eyebrow">{data.property.code}</span>
              <h2>{data.property.name}</h2>
              <p>{data.property.address ?? data.property.administrativeArea ?? "Chưa cập nhật địa chỉ"}</p>
            </div>
            <div className="asset-action-row">
              <StatusBadge tone="info">{data.property.type}</StatusBadge>
              {data.capabilities.canManageProperty ? (
                <>
                  <button className="secondary-button" type="button" onClick={() => chooseMode(createMode === "floor" ? null : "floor")}>Thêm tầng</button>
                  <button className="primary-button" type="button" onClick={() => chooseMode(createMode === "room" ? null : "room")}>Thêm phòng</button>
                </>
              ) : null}
            </div>
          </section>

          {mutationNotice ? <div className="asset-notice" role="status">{mutationNotice}</div> : null}

          {createMode === "floor" && data.capabilities.canManageProperty ? (
            <form className="asset-create-form" onSubmit={createFloor}>
              <div className="asset-create-form__heading">
                <div><span className="eyebrow">CREATE FLOOR</span><h3>Thêm tầng</h3></div>
                <small>Command được kiểm tra property.manage và commercial write state.</small>
              </div>
              <div className="asset-create-form__grid">
                <label>Mã tầng<input name="code" maxLength={64} required placeholder="F1" /></label>
                <label>Tên tầng<input name="name" maxLength={200} required placeholder="Tầng 1" /></label>
                <label>Thứ tự<input name="sortOrder" type="number" defaultValue={0} step={1} /></label>
              </div>
              {mutationError ? <div className="asset-form-error" role="alert">{mutationError}</div> : null}
              <div className="asset-form-actions">
                <button className="secondary-button" type="button" disabled={saving} onClick={() => chooseMode(null)}>Hủy</button>
                <button className="primary-button" type="submit" disabled={saving}>{saving ? "Đang tạo…" : "Tạo tầng"}</button>
              </div>
            </form>
          ) : null}

          {createMode === "room" && data.capabilities.canManageProperty ? (
            <form className="asset-create-form" onSubmit={createRoom}>
              <div className="asset-create-form__heading">
                <div><span className="eyebrow">CREATE ROOM</span><h3>Thêm phòng</h3></div>
                <small>Room limit được kiểm tra server-side theo plan/override hiện tại.</small>
              </div>
              <div className="asset-create-form__grid">
                <label>Mã phòng<input name="code" maxLength={64} required placeholder="101" /></label>
                <label>Tên phòng<input name="name" maxLength={200} required placeholder="Phòng 101" /></label>
                <label>
                  Tầng
                  <select name="floorId" defaultValue="">
                    <option value="">Chưa gán tầng</option>
                    {data.floors.filter((floor) => floor.id !== null).map((floor) => (
                      <option value={floor.id ?? ""} key={floor.id}>{floor.name}</option>
                    ))}
                  </select>
                </label>
                <label>Thứ tự<input name="sortOrder" type="number" defaultValue={0} step={1} /></label>
              </div>
              {mutationError ? <div className="asset-form-error" role="alert">{mutationError}</div> : null}
              <div className="asset-form-actions">
                <button className="secondary-button" type="button" disabled={saving} onClick={() => chooseMode(null)}>Hủy</button>
                <button className="primary-button" type="submit" disabled={saving}>{saving ? "Đang tạo…" : "Tạo phòng"}</button>
              </div>
            </form>
          ) : null}

          <section className="metrics-grid" aria-label="Tình trạng cơ sở">
            <MetricCard label="Tầng" value={String(data.property.floors)} detail="Đang hoạt động" tone="info" />
            <MetricCard label="Phòng" value={String(data.property.rooms)} detail="Đang hoạt động" tone="info" />
            <MetricCard label="Đang thuê" value={String(data.property.occupiedRooms)} detail="Có hợp đồng hiện tại" tone="success" />
            <MetricCard label="Phòng trống" value={String(data.property.vacantRooms)} detail="Có thể tạo hợp đồng mới" tone={data.property.vacantRooms > 0 ? "warning" : "success"} />
          </section>

          {data.floors.length === 0 ? (
            <div className="admin-state">
              <strong>Chưa có tầng hoặc phòng trong cơ sở này.</strong>
              <span>{data.capabilities.canManageProperty ? "Tạo tầng trước hoặc thêm phòng chưa gán tầng." : "Membership hiện tại chỉ có quyền đọc tài sản."}</span>
            </div>
          ) : (
            <div className="floor-stack">
              {data.floors.map((floor) => (
                <section className="panel floor-panel" key={floor.id ?? "no-floor"}>
                  <div className="asset-section-heading">
                    <div><span className="eyebrow">{floor.code}</span><h2>{floor.name}</h2></div>
                    <span className="panel-meta">{floor.rooms.length} phòng</span>
                  </div>
                  {floor.rooms.length === 0 ? (
                    <div className="floor-empty">Tầng đã tạo, chưa có phòng.</div>
                  ) : (
                    <div className="room-grid">
                      {floor.rooms.map((room) => (
                        <a className="room-card" href={"/assets/rooms/" + room.id} key={room.id}>
                          <div className="room-card__heading">
                            <div><span>{room.code}</span><strong>{room.name}</strong></div>
                            <StatusBadge tone={occupancyTone(room.occupancy)}>{room.occupancy === "OCCUPIED" ? "ĐANG THUÊ" : "TRỐNG"}</StatusBadge>
                          </div>
                          {room.lease ? (
                            <div className="room-card__lease"><span>Hợp đồng hiện tại</span><strong>{room.lease.code}</strong><small>{room.lease.status}</small></div>
                          ) : (
                            <div className="room-card__lease"><span>Hợp đồng hiện tại</span><strong>Chưa có</strong><small>Sẵn sàng tạo hợp đồng mới</small></div>
                          )}
                        </a>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </AdminShell>
  );
}
