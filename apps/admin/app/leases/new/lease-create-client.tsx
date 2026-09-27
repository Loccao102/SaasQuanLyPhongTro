"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  ApartmentOutlined,
  HomeOutlined,
  FileTextOutlined,
  UserOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
  ArrowLeftOutlined,
  FilterOutlined,
  EnvironmentOutlined,
  CalendarOutlined,
  DollarCircleOutlined
} from "@ant-design/icons";
import { PageHeader, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../../components/admin-shell";
import {
  adminAssetsApi,
  type AdminPropertyDetail
} from "../../../lib/admin-assets-api";
import {
  adminLeasesApi,
  type ResidentSearchResult
} from "../../../lib/admin-leases-api";

type RoomOption = {
  id: string;
  code: string;
  name: string;
  occupancy: "OCCUPIED" | "VACANT";
  propertyId: string;
  propertyName: string;
  floorId: string | null;
  floorName: string;
};

export function LeaseCreateClient() {
  const searchParams = useSearchParams();
  const paramRoomId = searchParams.get("roomId") ?? "";
  const paramBaseRent = searchParams.get("baseRentVnd") ?? "";
  const paramDeposit = searchParams.get("depositRequiredVnd") ?? "";

  const [properties, setProperties] = useState<AdminPropertyDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Cascading Selection State: Property -> Floor Filter -> Room
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [selectedFloorId, setSelectedFloorId] = useState("ALL");
  const [selectedRoomId, setSelectedRoomId] = useState(paramRoomId);
  const [vacantOnlyFilter, setVacantOnlyFilter] = useState(false);

  // Resident search
  const [residentQuery, setResidentQuery] = useState("");
  const [residentResults, setResidentResults] = useState<ResidentSearchResult[]>([]);
  const [selectedResident, setSelectedResident] =
    useState<ResidentSearchResult | null>(null);
  const [residentSearching, setResidentSearching] = useState(false);

  const commandIdentity = useRef<{
    leaseId: string;
    residentId: string;
    idempotencyKey: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const overview = await adminAssetsApi.overview();
        const details = await Promise.all(
          overview.properties.map((property) =>
            adminAssetsApi.property(property.id)
          )
        );
        if (active) {
          setProperties(details);

          // If paramRoomId is specified in URL, auto-select its property and room
          if (paramRoomId) {
            const foundProperty = details.find((p) =>
              p.floors.some((f) => f.rooms.some((r) => r.id === paramRoomId))
            );
            if (foundProperty) {
              setSelectedPropertyId(foundProperty.property.id);
              setSelectedRoomId(paramRoomId);
            }
          } else if (details.length === 1 && details[0]) {
            // If there's only 1 property, preselect it automatically
            setSelectedPropertyId(details[0].property.id);
          }
        }
      } catch (error) {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Không thể tải danh sách phòng."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [paramRoomId]);

  // All rooms flattened across all properties (for lookup)
  const allRooms = useMemo<RoomOption[]>(
    () =>
      properties.flatMap((property) =>
        property.floors.flatMap((floor) =>
          floor.rooms.map((room) => ({
            id: room.id,
            code: room.code,
            name: room.name,
            occupancy: room.occupancy,
            propertyId: property.property.id,
            propertyName: property.property.name,
            floorId: floor.id,
            floorName: floor.name
          }))
        )
      ),
    [properties]
  );

  // Selected property object
  const selectedProperty = useMemo(
    () => properties.find((p) => p.property.id === selectedPropertyId) ?? null,
    [properties, selectedPropertyId]
  );

  // Rooms in the currently selected property
  const roomsInSelectedProperty = useMemo(() => {
    if (!selectedProperty) return [];
    return selectedProperty.floors.flatMap((floor) =>
      floor.rooms.map((room) => ({
        id: room.id,
        code: room.code,
        name: room.name,
        occupancy: room.occupancy,
        propertyId: selectedProperty.property.id,
        propertyName: selectedProperty.property.name,
        floorId: floor.id,
        floorName: floor.name
      }))
    );
  }, [selectedProperty]);

  // Visible floors & rooms for the selected property based on floor & vacant filters
  const visibleFloors = useMemo(() => {
    if (!selectedProperty) return [];
    return selectedProperty.floors
      .filter(
        (floor) =>
          selectedFloorId === "ALL" ||
          (floor.id ?? floor.name) === selectedFloorId
      )
      .map((floor) => ({
        ...floor,
        rooms: floor.rooms.filter((room) =>
          vacantOnlyFilter ? room.occupancy === "VACANT" : true
        )
      }))
      .filter((floor) => floor.rooms.length > 0);
  }, [selectedProperty, selectedFloorId, vacantOnlyFilter]);

  // Selected room details
  const selectedRoom = useMemo(
    () => allRooms.find((room) => room.id === selectedRoomId) ?? null,
    [allRooms, selectedRoomId]
  );

  function handlePropertyChange(propId: string) {
    setSelectedPropertyId(propId);
    setSelectedFloorId("ALL");
    setSelectedRoomId("");
    setSelectedResident(null);
    setResidentResults([]);
  }

  async function searchResidents() {
    const targetPropertyId = selectedRoom?.propertyId || selectedPropertyId;
    if (!targetPropertyId) {
      setMutationError("Vui lòng chọn cơ sở trước khi tìm người thuê cũ.");
      return;
    }
    if (residentQuery.trim().length < 2) {
      setMutationError("Nhập ít nhất 2 ký tự để tìm người thuê.");
      return;
    }

    setResidentSearching(true);
    setMutationError(null);
    try {
      const result = await adminLeasesApi.searchResidents(
        targetPropertyId,
        residentQuery
      );
      setResidentResults(result.residents);
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : "Không thể tìm người thuê."
      );
    } finally {
      setResidentSearching(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const roomId = String(form.get("roomId") ?? "");
    if (!roomId) {
      setMutationError("Vui lòng chọn phòng để tạo hợp đồng.");
      return;
    }

    if (!commandIdentity.current) {
      commandIdentity.current = {
        leaseId: crypto.randomUUID(),
        residentId: selectedResident?.id ?? crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID()
      };
    }

    setSaving(true);
    setMutationError(null);
    try {
      const result = await adminLeasesApi.createDraft({
        ...commandIdentity.current,
        roomId,
        leaseCode: String(form.get("leaseCode") ?? ""),
        startDate: String(form.get("startDate") ?? ""),
        plannedEndDate: String(form.get("plannedEndDate") ?? "") || null,
        baseRentVnd: Number(form.get("baseRentVnd") ?? 0),
        depositRequiredVnd: Number(form.get("depositRequiredVnd") ?? 0),
        billingDay: Number(form.get("billingDay") ?? 1),
        primaryResident: selectedResident
          ? null
          : {
              fullName: String(form.get("fullName") ?? ""),
              phone: String(form.get("phone") ?? "") || null,
              email: String(form.get("email") ?? "") || null
            }
      });
      commandIdentity.current = null;
      window.location.assign("/leases/" + result.leaseId);
    } catch (error) {
      setMutationError(
        error instanceof Error
          ? error.message
          : "Không thể tạo hợp đồng nháp."
      );
      setSaving(false);
    }
  }

  return (
    <AdminShell title="Tạo hợp đồng" activeNav="Hợp đồng">
      <PageHeader
        eyebrow="LEASE.MANAGE · DRAFT"
        title="Tạo hợp đồng nháp"
        description="Hợp đồng nháp chưa chiếm dụng phòng. Chọn cơ sở, sau đó chọn phòng để tạo hợp đồng. Có thể chọn người thuê cũ hoặc thêm mới."
        action={
          <a className="secondary-link-button" href="/leases">
            <ArrowLeftOutlined style={{ marginRight: 6 }} /> Danh sách hợp đồng
          </a>
        }
      />

      {loadError ? (
        <div className="admin-state admin-state--error">
          <strong>Không thể tải danh sách tài sản & phòng.</strong>
          <span>{loadError}</span>
        </div>
      ) : loading ? (
        <div className="admin-state">Đang tải danh sách cơ sở và phòng được phân quyền…</div>
      ) : properties.length === 0 ? (
        <div className="admin-state">
          <strong>Chưa có cơ sở / nhà trọ nào trong hệ thống.</strong>
          <span>Hãy tạo cơ sở, tầng và phòng trước khi tạo hợp đồng.</span>
          <a className="secondary-link-button" href="/assets">
            Mở quản lý tài sản
          </a>
        </div>
      ) : (
        <form className="lease-create-layout" onSubmit={(event) => void submit(event)}>
          {paramRoomId && selectedRoom ? (
            <div className="admin-state admin-state--success" style={{ gridColumn: "1 / -1", marginBottom: "8px" }}>
              <strong>Tạo hợp đồng mới cho phòng {selectedRoom.code}</strong>
              <span>
                Cơ sở: <strong>{selectedRoom.propertyName}</strong> · {selectedRoom.floorName} · Phòng {selectedRoom.code}. Các thông số giá thuê và cọc đã được nạp sẵn.
              </span>
            </div>
          ) : null}

          {/* Panel 1: Chọn phòng & Điều khoản */}
          <section className="panel">
            <div className="asset-section-heading">
              <div>
                <span className="eyebrow">BƯỚC 1 & 2</span>
                <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <FileTextOutlined style={{ color: "var(--color-primary)" }} /> Chọn phòng & Điều khoản
                </h2>
              </div>
              <StatusBadge tone="neutral">BẢN NHÁP</StatusBadge>
            </div>

            <div className="asset-form">
              {/* Step 1: Chọn Cơ sở / Nhà trọ */}
              <label className="asset-form__wide">
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: "12px" }}>
                  <ApartmentOutlined style={{ color: "var(--color-primary)" }} /> 1. Chọn Nhà / Cơ sở *
                </span>
                <select
                  required
                  value={selectedPropertyId}
                  onChange={(e) => handlePropertyChange(e.target.value)}
                  style={{ fontWeight: 500 }}
                >
                  <option value="">-- Chọn Nhà / Cơ sở ({properties.length} cơ sở) --</option>
                  {properties.map((p) => {
                    const allR = p.floors.flatMap((f) => f.rooms);
                    const vacantR = allR.filter((r) => r.occupancy === "VACANT").length;
                    return (
                      <option key={p.property.id} value={p.property.id}>
                        {p.property.name} ({p.property.code}) · {allR.length} phòng ({vacantR} trống)
                      </option>
                    );
                  })}
                </select>
              </label>

              {/* Step 2: Bộ lọc Tầng & Checkbox lọc phòng trống */}
              {selectedProperty ? (
                <div
                  className="asset-form__wide"
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "14px",
                    alignItems: "flex-end",
                    padding: "10px 14px",
                    background: "var(--color-bg-muted, #f8fafc)",
                    borderRadius: "8px",
                    border: "1px dashed var(--color-border, #cbd5e1)"
                  }}
                >
                  {selectedProperty.floors.length > 1 ? (
                    <label style={{ minWidth: "160px", flex: "1 1 180px", margin: 0 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <FilterOutlined /> Lọc theo tầng
                      </span>
                      <select
                        value={selectedFloorId}
                        onChange={(e) => setSelectedFloorId(e.target.value)}
                      >
                        <option value="ALL">Tất cả tầng ({selectedProperty.floors.length} tầng)</option>
                        {selectedProperty.floors.map((f) => (
                          <option key={f.id ?? f.name} value={f.id ?? f.name}>
                            {f.name} ({f.rooms.length} phòng)
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <div style={{ display: "flex", alignItems: "center", height: "40px", padding: "0 4px" }}>
                    <label
                      style={{
                        display: "inline-flex",
                        flexDirection: "row",
                        alignItems: "center",
                        gap: "8px",
                        cursor: "pointer",
                        fontSize: "13px",
                        fontWeight: 500,
                        userSelect: "none",
                        margin: 0
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={vacantOnlyFilter}
                        onChange={(e) => setVacantOnlyFilter(e.target.checked)}
                        style={{ width: "16px", height: "16px", minHeight: "auto", cursor: "pointer" }}
                      />
                      <span>
                        Chỉ hiện phòng trống (
                        {roomsInSelectedProperty.filter((r) => r.occupancy === "VACANT").length} phòng)
                      </span>
                    </label>
                  </div>
                </div>
              ) : null}

              {/* Step 3: Chọn Phòng */}
              <label className="asset-form__wide">
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: "12px" }}>
                  <HomeOutlined style={{ color: "var(--color-primary)" }} /> 2. Chọn Phòng thuê *
                </span>
                <select
                  name="roomId"
                  required
                  disabled={!selectedPropertyId}
                  value={selectedRoomId}
                  onChange={(event) => {
                    setSelectedRoomId(event.target.value);
                    setSelectedResident(null);
                    setResidentResults([]);
                  }}
                  style={{ fontWeight: selectedRoomId ? 600 : 400 }}
                >
                  <option value="" disabled>
                    {selectedPropertyId
                      ? visibleFloors.length === 0
                        ? "-- Không tìm thấy phòng nào phù hợp với bộ lọc --"
                        : "-- Chọn phòng trong danh sách --"
                      : "-- Vui lòng chọn Nhà / Cơ sở ở bước 1 trước --"}
                  </option>
                  {visibleFloors.map((floor) => (
                    <optgroup key={floor.id} label={`${floor.name} (${floor.rooms.length} phòng)`}>
                      {floor.rooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          Phòng {room.code}
                          {room.name && room.name !== room.code ? ` (${room.name})` : ""} ·{" "}
                          {room.occupancy === "VACANT" ? "Trống (Sẵn sàng)" : "Đang có HĐ"}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              {/* Thông tin xác nhận phòng đã chọn */}
              {selectedRoom ? (
                <div
                  className="asset-form__wide"
                  style={{
                    background: selectedRoom.occupancy === "VACANT" ? "#f0fdf4" : "#fffbeb",
                    border: `1px solid ${selectedRoom.occupancy === "VACANT" ? "#bbf7d0" : "#fde68a"}`,
                    borderRadius: "8px",
                    padding: "12px 16px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "10px"
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <strong style={{ fontSize: "15px", color: "#0f172a" }}>
                        Phòng {selectedRoom.code}
                        {selectedRoom.name && selectedRoom.name !== selectedRoom.code ? ` (${selectedRoom.name})` : ""}
                      </strong>
                      <span style={{ fontSize: "13px", color: "#475569" }}>
                        · {selectedRoom.floorName} · {selectedRoom.propertyName}
                      </span>
                    </div>
                    {selectedProperty?.property.address ? (
                      <div style={{ fontSize: "12px", color: "#64748b", marginTop: "3px", display: "flex", alignItems: "center", gap: "4px" }}>
                        <EnvironmentOutlined />
                        {selectedProperty.property.address}
                        {selectedProperty.property.administrativeArea ? ` · ${selectedProperty.property.administrativeArea}` : ""}
                      </div>
                    ) : null}
                    {selectedRoom.occupancy === "OCCUPIED" ? (
                      <div style={{ fontSize: "12px", color: "#92400e", marginTop: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                        <InfoCircleOutlined />
                        <span>Phòng này đang có HĐ hoạt động. Hợp đồng nháp tạo ra là hợp đồng gối đầu (chỉ kích hoạt khi kết thúc HĐ trước).</span>
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <StatusBadge tone={selectedRoom.occupancy === "VACANT" ? "success" : "warning"}>
                      {selectedRoom.occupancy === "VACANT" ? "PHÒNG TRỐNG" : "ĐANG CÓ HỢP ĐỒNG"}
                    </StatusBadge>
                  </div>
                </div>
              ) : null}

              {/* Điều khoản hợp đồng */}
              <label>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <FileTextOutlined /> Mã hợp đồng *
                </span>
                <input name="leaseCode" required placeholder="HD-2026-0001" defaultValue={selectedRoom ? `HD-${selectedRoom.code}` : ""} />
              </label>

              <label>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <CalendarOutlined /> Ngày bắt đầu *
                </span>
                <input name="startDate" type="date" required />
              </label>

              <label>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <CalendarOutlined /> Ngày kết thúc dự kiến
                </span>
                <input name="plannedEndDate" type="date" />
              </label>

              <label>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <DollarCircleOutlined /> Tiền phòng / tháng (VND) *
                </span>
                <input
                  name="baseRentVnd"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={paramBaseRent || undefined}
                  placeholder="Ví dụ: 3500000"
                  required
                />
              </label>

              <label>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <DollarCircleOutlined /> Tiền cọc yêu cầu (VND) *
                </span>
                <input
                  name="depositRequiredVnd"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={paramDeposit || "0"}
                  placeholder="Ví dụ: 3500000"
                  required
                />
              </label>

              <label>
                <span>Ngày chốt tiền hàng tháng (1-31) *</span>
                <input name="billingDay" type="number" min="1" max="31" step="1" defaultValue="1" required />
              </label>
            </div>
          </section>

          {/* Panel 2: Người thuê chính */}
          <section className="panel">
            <div className="asset-section-heading">
              <div>
                <span className="eyebrow">PRIMARY TENANT</span>
                <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <UserOutlined style={{ color: "var(--color-primary)" }} /> Người thuê chính
                </h2>
              </div>
              {selectedResident ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setSelectedResident(null)}
                >
                  Nhập người thuê mới
                </button>
              ) : null}
            </div>

            <div className="resident-search">
              <label>
                <span>Tìm người thuê cũ trong cơ sở</span>
                <input
                  value={residentQuery}
                  onChange={(event) => setResidentQuery(event.target.value)}
                  placeholder="Nhập tên, số điện thoại hoặc email"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void searchResidents();
                    }
                  }}
                />
              </label>
              <button
                className="secondary-button"
                type="button"
                disabled={residentSearching || (!selectedRoom && !selectedPropertyId)}
                onClick={() => void searchResidents()}
              >
                <SearchOutlined style={{ marginRight: 6 }} />
                {residentSearching ? "Đang tìm…" : "Tìm resident"}
              </button>
            </div>

            {residentResults.length > 0 && !selectedResident ? (
              <div className="resident-search-results">
                {residentResults.map((resident) => (
                  <button
                    type="button"
                    className="resident-search-result"
                    key={resident.id}
                    onClick={() => setSelectedResident(resident)}
                  >
                    <strong>{resident.fullName}</strong>
                    <span>{resident.phone ?? resident.email ?? "Chưa có liên hệ"}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {selectedResident ? (
              <div className="resident-selected" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <CheckCircleOutlined style={{ color: "var(--color-success, #16a34a)", fontSize: "20px" }} />
                <div style={{ flex: 1 }}>
                  <strong>{selectedResident.fullName}</strong>
                  <div style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                    {selectedResident.phone ?? selectedResident.email ?? "Chưa có liên hệ"}
                  </div>
                </div>
                <StatusBadge tone="info">DÙNG LẠI RESIDENT CŨ</StatusBadge>
              </div>
            ) : (
              <div className="asset-form">
                <label>
                  <span>Họ và tên *</span>
                  <input name="fullName" required placeholder="Nguyễn Văn A" />
                </label>
                <label>
                  <span>Số điện thoại</span>
                  <input name="phone" inputMode="tel" placeholder="0912345678" />
                </label>
                <label>
                  <span>Email</span>
                  <input name="email" type="email" placeholder="nguyenvana@gmail.com" />
                </label>
              </div>
            )}
            <p className="inline-note" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <InfoCircleOutlined />
              <span>Resident cũ chỉ được tìm và tái sử dụng trong phạm vi cơ sở mà tài khoản hiện tại được phân quyền.</span>
            </p>
          </section>

          {mutationError ? (
            <div className="admin-state admin-state--error">
              <strong>Chưa hoàn tất thao tác.</strong>
              <span>{mutationError}</span>
              <small>
                Nếu lệnh tạo đã được gửi đi, việc thử lại sẽ tiếp tục sử dụng cùng idempotency key an toàn.
              </small>
            </div>
          ) : null}

          {/* Panel 3: Review & Submit */}
          <section className="panel review-panel">
            <div className="asset-section-heading">
              <div>
                <span className="eyebrow">REVIEW & CONFIRM</span>
                <h2>Tạo bản nháp trước, kích hoạt sau</h2>
              </div>
            </div>
            <ul className="consequence-list">
              <li>Resident mới và Hợp đồng được khởi tạo trong cùng một giao dịch an toàn (transaction).</li>
              <li>Bản hợp đồng nháp không làm phòng bị khóa chiếm dụng ngay lập tức.</li>
              <li>Sau khi tạo bản nháp, bạn có thể bổ sung người ở cùng (Co-tenant/Occupant) và bàn giao thiết bị trước khi kích hoạt chính thức.</li>
            </ul>
            <div className="final-action">
              <div>
                <strong>Hành động hiện tại chỉ tạo bản nháp hợp đồng</strong>
                <span>Bạn sẽ được kiểm tra toàn bộ chi tiết và điều khoản trước khi bấm kích hoạt.</span>
              </div>
              <button
                className="primary-button"
                type="submit"
                disabled={saving || !selectedRoomId}
              >
                {saving ? "Đang tạo…" : "Tạo hợp đồng nháp"}
              </button>
            </div>
          </section>
        </form>
      )}
    </AdminShell>
  );
}
