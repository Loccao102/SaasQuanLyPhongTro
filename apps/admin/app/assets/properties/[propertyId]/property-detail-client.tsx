"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ApartmentOutlined,
  HomeOutlined,
  SettingOutlined,
  EditOutlined,
  PlusOutlined,
  CloseOutlined,
  EnvironmentOutlined,
  ArrowLeftOutlined
} from "@ant-design/icons";
import { MetricCard, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../../../components/admin-shell";
import {
  adminAssetsApi,
  type AdminPropertyDetail
} from "../../../../lib/admin-assets-api";

function occupancyTone(value: "OCCUPIED" | "VACANT") {
  return value === "OCCUPIED" ? ("success" as const) : ("warning" as const);
}

function propertyTypeLabel(type: string) {
  switch (type) {
    case "BOARDING_HOUSE":
      return "Nhà trọ";
    case "MINI_APARTMENT":
      return "Chung cư mini";
    case "APARTMENT":
      return "Căn hộ";
    default:
      return "Khác";
  }
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
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Filter state
  const [filterOccupancy, setFilterOccupancy] = useState<"ALL" | "OCCUPIED" | "VACANT">("ALL");

  // Modals state
  const [showAddRoomModal, setShowAddRoomModal] = useState(false);
  const [targetFloorIdForRoom, setTargetFloorIdForRoom] = useState<string>("");
  const [showAddFloorModal, setShowAddFloorModal] = useState(false);
  const [showEditPropertyModal, setShowEditPropertyModal] = useState(false);
  const [editingFloor, setEditingFloor] = useState<{
    id: string;
    code: string;
    name: string;
    sortOrder: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminAssetsApi.property(propertyId));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không thể tải dữ liệu cơ sở."
      );
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(action: () => Promise<unknown>, successMessage?: string) {
    setSaving(true);
    setMutationError(null);
    setMutationSuccess(null);
    try {
      await action();
      await load();
      if (successMessage) {
        setMutationSuccess(successMessage);
        setTimeout(() => setMutationSuccess(null), 4000);
      }
      return true;
    } catch (mutation) {
      setMutationError(
        mutation instanceof Error ? mutation.message : "Thao tác không thành công."
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  // Submit handlers
  async function submitCreateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    const success = await mutate(async () => {
      await adminAssetsApi.createRoom(propertyId, {
        id: crypto.randomUUID(),
        floorId: String(form.get("floorId") ?? "") || null,
        code: String(form.get("code") ?? "").trim(),
        name: String(form.get("name") ?? "").trim(),
        sortOrder: Number(form.get("sortOrder") ?? 0)
      });
      formElement?.reset();
    }, "Tạo phòng mới thành công!");

    if (success) {
      setShowAddRoomModal(false);
    }
  }

  async function submitCreateFloor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    const success = await mutate(async () => {
      await adminAssetsApi.createFloor(propertyId, {
        id: crypto.randomUUID(),
        code: String(form.get("code") ?? "").trim(),
        name: String(form.get("name") ?? "").trim(),
        sortOrder: Number(form.get("sortOrder") ?? 0)
      });
      formElement?.reset();
    }, "Thêm tầng mới thành công!");

    if (success) {
      setShowAddFloorModal(false);
    }
  }

  async function submitEditFloor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingFloor) return;
    const form = new FormData(event.currentTarget);

    const success = await mutate(async () => {
      await adminAssetsApi.updateFloor(editingFloor.id, {
        code: String(form.get("code") ?? "").trim(),
        name: String(form.get("name") ?? "").trim(),
        sortOrder: Number(form.get("sortOrder") ?? 0)
      });
    }, "Cập nhật thông tin tầng thành công!");

    if (success) {
      setEditingFloor(null);
    }
  }

  async function submitProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const success = await mutate(() =>
      adminAssetsApi.updateProperty(propertyId, {
        code: String(form.get("code") ?? "").trim(),
        name: String(form.get("name") ?? "").trim(),
        propertyType: String(form.get("propertyType") ?? "BOARDING_HOUSE") as
          | "BOARDING_HOUSE"
          | "MINI_APARTMENT"
          | "APARTMENT"
          | "OTHER",
        addressText: String(form.get("addressText") ?? "").trim() || null
      }),
      "Cập nhật thông tin cơ sở thành công!"
    );

    if (success) {
      setShowEditPropertyModal(false);
    }
  }

  function openAddRoom(floorId?: string | null) {
    const firstRealFloor = data?.floors.find((f) => Boolean(f.id))?.id ?? "";
    setTargetFloorIdForRoom(floorId !== undefined && floorId !== null ? floorId : firstRealFloor);
    setMutationError(null);
    setShowAddRoomModal(true);
  }

  const occupancyRate = useMemo(() => {
    if (!data?.property.rooms) return 0;
    return Math.round((data.property.occupiedRooms / data.property.rooms) * 100);
  }, [data]);

  return (
    <AdminShell
      title={data?.property.name ?? "Chi tiết cơ sở"}
      eyebrow="TÀI SẢN · QUẢN LÝ PHÒNG"
      activeNav="Tài sản"
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <a className="back-link" href="/assets" style={{ fontSize: "13px" }}>
          <ArrowLeftOutlined aria-hidden="true" /> Quay lại danh sách cơ sở
        </a>
      </div>

      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Không thể tải cơ sở.</strong>
          <span>{error}</span>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            Thử lại
          </button>
        </div>
      ) : loading || !data ? (
        <div className="admin-state">Đang tải danh sách tầng và phòng…</div>
      ) : (
        <>
          {/* Header Context Banner */}
          <section className="asset-context" style={{ marginBottom: "18px" }}>
            <div style={{ display: "grid", gap: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className="eyebrow" style={{ margin: 0, fontWeight: 700 }}>
                  MÃ: {data.property.code}
                </span>
                <StatusBadge tone="info">{propertyTypeLabel(data.property.type)}</StatusBadge>
              </div>
              <h2 style={{ margin: 0, fontSize: "22px", fontWeight: 750 }}>{data.property.name}</h2>
              <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}>
                <EnvironmentOutlined style={{ color: "#0284c7" }} />
                <span>{data.property.address || data.property.administrativeArea || "Chưa cập nhật địa chỉ"}</span>
              </p>
            </div>

            {/* Quick Action Buttons */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
              <button
                className="primary-button"
                type="button"
                onClick={() => openAddRoom()}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <PlusOutlined /> Thêm phòng
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setMutationError(null);
                  setShowAddFloorModal(true);
                }}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <PlusOutlined /> Thêm tầng
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setMutationError(null);
                  setShowEditPropertyModal(true);
                }}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                title="Chỉnh sửa thông tin cơ sở"
              >
                <SettingOutlined /> Sửa cơ sở
              </button>
            </div>
          </section>

          {/* Metric Stats Cards */}
          <section className="metrics-grid" aria-label="Tình trạng cơ sở" style={{ marginBottom: "22px" }}>
            <MetricCard label="Tầng" value={String(data.property.floors)} detail="Đang hoạt động" tone="info" />
            <MetricCard label="Tổng số phòng" value={String(data.property.rooms)} detail={`Tỷ lệ lấp đầy: ${occupancyRate}%`} tone="info" />
            <MetricCard label="Đang thuê" value={String(data.property.occupiedRooms)} detail="Có hợp đồng hiện tại" tone="success" />
            <MetricCard
              label="Phòng trống"
              value={String(data.property.vacantRooms)}
              detail="Sẵn sàng tạo hợp đồng mới"
              tone={data.property.vacantRooms > 0 ? "warning" : "success"}
            />
          </section>

          {/* Toast / Error Messages */}
          {mutationError ? (
            <div className="admin-state admin-state--error" style={{ marginBottom: "18px" }}>
              <strong>Lỗi thao tác:</strong>
              <span>{mutationError}</span>
            </div>
          ) : null}

          {mutationSuccess ? (
            <div className="admin-state admin-state--success" style={{ marginBottom: "18px" }}>
              <strong>{mutationSuccess}</strong>
            </div>
          ) : null}

          {/* MAIN HERO: ROOM & FLOOR LIST */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 750 }}>
                Sơ đồ & Danh sách phòng theo tầng ({data.property.rooms} phòng)
              </h3>
              <p style={{ margin: "4px 0 0", color: "var(--color-text-muted)", fontSize: "13px" }}>
                Xem trực quan tình trạng phòng, thêm phòng và quản lý hợp đồng thuê theo từng tầng
              </p>
            </div>

            {/* Occupancy Filter Pills */}
            <div style={{ display: "flex", gap: "6px", background: "#f1f5f9", padding: "4px", borderRadius: "10px" }}>
              <button
                type="button"
                onClick={() => setFilterOccupancy("ALL")}
                style={{
                  border: "none",
                  padding: "6px 12px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  background: filterOccupancy === "ALL" ? "white" : "transparent",
                  color: filterOccupancy === "ALL" ? "var(--color-primary)" : "var(--color-text-muted)",
                  boxShadow: filterOccupancy === "ALL" ? "0 1px 3px rgba(0,0,0,0.1)" : "none"
                }}
              >
                Tất cả ({data.property.rooms})
              </button>
              <button
                type="button"
                onClick={() => setFilterOccupancy("OCCUPIED")}
                style={{
                  border: "none",
                  padding: "6px 12px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  background: filterOccupancy === "OCCUPIED" ? "white" : "transparent",
                  color: filterOccupancy === "OCCUPIED" ? "var(--color-success, #16a34a)" : "var(--color-text-muted)",
                  boxShadow: filterOccupancy === "OCCUPIED" ? "0 1px 3px rgba(0,0,0,0.1)" : "none"
                }}
              >
                Đang thuê ({data.property.occupiedRooms})
              </button>
              <button
                type="button"
                onClick={() => setFilterOccupancy("VACANT")}
                style={{
                  border: "none",
                  padding: "6px 12px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  background: filterOccupancy === "VACANT" ? "white" : "transparent",
                  color: filterOccupancy === "VACANT" ? "var(--color-warning, #d97706)" : "var(--color-text-muted)",
                  boxShadow: filterOccupancy === "VACANT" ? "0 1px 3px rgba(0,0,0,0.1)" : "none"
                }}
              >
                Còn trống ({data.property.vacantRooms})
              </button>
            </div>
          </div>

          {/* FLOORS & ROOMS STACK */}
          {data.floors.length === 0 ? (
            <div className="panel" style={{ textAlign: "center", padding: "48px 24px" }}>
              <ApartmentOutlined style={{ fontSize: "40px", color: "#94a3b8", marginBottom: "16px" }} />
              <h3 style={{ margin: "0 0 8px", fontSize: "18px" }}>Cơ sở này chưa có tầng nào</h3>
              <p style={{ margin: "0 0 20px", color: "var(--color-text-muted)", fontSize: "14px", maxWidth: "420px", marginLeft: "auto", marginRight: "auto" }}>
                Để bắt đầu quản lý phòng, hãy thêm tầng trước (ví dụ: Tầng 1, Tầng 2, Tầng Trệt...) hoặc tạo phòng trực tiếp.
              </p>
              <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    setMutationError(null);
                    setShowAddFloorModal(true);
                  }}
                >
                  + Thêm tầng đầu tiên
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => openAddRoom()}
                >
                  + Thêm phòng
                </button>
              </div>
            </div>
          ) : (
            <div className="floor-stack" style={{ gap: "20px" }}>
              {data.floors.map((floor) => {
                const floorRooms = floor.rooms.filter((room) => {
                  if (filterOccupancy === "ALL") return true;
                  return room.occupancy === filterOccupancy;
                });
                const occupiedInFloor = floor.rooms.filter((r) => r.occupancy === "OCCUPIED").length;
                const vacantInFloor = floor.rooms.length - occupiedInFloor;

                return (
                  <section
                    className="panel floor-panel"
                    key={floor.id ?? "no-floor"}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "14px",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.03)",
                      overflow: "hidden"
                    }}
                  >
                    {/* Floor Header Bar */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "16px 20px",
                        borderBottom: "1px solid #f1f5f9",
                        background: "#fafcfd",
                        flexWrap: "wrap",
                        gap: "10px"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <span
                          style={{
                            background: "var(--color-primary-light, #e0f2fe)",
                            color: "var(--color-primary, #0369a1)",
                            padding: "4px 8px",
                            borderRadius: "6px",
                            fontSize: "12px",
                            fontWeight: 700
                          }}
                        >
                          {floor.code}
                        </span>
                        <div>
                          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>{floor.name}</h3>
                          <small style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>
                            {floor.rooms.length} phòng ({occupiedInFloor} đang thuê · {vacantInFloor} trống)
                          </small>
                        </div>
                      </div>

                      {/* Floor Actions */}
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => openAddRoom(floor.id)}
                          style={{ fontSize: "12px", padding: "6px 12px" }}
                        >
                          + Thêm phòng vào {floor.name}
                        </button>
                        {floor.id ? (
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() =>
                              setEditingFloor({
                                id: floor.id!,
                                code: floor.code,
                                name: floor.name,
                                sortOrder: floor.sortOrder
                              })
                            }
                            title="Sửa tên hoặc mã tầng"
                            style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", padding: "6px 10px" }}
                          >
                            <EditOutlined /> Sửa
                          </button>
                        ) : null}
                        {floor.id && floor.rooms.length === 0 ? (
                          <button
                            className="danger-button"
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              void mutate(
                                () => adminAssetsApi.deactivateFloor(floor.id!),
                                `Đã ngưng ${floor.name}.`
                              )
                            }
                            style={{ fontSize: "12px", padding: "6px 10px" }}
                          >
                            Ngưng tầng
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {/* Floor Rooms Content */}
                    <div style={{ padding: "16px 20px" }}>
                      {floor.rooms.length === 0 ? (
                        /* Empty state inside floor */
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "36px 16px",
                            background: "#f8fafc",
                            border: "1.5px dashed #cbd5e1",
                            borderRadius: "12px",
                            textAlign: "center"
                          }}
                        >
                          <HomeOutlined style={{ fontSize: "32px", color: "#94a3b8", marginBottom: "10px" }} />
                          <strong style={{ fontSize: "14px", color: "#334155" }}>
                            {floor.name} chưa có phòng nào
                          </strong>
                          <p style={{ margin: "4px 0 16px", fontSize: "12px", color: "#64748b" }}>
                            Tạo phòng đầu tiên (ví dụ 101, 102...) để ghi nhận số điện nước và cho thuê.
                          </p>
                          <button
                            className="primary-button"
                            type="button"
                            onClick={() => openAddRoom(floor.id)}
                            style={{ fontSize: "13px" }}
                          >
                            + Thêm phòng vào {floor.name}
                          </button>
                        </div>
                      ) : floorRooms.length === 0 ? (
                        /* Empty filter state */
                        <div style={{ textAlign: "center", padding: "24px", color: "var(--color-text-muted)", fontSize: "13px" }}>
                          Không có phòng nào phù hợp với bộ lọc hiện tại.
                        </div>
                      ) : (
                        /* Grid of Rooms */
                        <div className="room-grid">
                          {floorRooms.map((room) => (
                            <a
                              className="room-card"
                              href={"/assets/rooms/" + room.id}
                              key={room.id}
                              style={{
                                border: room.occupancy === "OCCUPIED" ? "1px solid #bfdbfe" : "1px solid #fed7aa",
                                background: room.occupancy === "OCCUPIED" ? "#f0f9ff" : "#fffbeb",
                                transition: "all 0.15s ease",
                                padding: "14px"
                              }}
                            >
                              <div className="room-card__heading">
                                <div>
                                  <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--color-primary)" }}>
                                    {room.code}
                                  </span>
                                  <strong style={{ fontSize: "14px", fontWeight: 700 }}>{room.name}</strong>
                                </div>
                                <StatusBadge tone={occupancyTone(room.occupancy)}>
                                  {room.occupancy === "OCCUPIED" ? "ĐANG THUÊ" : "TRỐNG"}
                                </StatusBadge>
                              </div>

                              {room.lease ? (
                                <div className="room-card__lease" style={{ borderTop: "1px dashed #cbd5e1", paddingTop: "8px", marginTop: "4px" }}>
                                  <span>Hợp đồng hiện tại</span>
                                  <strong style={{ fontSize: "12px" }}>{room.lease.code}</strong>
                                  <small style={{ color: "#0369a1", fontWeight: 600 }}>● {room.lease.status}</small>
                                </div>
                              ) : (
                                <div className="room-card__lease" style={{ borderTop: "1px dashed #cbd5e1", paddingTop: "8px", marginTop: "4px" }}>
                                  <span>Tình trạng</span>
                                  <strong style={{ fontSize: "12px", color: "#b45309" }}>Sẵn sàng cho thuê</strong>
                                  <small>Bấm để xem & tạo hợp đồng</small>
                                </div>
                              )}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {/* Delete Property section (only when 0 floors and 0 rooms) */}
          {data.property.floors === 0 && data.property.rooms === 0 ? (
            <section className="destructive-banner" style={{ marginTop: "24px" }}>
              <div>
                <strong>Ngưng hoạt động cơ sở</strong>
                <p>Cơ sở này chưa có tầng hoặc phòng nào. Bạn có thể ngưng cơ sở bất cứ lúc nào.</p>
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

          {/* ── MODAL: THÊM PHÒNG ───────────────────────── */}
          {showAddRoomModal ? (
            <div className="modal-overlay" onClick={() => setShowAddRoomModal(false)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <h3 className="modal-title" style={{ margin: 0 }}>Thêm phòng mới</h3>
                  <button
                    type="button"
                    onClick={() => setShowAddRoomModal(false)}
                    style={{ background: "none", border: "none", fontSize: "16px", cursor: "pointer", color: "#64748b" }}
                  >
                    <CloseOutlined />
                  </button>
                </div>

                <form className="asset-form" onSubmit={submitCreateRoom}>
                  <label className="asset-form__wide">
                    <span>Chọn tầng</span>
                    <select
                      name="floorId"
                      value={targetFloorIdForRoom}
                      onChange={(e) => setTargetFloorIdForRoom(e.target.value)}
                    >
                      <option value="">-- Chưa gán tầng / Nhà trệt --</option>
                      {data.floors
                        .filter((floor) => Boolean(floor.id))
                        .map((floor) => (
                          <option key={floor.id!} value={floor.id!}>
                            {floor.name} ({floor.code})
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    <span>Mã phòng</span>
                    <input name="code" required placeholder="Ví dụ: 101" autoFocus />
                  </label>
                  <label>
                    <span>Tên phòng</span>
                    <input name="name" required placeholder="Ví dụ: Phòng 101" />
                  </label>
                  <label className="asset-form__wide">
                    <span>Thứ tự sắp xếp</span>
                    <input name="sortOrder" type="number" defaultValue="0" />
                  </label>

                  {mutationError ? (
                    <div className="asset-form__error asset-form__wide">{mutationError}</div>
                  ) : null}

                  <div className="modal-actions asset-form__wide">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setShowAddRoomModal(false)}
                    >
                      Hủy
                    </button>
                    <button className="primary-button" type="submit" disabled={saving}>
                      {saving ? "Đang lưu…" : "Tạo phòng"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          {/* ── MODAL: THÊM TẦNG ────────────────────────── */}
          {showAddFloorModal ? (
            <div className="modal-overlay" onClick={() => setShowAddFloorModal(false)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <h3 className="modal-title" style={{ margin: 0 }}>Thêm tầng mới</h3>
                  <button
                    type="button"
                    onClick={() => setShowAddFloorModal(false)}
                    style={{ background: "none", border: "none", fontSize: "16px", cursor: "pointer", color: "#64748b" }}
                  >
                    <CloseOutlined />
                  </button>
                </div>

                <form className="asset-form" onSubmit={submitCreateFloor}>
                  <label>
                    <span>Mã tầng</span>
                    <input name="code" required placeholder="Ví dụ: T2" autoFocus />
                    <small style={{ color: "var(--color-text-muted)", fontSize: "11px", marginTop: "4px" }}>
                      Mã tầng là duy nhất trong cơ sở (ví dụ: T1, T2, G, B1...)
                    </small>
                  </label>
                  <label>
                    <span>Tên tầng</span>
                    <input name="name" required placeholder="Ví dụ: Tầng 2" />
                  </label>
                  <label className="asset-form__wide">
                    <span>Thứ tự</span>
                    <input name="sortOrder" type="number" defaultValue={data.floors.length + 1} />
                  </label>

                  {mutationError ? (
                    <div className="asset-form__error asset-form__wide">{mutationError}</div>
                  ) : null}

                  <div className="modal-actions asset-form__wide">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setShowAddFloorModal(false)}
                    >
                      Hủy
                    </button>
                    <button className="primary-button" type="submit" disabled={saving}>
                      {saving ? "Đang lưu…" : "Thêm tầng"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          {/* ── MODAL: SỬA TẦNG ─────────────────────────── */}
          {editingFloor ? (
            <div className="modal-overlay" onClick={() => setEditingFloor(null)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <h3 className="modal-title" style={{ margin: 0 }}>Chỉnh sửa tầng</h3>
                  <button
                    type="button"
                    onClick={() => setEditingFloor(null)}
                    style={{ background: "none", border: "none", fontSize: "16px", cursor: "pointer", color: "#64748b" }}
                  >
                    <CloseOutlined />
                  </button>
                </div>

                <form className="asset-form" onSubmit={submitEditFloor}>
                  <label>
                    <span>Mã tầng</span>
                    <input name="code" defaultValue={editingFloor.code} required />
                  </label>
                  <label>
                    <span>Tên tầng</span>
                    <input name="name" defaultValue={editingFloor.name} required />
                  </label>
                  <label className="asset-form__wide">
                    <span>Thứ tự</span>
                    <input name="sortOrder" type="number" defaultValue={editingFloor.sortOrder} />
                  </label>

                  {mutationError ? (
                    <div className="asset-form__error asset-form__wide">{mutationError}</div>
                  ) : null}

                  <div className="modal-actions asset-form__wide">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setEditingFloor(null)}
                    >
                      Hủy
                    </button>
                    <button className="primary-button" type="submit" disabled={saving}>
                      {saving ? "Đang lưu…" : "Lưu thay đổi"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          {/* ── MODAL: SỬA THÔNG TIN CƠ SỞ ─────────────── */}
          {showEditPropertyModal ? (
            <div className="modal-overlay" onClick={() => setShowEditPropertyModal(false)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <h3 className="modal-title" style={{ margin: 0 }}>Chỉnh sửa thông tin cơ sở</h3>
                  <button
                    type="button"
                    onClick={() => setShowEditPropertyModal(false)}
                    style={{ background: "none", border: "none", fontSize: "16px", cursor: "pointer", color: "#64748b" }}
                  >
                    <CloseOutlined />
                  </button>
                </div>

                <form className="asset-form" onSubmit={submitProperty}>
                  <label>
                    <span>Mã cơ sở</span>
                    <input name="code" defaultValue={data.property.code} required />
                  </label>
                  <label>
                    <span>Tên cơ sở</span>
                    <input name="name" defaultValue={data.property.name} required />
                  </label>
                  <label className="asset-form__wide">
                    <span>Loại hình</span>
                    <select name="propertyType" defaultValue={data.property.type}>
                      <option value="BOARDING_HOUSE">Nhà trọ</option>
                      <option value="MINI_APARTMENT">Chung cư mini</option>
                      <option value="APARTMENT">Căn hộ</option>
                      <option value="OTHER">Khác</option>
                    </select>
                  </label>
                  <label className="asset-form__wide">
                    <span>Địa chỉ</span>
                    <input name="addressText" defaultValue={data.property.address ?? ""} placeholder="Địa chỉ chi tiết cơ sở" />
                  </label>

                  {mutationError ? (
                    <div className="asset-form__error asset-form__wide">{mutationError}</div>
                  ) : null}

                  <div className="modal-actions asset-form__wide">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setShowEditPropertyModal(false)}
                    >
                      Hủy
                    </button>
                    <button className="primary-button" type="submit" disabled={saving}>
                      {saving ? "Đang lưu…" : "Lưu cơ sở"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
        </>
      )}
    </AdminShell>
  );
}
