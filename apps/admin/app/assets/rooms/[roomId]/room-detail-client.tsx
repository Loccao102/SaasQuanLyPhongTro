"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { MetricCard, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../../../components/admin-shell";
import {
  adminAssetsApi,
  type AdminRoomDetail,
  type RoomEquipment,
  type EquipmentConditionStatus
} from "../../../../lib/admin-assets-api";

function money(value: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(value);
}

const conditionLabels: Record<EquipmentConditionStatus, { label: string; tone: "success" | "info" | "warning" | "danger" | "neutral" }> = {
  EXCELLENT: { label: "Hoàn hảo", tone: "success" },
  GOOD: { label: "Tốt", tone: "info" },
  FAIR: { label: "Bình thường", tone: "neutral" },
  NEEDS_REPAIR: { label: "Cần bảo trì", tone: "warning" },
  DAMAGED: { label: "Hư hỏng", tone: "danger" }
};

export function RoomDetailClient({ roomId }: { roomId: string }) {
  const [data, setData] = useState<AdminRoomDetail | null>(null);
  const [equipmentList, setEquipmentList] = useState<RoomEquipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAddEquipment, setShowAddEquipment] = useState(false);
  const [addingEquipment, setAddingEquipment] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [roomData, equipData] = await Promise.all([
        adminAssetsApi.room(roomId),
        adminAssetsApi.roomEquipment(roomId)
      ]);
      setData(roomData);
      setEquipmentList(equipData);
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

  async function updateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setMutationError(null);
    try {
      await adminAssetsApi.updateRoom(roomId, {
        code: String(form.get("code") ?? ""),
        name: String(form.get("name") ?? ""),
        sortOrder: Number(form.get("sortOrder") ?? 0)
      });
      await load();
    } catch (mutation) {
      setMutationError(
        mutation instanceof Error ? mutation.message : "Không thể cập nhật phòng."
      );
    } finally {
      setSaving(false);
    }
  }

  async function deactivateRoom() {
    if (!data) return;
    setSaving(true);
    setMutationError(null);
    try {
      await adminAssetsApi.deactivateRoom(roomId);
      window.location.assign("/assets/properties/" + data.property.id);
    } catch (mutation) {
      setMutationError(
        mutation instanceof Error ? mutation.message : "Không thể ngưng phòng."
      );
      setSaving(false);
    }
  }

  async function handleAddEquipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setAddingEquipment(true);
    setMutationError(null);
    try {
      await adminAssetsApi.createRoomEquipment(roomId, {
        name: String(form.get("equipName") ?? ""),
        brand: String(form.get("brand") ?? "") || undefined,
        modelOrSerial: String(form.get("modelOrSerial") ?? "") || undefined,
        quantity: Number(form.get("quantity") ?? 1),
        conditionStatus: String(form.get("conditionStatus") ?? "GOOD") as EquipmentConditionStatus,
        compensationValueVnd: Number(form.get("compensationValueVnd") ?? 0),
        note: String(form.get("note") ?? "") || undefined,
        installedAt: String(form.get("installedAt") ?? "") || undefined
      });
      setShowAddEquipment(false);
      await load();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Không thể thêm thiết bị.");
    } finally {
      setAddingEquipment(false);
    }
  }

  async function handleDeleteEquipment(equipmentId: string, name: string) {
    if (!window.confirm(`Xoá thiết bị "${name}" khỏi phòng?`)) return;
    setSaving(true);
    setMutationError(null);
    try {
      await adminAssetsApi.deleteRoomEquipment(roomId, equipmentId);
      await load();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Không thể xoá thiết bị.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateEquipmentCondition(
    equipmentId: string,
    conditionStatus: EquipmentConditionStatus
  ) {
    setSaving(true);
    setMutationError(null);
    try {
      await adminAssetsApi.updateRoomEquipment(roomId, equipmentId, { conditionStatus });
      await load();
    } catch (err) {
      setMutationError(
        err instanceof Error ? err.message : "Không thể cập nhật tình trạng thiết bị."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell
      title={data ? data.room.code + " · " + data.room.name : "Chi tiết phòng"}
      eyebrow="TÀI SẢN · ROOM DETAIL"
      activeNav="Tài sản"
    >
      {data ? (
        <a className="back-link" href={"/assets/properties/" + data.property.id}>
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

          {mutationError ? (
            <div className="admin-state admin-state--error">
              <strong>Không thể lưu thay đổi.</strong>
              <span>{mutationError}</span>
            </div>
          ) : null}

          <section className="panel">
            <div className="asset-section-heading">
              <div>
                <span className="eyebrow">PROPERTY.MANAGE</span>
                <h2>Thông tin phòng</h2>
              </div>
            </div>
            <form className="asset-form" onSubmit={(event) => void updateRoom(event)}>
              <label><span>Mã phòng</span><input name="code" defaultValue={data.room.code} required /></label>
              <label><span>Tên phòng</span><input name="name" defaultValue={data.room.name} required /></label>
              <label><span>Thứ tự</span><input name="sortOrder" type="number" defaultValue={data.room.sortOrder} /></label>
              <div className="button-row asset-form__wide">
                <button className="primary-button" type="submit" disabled={saving}>Lưu phòng</button>
                {data.room.occupancy === "VACANT" ? (
                  <button className="danger-button" type="button" disabled={saving} onClick={() => void deactivateRoom()}>
                    Ngưng phòng
                  </button>
                ) : null}
              </div>
            </form>
          </section>

          <section className="panel">
            <div className="asset-section-heading">
              <div>
                <span className="eyebrow">INVENTORY · BÀN GIAO THIẾT BỊ</span>
                <h2>Danh mục trang thiết bị & Đồ đạc ({equipmentList.length})</h2>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setShowAddEquipment((prev) => !prev)}
              >
                {showAddEquipment ? "Đóng form" : "+ Thêm thiết bị"}
              </button>
            </div>

            {showAddEquipment ? (
              <form
                className="asset-form"
                style={{
                  marginBottom: "1.5rem",
                  padding: "1rem",
                  background: "var(--color-bg-muted, #f8fafc)",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border, #e2e8f0)"
                }}
                onSubmit={(e) => void handleAddEquipment(e)}
              >
                <label>
                  <span>Tên thiết bị *</span>
                  <input name="equipName" placeholder="vd: Điều hoà Daikin 1.5 HP" required />
                </label>
                <label>
                  <span>Hãng / Thương hiệu</span>
                  <input name="brand" placeholder="vd: Daikin, Panasonic..." />
                </label>
                <label>
                  <span>Model / Số Serial</span>
                  <input name="modelOrSerial" placeholder="vd: FTKB35WAVMV..." />
                </label>
                <label>
                  <span>Số lượng</span>
                  <input name="quantity" type="number" min="1" defaultValue={1} required />
                </label>
                <label>
                  <span>Tình trạng ban đầu</span>
                  <select name="conditionStatus" defaultValue="GOOD">
                    <option value="EXCELLENT">Hoàn hảo (Mới 100%)</option>
                    <option value="GOOD">Tốt (Đang hoạt động ổn định)</option>
                    <option value="FAIR">Bình thường (Có dấu hiệu hao mòn)</option>
                    <option value="NEEDS_REPAIR">Cần bảo trì / sửa chữa</option>
                    <option value="DAMAGED">Hư hỏng</option>
                  </select>
                </label>
                <label>
                  <span>Giá trị đền bù quy định (VNĐ)</span>
                  <input
                    name="compensationValueVnd"
                    type="number"
                    min="0"
                    step="50000"
                    placeholder="vd: 2000000"
                    defaultValue={0}
                  />
                </label>
                <label>
                  <span>Ngày lắp đặt / Bàn giao</span>
                  <input name="installedAt" type="date" />
                </label>
                <label className="asset-form__wide">
                  <span>Ghi chú / Quy định bảo quản</span>
                  <input name="note" placeholder="vd: Điều hoà kèm remote, lưới lọc sạch sẽ..." />
                </label>
                <div className="button-row asset-form__wide">
                  <button className="primary-button" type="submit" disabled={addingEquipment}>
                    {addingEquipment ? "Đang lưu..." : "Lưu thiết bị"}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setShowAddEquipment(false)}
                  >
                    Huỷ
                  </button>
                </div>
              </form>
            ) : null}

            {equipmentList.length === 0 ? (
              <div className="admin-state" style={{ padding: "1.5rem" }}>
                Phòng này chưa có danh mục thiết bị bàn giao. Hãy bấm <strong>"+ Thêm thiết bị"</strong> để ghi nhận đồ đạc (máy lạnh, tủ lạnh, giường, nệm...).
              </div>
            ) : (
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {equipmentList.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0.85rem 1rem",
                      background: "var(--color-surface, #ffffff)",
                      border: "1px solid var(--color-border, #e2e8f0)",
                      borderRadius: "8px",
                      flexWrap: "wrap",
                      gap: "0.75rem"
                    }}
                  >
                    <div style={{ minWidth: "220px", flex: "1 1 auto" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <strong style={{ fontSize: "1rem" }}>{item.name}</strong>
                        <span style={{ fontSize: "0.85rem", color: "var(--color-muted, #64748b)" }}>
                          x{item.quantity}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.85rem", color: "var(--color-muted, #64748b)", marginTop: "0.25rem" }}>
                        {item.brand ? `Hãng: ${item.brand} ` : ""}
                        {item.modelOrSerial ? `· Serial: ${item.modelOrSerial} ` : ""}
                        {item.compensationValueVnd > 0
                          ? `· Đền bù: ${money(item.compensationValueVnd)}`
                          : ""}
                      </div>
                      {item.note ? (
                        <div style={{ fontSize: "0.8rem", color: "var(--color-muted, #64748b)", marginTop: "0.2rem", fontStyle: "italic" }}>
                          {item.note}
                        </div>
                      ) : null}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <StatusBadge tone={conditionLabels[item.conditionStatus]?.tone ?? "neutral"}>
                        {conditionLabels[item.conditionStatus]?.label ?? item.conditionStatus}
                      </StatusBadge>
                      <select
                        value={item.conditionStatus}
                        onChange={(e) =>
                          void handleUpdateEquipmentCondition(
                            item.id,
                            e.target.value as EquipmentConditionStatus
                          )
                        }
                        disabled={saving}
                        style={{
                          fontSize: "0.8rem",
                          padding: "0.25rem 0.5rem",
                          borderRadius: "4px",
                          border: "1px solid var(--color-border, #cbd5e1)"
                        }}
                      >
                        <option value="EXCELLENT">Hoàn hảo</option>
                        <option value="GOOD">Tốt</option>
                        <option value="FAIR">Bình thường</option>
                        <option value="NEEDS_REPAIR">Cần bảo trì</option>
                        <option value="DAMAGED">Hư hỏng</option>
                      </select>
                      <button
                        className="danger-button"
                        type="button"
                        style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}
                        disabled={saving}
                        onClick={() => void handleDeleteEquipment(item.id, item.name)}
                        title="Xoá thiết bị"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {data.currentLease ? (
            <>
              <section className="metrics-grid">
                <MetricCard label="Tiền thuê" value={money(data.currentLease.baseRentVnd)} detail="Snapshot trên hợp đồng hiện tại" tone="info" />
                <MetricCard label="Tiền cọc yêu cầu" value={money(data.currentLease.depositRequiredVnd)} detail="Snapshot trên hợp đồng hiện tại" tone="info" />
                <MetricCard label="Bắt đầu" value={data.currentLease.startDate ?? "—"} detail={data.currentLease.code} tone="success" />
                <MetricCard label="Kết thúc dự kiến" value={data.currentLease.plannedEndDate ?? "Chưa đặt"} detail={data.currentLease.status} tone="warning" />
              </section>

              <section className="panel">
                <div className="asset-section-heading">
                  <div>
                    <span className="eyebrow">CURRENT LEASE</span>
                    <h2>{data.currentLease.code}</h2>
                  </div>
                  <a className="secondary-button secondary-button--link" href={"/leases/" + data.currentLease.id}>
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
                  Phòng có thể được chỉnh sửa hoặc ngưng hoạt động. Lịch sử không bị xoá.
                  Bước tiếp theo sẽ nối trực tiếp workflow tạo hợp đồng mới.
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
