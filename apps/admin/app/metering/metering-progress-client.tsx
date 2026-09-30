"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRightOutlined,
  CalculatorOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  WarningOutlined
} from "@ant-design/icons";
import { ProgressBar, StatusBadge } from "@propops/ui";
import { DateInput } from "@propops/ui/date-input";
import { AdminShell } from "../../components/admin-shell";
import {
  formatMeterValue,
  calculateUsage,
  normalizeMeterInput,
  validateReadingAgainstPrevious,
  anomalyWarning
} from "../../lib/admin-metering-domain";
import {
  meteringProgressApi,
  type AdminChecklistProperty,
  type AdminChecklistRoom,
  type AdminMeteringChecklistResponse
} from "../../lib/metering-progress-api";
import { renterBillingApi } from "../../lib/renter-billing-api";

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

function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(isoDate + "T00:00:00.000Z");
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function defaultPeriodStart(isoDate: string): string {
  const date = new Date(isoDate + "T00:00:00.000Z");
  date.setMonth(date.getMonth() - 1);
  return date.toISOString().slice(0, 10);
}

export function MeteringProgressClient() {
  const [readingDate, setReadingDate] = useState(todayIso);
  const [data, setData] = useState<AdminMeteringChecklistResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Active property selection
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);

  // Filters & search
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "COMPLETED" | "MISSING_METER">("ALL");
  const [floorFilter, setFloorFilter] = useState<string>("ALL");

  // Local draft inputs: roomId -> { electricity?: string; water?: string }
  const [draftValues, setDraftValues] = useState<Record<string, { electricity?: string; water?: string }>>({});
  const [savingRoomId, setSavingRoomId] = useState<string | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);

  // Billing Cycle creation state
  const [billingProperty, setBillingProperty] = useState<AdminChecklistProperty | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [cycleCode, setCycleCode] = useState("");
  const [creatingCycle, setCreatingCycle] = useState(false);
  const [billingResult, setBillingResult] = useState<{
    cycleId: string;
    code: string;
    created: number;
    eligible: number;
    reviewRequired: number;
  } | null>(null);

  const load = useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await meteringProgressApi.loadChecklist(date);
      setData(response);
      setSelectedPropertyId((current) => {
        if (current && response.properties.some((p) => p.id === current)) {
          return current;
        }
        return response.properties[0]?.id ?? null;
      });
      setDraftValues({});
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

  const activeProperty = useMemo(() => {
    if (!data || !selectedPropertyId) return null;
    return data.properties.find((p) => p.id === selectedPropertyId) ?? null;
  }, [data, selectedPropertyId]);

  // Unique floors for floor filter dropdown
  const availableFloors = useMemo(() => {
    if (!activeProperty) return [];
    const floorsMap = new Map<string, string>();
    for (const r of activeProperty.rooms) {
      if (r.floor) {
        floorsMap.set(r.floor.id, r.floor.name ?? r.floor.code ?? "Tầng");
      }
    }
    return Array.from(floorsMap.entries()).map(([id, name]) => ({ id, name }));
  }, [activeProperty]);

  // Filtered rooms
  const filteredRooms = useMemo(() => {
    if (!activeProperty) return [];
    return activeProperty.rooms.filter((room) => {
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchesCode = room.code.toLowerCase().includes(query);
        const matchesName = room.name.toLowerCase().includes(query);
        const matchesFloor = room.floor?.name?.toLowerCase().includes(query) ?? false;
        if (!matchesCode && !matchesName && !matchesFloor) return false;
      }
      if (floorFilter !== "ALL") {
        if (room.floor?.id !== floorFilter) return false;
      }
      if (statusFilter === "COMPLETED") {
        return room.complete;
      }
      if (statusFilter === "PENDING") {
        return !room.complete && !room.missingMeter;
      }
      if (statusFilter === "MISSING_METER") {
        return room.missingMeter;
      }
      return true;
    });
  }, [activeProperty, searchQuery, statusFilter, floorFilter]);

  // Count edited rooms that haven't been saved yet
  const dirtyRoomsCount = useMemo(() => {
    return Object.keys(draftValues).length;
  }, [draftValues]);

  function handleDraftChange(roomId: string, type: "electricity" | "water", value: string) {
    setDraftValues((prev) => {
      const roomDraft = prev[roomId] ?? {};
      return {
        ...prev,
        [roomId]: {
          ...roomDraft,
          [type]: value
        }
      };
    });
  }

  function getEffectiveValue(
    room: AdminChecklistRoom,
    type: "electricity" | "water"
  ): string {
    const draft = draftValues[room.id]?.[type];
    if (draft !== undefined) return draft;
    const meter = type === "electricity" ? room.electricity : room.water;
    return formatMeterValue(meter?.currentReading?.readingValue);
  }

  // Save single room readings
  async function saveRoomReadings(room: AdminChecklistRoom) {
    setError(null);
    setSuccessMessage(null);
    const draft = draftValues[room.id];
    if (!draft) return;

    const readingsToSave: Array<{
      meterId: string;
      readingValue: string;
    }> = [];

    if (draft.electricity !== undefined && room.electricity) {
      const normalized = normalizeMeterInput(draft.electricity);
      if (!normalized) {
        setError(`Chỉ số điện phòng ${room.code} không hợp lệ.`);
        return;
      }
      const valError = validateReadingAgainstPrevious(
        normalized,
        room.electricity.previousReading?.readingValue
      );
      if (valError) {
        setError(`Phòng ${room.code}: ${valError}`);
        return;
      }
      readingsToSave.push({
        meterId: room.electricity.id,
        readingValue: normalized
      });
    }

    if (draft.water !== undefined && room.water) {
      const normalized = normalizeMeterInput(draft.water);
      if (!normalized) {
        setError(`Chỉ số nước phòng ${room.code} không hợp lệ.`);
        return;
      }
      const valError = validateReadingAgainstPrevious(
        normalized,
        room.water.previousReading?.readingValue
      );
      if (valError) {
        setError(`Phòng ${room.code}: ${valError}`);
        return;
      }
      readingsToSave.push({
        meterId: room.water.id,
        readingValue: normalized
      });
    }

    if (readingsToSave.length === 0) return;

    setSavingRoomId(room.id);
    try {
      for (const item of readingsToSave) {
        await meteringProgressApi.saveReading(item.meterId, {
          id: crypto.randomUUID(),
          readingDate,
          readingValue: item.readingValue,
          allowCorrection: true
        });
      }
      setDraftValues((prev) => {
        const next = { ...prev };
        delete next[room.id];
        return next;
      });
      setSuccessMessage(`Đã lưu chỉ số phòng ${room.code}.`);
      await load(readingDate);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : `Không thể lưu chỉ số phòng ${room.code}.`
      );
    } finally {
      setSavingRoomId(null);
    }
  }

  // Batch save all edited rooms
  async function batchSaveAll() {
    if (!activeProperty || dirtyRoomsCount === 0) return;
    setError(null);
    setSuccessMessage(null);

    const batchList: Array<{
      id: string;
      meterId: string;
      readingValue: string;
      allowCorrection: boolean;
    }> = [];

    for (const [roomId, draft] of Object.entries(draftValues)) {
      const room = activeProperty.rooms.find((r) => r.id === roomId);
      if (!room) continue;

      if (draft.electricity !== undefined && room.electricity) {
        const normalized = normalizeMeterInput(draft.electricity);
        if (!normalized) {
          setError(`Chỉ số điện phòng ${room.code} không hợp lệ.`);
          return;
        }
        const valError = validateReadingAgainstPrevious(
          normalized,
          room.electricity.previousReading?.readingValue
        );
        if (valError) {
          setError(`Phòng ${room.code}: ${valError}`);
          return;
        }
        batchList.push({
          id: crypto.randomUUID(),
          meterId: room.electricity.id,
          readingValue: normalized,
          allowCorrection: true
        });
      }

      if (draft.water !== undefined && room.water) {
        const normalized = normalizeMeterInput(draft.water);
        if (!normalized) {
          setError(`Chỉ số nước phòng ${room.code} không hợp lệ.`);
          return;
        }
        const valError = validateReadingAgainstPrevious(
          normalized,
          room.water.previousReading?.readingValue
        );
        if (valError) {
          setError(`Phòng ${room.code}: ${valError}`);
          return;
        }
        batchList.push({
          id: crypto.randomUUID(),
          meterId: room.water.id,
          readingValue: normalized,
          allowCorrection: true
        });
      }
    }

    if (batchList.length === 0) return;

    setBatchSaving(true);
    try {
      const result = await meteringProgressApi.batchSaveReadings({
        readingDate,
        readings: batchList
      });
      setDraftValues({});
      setSuccessMessage(`Đã lưu thành công ${result.savedCount} chỉ số điện/nước.`);
      await load(readingDate);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Không thể lưu hàng loạt chỉ số."
      );
    } finally {
      setBatchSaving(false);
    }
  }

  // Open Billing Preparation Modal / Form
  function openBillingModal(property: AdminChecklistProperty) {
    setBillingProperty(property);
    const start = defaultPeriodStart(readingDate);
    const end = readingDate;
    const due = addDaysIso(end, 5);
    const monthStr = end.slice(0, 7);
    const code = `KY-${monthStr}-${property.code}`;

    setPeriodStart(start);
    setPeriodEnd(end);
    setDueDate(due);
    setCycleCode(code);
    setBillingResult(null);
  }

  // Create Cycle & Generate Rent Drafts
  async function createBillingCycleAndDrafts() {
    if (!billingProperty) return;
    setError(null);
    setSuccessMessage(null);
    setCreatingCycle(true);

    const cycleId = crypto.randomUUID();
    try {
      await renterBillingApi.createCycle({
        id: cycleId,
        propertyId: billingProperty.id,
        code: cycleCode.trim(),
        periodStart,
        periodEnd,
        dueDate
      });

      const genResult = await renterBillingApi.generateRentDrafts(cycleId);

      setBillingResult({
        cycleId,
        code: cycleCode.trim(),
        created: genResult.created,
        eligible: genResult.eligibleLeaseCount,
        reviewRequired: genResult.reviewRequiredInvoiceCount
      });
      setSuccessMessage(
        `Đã tạo kỳ hóa đơn ${cycleCode} và sinh nháp thành công ${genResult.created} hóa đơn!`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Không thể tạo kỳ hóa đơn hoặc tính nháp tiền phòng."
      );
    } finally {
      setCreatingCycle(false);
    }
  }

  return (
    <AdminShell
      title="Tiến độ chốt số & Hóa đơn"
      eyebrow="METERING · LIVE PROGRESS & BILLING PREPARATION"
      activeNav="Chốt số"
    >
      <section className="asset-context">
        <div>
          <span className="eyebrow">METER.READ & BILLING.MANAGE</span>
          <h2>{data?.organization.name ?? "Chốt điện nước & Tính hóa đơn"}</h2>
          <p>
            Theo dõi, nhập/sửa chỉ số điện nước theo danh sách phòng và chuyển tiếp
            nhanh sang tính tiền phòng cho kỳ hóa đơn.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label className="metering-date-filter">
            <span>Ngày chốt số</span>
            <DateInput
              value={readingDate}
              onChange={(event) => setReadingDate(event.target.value)}
            />
          </label>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void load(readingDate)}
            title="Làm mới dữ liệu"
            style={{ marginTop: 18 }}
          >
            <ReloadOutlined aria-hidden="true" /> Làm mới
          </button>
        </div>
      </section>

      {error ? (
        <div className="admin-state admin-state--error">
          <WarningOutlined style={{ fontSize: 20 }} />
          <div>
            <strong>Có lỗi xảy ra.</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      {successMessage ? (
        <div className="admin-state admin-state--success">
          <CheckCircleOutlined style={{ fontSize: 20 }} />
          <div>
            <strong>Thành công!</strong>
            <span>{successMessage}</span>
          </div>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="admin-state">Đang tải dữ liệu chốt số…</div>
      ) : !data || data.properties.length === 0 ? (
        <div className="admin-state">
          <strong>Không có cơ sở trong scope hiện tại.</strong>
          <span>Kiểm tra membership scope hoặc cấu hình tài sản.</span>
        </div>
      ) : (
        <>
          {/* Summary counters */}
          <section className="billing-cycle-card__stats">
            <div>
              <span>Tổng số phòng</span>
              <strong>{data.summary.roomCount}</strong>
            </div>
            <div>
              <span>Đã chốt đủ</span>
              <strong style={{ color: "#027a48" }}>{data.summary.completedRoomCount}</strong>
            </div>
            <div>
              <span>Chờ chốt số</span>
              <strong style={{ color: data.summary.pendingRoomCount > 0 ? "#b54708" : "inherit" }}>
                {data.summary.pendingRoomCount}
              </strong>
            </div>
            <div>
              <span>Thiếu đồng hồ</span>
              <strong style={{ color: data.summary.missingMeterRoomCount > 0 ? "#b42318" : "inherit" }}>
                {data.summary.missingMeterRoomCount}
              </strong>
            </div>
          </section>

          {/* Property Cards List */}
          <section className="panel" style={{ marginTop: 16 }}>
            <div className="asset-section-heading">
              <div>
                <span className="eyebrow">PROPERTIES</span>
                <h2>Cơ sở quản lý ({data.properties.length})</h2>
              </div>
              <span className="inline-note">Nhấp vào một cơ sở để nhập số hoặc tạo kỳ hóa đơn</span>
            </div>

            <div className="billing-cycle-list">
              {data.properties.map((property) => {
                const isSelected = property.id === selectedPropertyId;
                return (
                  <article
                    className="billing-cycle-card"
                    key={property.id}
                    onClick={() => setSelectedPropertyId(property.id)}
                    style={{
                      cursor: "pointer",
                      border: isSelected ? "2px solid var(--color-primary)" : undefined,
                      boxShadow: isSelected ? "0 4px 12px rgba(36, 87, 230, 0.12)" : undefined
                    }}
                  >
                    <div className="billing-cycle-card__heading">
                      <div>
                        <span className="eyebrow">{property.code}</span>
                        <h3>{property.name}</h3>
                        <p>
                          {property.completedRoomCount}/{property.roomCount} phòng đã chốt đủ chỉ số
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

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                      {property.missingMeterRoomCount > 0 ? (
                        <small style={{ color: "#b54708", fontWeight: 600 }}>
                          {property.missingMeterRoomCount} phòng chưa đủ đồng hồ
                        </small>
                      ) : <span />}

                      <button
                        className="secondary-button"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openBillingModal(property);
                        }}
                        style={{ fontSize: 12, padding: "5px 10px" }}
                      >
                        <CalculatorOutlined /> Tạo kỳ hóa đơn & Tính tiền
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* Active Property Room Checklist & Meter Entry Table */}
          {activeProperty ? (
            <section className="panel" style={{ marginTop: 24 }}>
              <div className="asset-section-heading">
                <div>
                  <span className="eyebrow">CHỐT SỐ CHI TIẾT · {activeProperty.code}</span>
                  <h2>{activeProperty.name} ({filteredRooms.length}/{activeProperty.rooms.length} phòng)</h2>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => openBillingModal(activeProperty)}
                  >
                    <CalculatorOutlined /> Tính tiền phòng cơ sở này
                  </button>
                </div>
              </div>

              {/* Toolbar: Search & Filters */}
              <div className="metering-toolbar">
                <div className="metering-toolbar__filters">
                  <div className="metering-toolbar__search">
                    <SearchOutlined className="metering-toolbar__search-icon" />
                    <input
                      type="text"
                      placeholder="Tìm số phòng, tên phòng…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>

                  {availableFloors.length > 0 ? (
                    <select
                      value={floorFilter}
                      onChange={(e) => setFloorFilter(e.target.value)}
                      style={{
                        height: 36,
                        padding: "0 10px",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 13,
                        background: "#fff"
                      }}
                    >
                      <option value="ALL">Tất cả tầng</option>
                      {availableFloors.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  ) : null}

                  <button
                    className={`secondary-button ${statusFilter === "ALL" ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setStatusFilter("ALL")}
                    style={statusFilter === "ALL" ? { background: "var(--color-primary-soft)", borderColor: "var(--color-primary)" } : {}}
                  >
                    Tất cả ({activeProperty.roomCount})
                  </button>
                  <button
                    className={`secondary-button ${statusFilter === "PENDING" ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setStatusFilter("PENDING")}
                    style={statusFilter === "PENDING" ? { background: "#fef0c7", borderColor: "#f79009" } : {}}
                  >
                    Chưa chốt ({activeProperty.pendingRoomCount})
                  </button>
                  <button
                    className={`secondary-button ${statusFilter === "COMPLETED" ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setStatusFilter("COMPLETED")}
                    style={statusFilter === "COMPLETED" ? { background: "#e6f4f1", borderColor: "#039855" } : {}}
                  >
                    Đã xong ({activeProperty.completedRoomCount})
                  </button>
                  {activeProperty.missingMeterRoomCount > 0 ? (
                    <button
                      className={`secondary-button ${statusFilter === "MISSING_METER" ? "is-active" : ""}`}
                      type="button"
                      onClick={() => setStatusFilter("MISSING_METER")}
                      style={statusFilter === "MISSING_METER" ? { background: "#fee4e2", borderColor: "#d92d20" } : {}}
                    >
                      Thiếu đồng hồ ({activeProperty.missingMeterRoomCount})
                    </button>
                  ) : null}
                </div>

                {dirtyRoomsCount > 0 ? (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void batchSaveAll()}
                    disabled={batchSaving}
                    style={{ background: "#027a48", borderColor: "#027a48" }}
                  >
                    <SaveOutlined /> {batchSaving ? "Đang lưu…" : `Lưu tất cả (${dirtyRoomsCount} phòng)`}
                  </button>
                ) : null}
              </div>

              {dirtyRoomsCount > 0 ? (
                <div className="metering-batch-banner">
                  <div>
                    <strong>Có {dirtyRoomsCount} phòng đang có chỉ số thay đổi chưa lưu trên hệ thống.</strong>
                    <div>Bạn có thể bấm &quot;Lưu tất cả&quot; hoặc bấm &quot;Lưu&quot; riêng từng phòng.</div>
                  </div>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void batchSaveAll()}
                    disabled={batchSaving}
                    style={{ background: "#027a48", borderColor: "#027a48" }}
                  >
                    <SaveOutlined /> {batchSaving ? "Đang lưu…" : "Lưu tất cả thay đổi"}
                  </button>
                </div>
              ) : null}

              {/* Table */}
              <div className="metering-table-container">
                <table className="metering-table">
                  <thead>
                    <tr>
                      <th style={{ width: "16%" }}>Phòng / Tầng</th>
                      <th style={{ width: "30%" }}>
                        <ThunderboltOutlined style={{ color: "#d97706" }} /> Điện (kWh)
                      </th>
                      <th style={{ width: "30%" }}>Nước (m³)</th>
                      <th style={{ width: "12%" }}>Trạng thái</th>
                      <th style={{ width: "12%", textAlign: "right" }}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRooms.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", padding: 30, color: "var(--color-text-muted)" }}>
                          Không có phòng nào khớp với bộ lọc.
                        </td>
                      </tr>
                    ) : (
                      filteredRooms.map((room) => {
                        const elecVal = getEffectiveValue(room, "electricity");
                        const waterVal = getEffectiveValue(room, "water");
                        const isSaving = savingRoomId === room.id;
                        const isDirty = draftValues[room.id] !== undefined;

                        // Electricity usage & validation
                        const elecUsage = room.electricity
                          ? calculateUsage(elecVal, room.electricity.previousReading?.readingValue)
                          : null;
                        const elecValError = room.electricity && elecVal
                          ? validateReadingAgainstPrevious(elecVal, room.electricity.previousReading?.readingValue)
                          : null;
                        const elecWarning = room.electricity && elecVal
                          ? anomalyWarning(elecVal, room.electricity.previousReading?.readingValue, room.electricity.baselineUsage)
                          : null;

                        // Water usage & validation
                        const waterUsage = room.water
                          ? calculateUsage(waterVal, room.water.previousReading?.readingValue)
                          : null;
                        const waterValError = room.water && waterVal
                          ? validateReadingAgainstPrevious(waterVal, room.water.previousReading?.readingValue)
                          : null;
                        const waterWarning = room.water && waterVal
                          ? anomalyWarning(waterVal, room.water.previousReading?.readingValue, room.water.baselineUsage)
                          : null;

                        return (
                          <tr key={room.id}>
                            {/* Room Info */}
                            <td>
                              <div className="metering-room-cell">
                                <strong>{room.code}</strong>
                                <span>{room.floor?.name ?? "Chưa phân tầng"} · {room.name}</span>
                              </div>
                            </td>

                            {/* Electricity Input */}
                            <td>
                              {room.electricity ? (
                                <div className="metering-input-group">
                                  <span className="previous-value">
                                    Cũ: {formatMeterValue(room.electricity.previousReading?.readingValue) || "0"} kWh
                                    {room.electricity.previousReading?.readingDate ? ` (${room.electricity.previousReading.readingDate})` : ""}
                                  </span>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      className={elecValError ? "has-error" : ""}
                                      placeholder="Chỉ số mới"
                                      value={elecVal}
                                      onChange={(e) => handleDraftChange(room.id, "electricity", e.target.value)}
                                      disabled={!activeProperty.writeAllowed}
                                    />
                                    {elecUsage && !elecValError ? (
                                      <span
                                        className={`metering-delta-tag ${elecWarning ? "is-anomaly" : ""}`}
                                        title={elecWarning ?? undefined}
                                      >
                                        +{elecUsage.formatted} kWh
                                      </span>
                                    ) : null}
                                  </div>
                                  {elecValError ? (
                                    <small style={{ color: "#b42318", fontSize: 11 }}>{elecValError}</small>
                                  ) : elecWarning ? (
                                    <small style={{ color: "#b54708", fontSize: 11 }}>⚠️ {elecWarning}</small>
                                  ) : null}
                                </div>
                              ) : (
                                <Link
                                  href={`/assets/rooms/${room.id}`}
                                  style={{ color: "#b54708", fontSize: 12, textDecoration: "underline" }}
                                >
                                  Chưa có đồng hồ điện
                                </Link>
                              )}
                            </td>

                            {/* Water Input */}
                            <td>
                              {room.waterBillingMode === "WATER_PER_PERSON" ? (
                                <span className="metering-delta-tag" style={{ background: "#eef4ff", color: "#3538cd" }}>
                                  Khoán theo người
                                </span>
                              ) : room.waterBillingMode === "WATER_PER_ROOM" ? (
                                <span className="metering-delta-tag" style={{ background: "#eef4ff", color: "#3538cd" }}>
                                  Khoán theo phòng
                                </span>
                              ) : room.water ? (
                                <div className="metering-input-group">
                                  <span className="previous-value">
                                    Cũ: {formatMeterValue(room.water.previousReading?.readingValue) || "0"} m³
                                    {room.water.previousReading?.readingDate ? ` (${room.water.previousReading.readingDate})` : ""}
                                  </span>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      className={waterValError ? "has-error" : ""}
                                      placeholder="Chỉ số mới"
                                      value={waterVal}
                                      onChange={(e) => handleDraftChange(room.id, "water", e.target.value)}
                                      disabled={!activeProperty.writeAllowed}
                                    />
                                    {waterUsage && !waterValError ? (
                                      <span
                                        className={`metering-delta-tag ${waterWarning ? "is-anomaly" : ""}`}
                                        title={waterWarning ?? undefined}
                                      >
                                        +{waterUsage.formatted} m³
                                      </span>
                                    ) : null}
                                  </div>
                                  {waterValError ? (
                                    <small style={{ color: "#b42318", fontSize: 11 }}>{waterValError}</small>
                                  ) : waterWarning ? (
                                    <small style={{ color: "#b54708", fontSize: 11 }}>⚠️ {waterWarning}</small>
                                  ) : null}
                                </div>
                              ) : room.requiredMeterTypes.includes("WATER") ? (
                                <Link
                                  href={`/assets/rooms/${room.id}`}
                                  style={{ color: "#b54708", fontSize: 12, textDecoration: "underline" }}
                                >
                                  Chưa có đồng hồ nước
                                </Link>
                              ) : (
                                <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>Không áp dụng</span>
                              )}
                            </td>

                            {/* Status */}
                            <td>
                              {room.missingMeter ? (
                                <StatusBadge tone="warning">THIẾU ĐỒNG HỒ</StatusBadge>
                              ) : isDirty ? (
                                <StatusBadge tone="warning">CHƯA LƯU</StatusBadge>
                              ) : room.complete ? (
                                <StatusBadge tone="success">ĐÃ CHỐT ĐỦ</StatusBadge>
                              ) : (
                                <StatusBadge tone="neutral">CHỜ CHỐT</StatusBadge>
                              )}
                            </td>

                            {/* Actions */}
                            <td style={{ textAlign: "right" }}>
                              <button
                                className="secondary-button"
                                type="button"
                                onClick={() => void saveRoomReadings(room)}
                                disabled={!isDirty || isSaving || !activeProperty.writeAllowed}
                                style={{ fontSize: 12, padding: "5px 10px" }}
                              >
                                {isSaving ? "Đang lưu…" : "Lưu"}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {/* Billing Cycle Creation Modal / Drawer */}
          {billingProperty ? (
            <div
              style={{
                position: "fixed",
                inset: 0,
                backgroundColor: "rgba(0,0,0,0.5)",
                display: "grid",
                placeItems: "center",
                zIndex: 1000,
                padding: 16
              }}
              onClick={() => {
                if (!creatingCycle) setBillingProperty(null);
              }}
            >
              <div
                style={{
                  background: "#fff",
                  borderRadius: 16,
                  padding: 24,
                  maxWidth: 600,
                  width: "100%",
                  boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)",
                  display: "grid",
                  gap: 16
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span className="eyebrow">BILLING PREPARATION</span>
                    <h3 style={{ margin: 0, fontSize: 18 }}>
                      Tạo kỳ hóa đơn & Tính tiền: {billingProperty.name}
                    </h3>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setBillingProperty(null)}
                    disabled={creatingCycle}
                    style={{ padding: 6 }}
                  >
                    <CloseOutlined />
                  </button>
                </div>

                <p style={{ color: "var(--color-text-muted)", fontSize: 13, margin: 0 }}>
                  Hệ thống sẽ tạo kỳ hóa đơn mới cho cơ sở, tự động tính tiền phòng cùng chỉ số điện nước vừa chốt theo biểu giá chính sách đang áp dụng.
                </p>

                {billingResult ? (
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 12,
                      background: "#e6f4f1",
                      border: "1px solid #039855",
                      display: "grid",
                      gap: 12
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#027a48", fontWeight: 700 }}>
                      <CheckCircleOutlined style={{ fontSize: 20 }} />
                      Đã tạo thành công kỳ hóa đơn {billingResult.code}!
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "#1d2939" }}>
                      <li><strong>{billingResult.created}</strong> hóa đơn DRAFT đã được tạo tự động.</li>
                      <li>Hợp đồng hợp lệ: {billingResult.eligible}.</li>
                      {billingResult.reviewRequired > 0 ? (
                        <li style={{ color: "#b54708" }}>
                          Có {billingResult.reviewRequired} hóa đơn cần xem lại (thiếu chỉ số hoặc biểu giá).
                        </li>
                      ) : (
                        <li style={{ color: "#027a48" }}>Toàn bộ hóa đơn đã sẵn sàng (READY) để chốt và gửi người thuê.</li>
                      )}
                    </ul>

                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <Link
                        href={`/billing/cycles/${billingResult.cycleId}`}
                        className="primary-button"
                        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                      >
                        Xem chi tiết kỳ hóa đơn <ArrowRightOutlined />
                      </Link>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => setBillingProperty(null)}
                      >
                        Đóng
                      </button>
                    </div>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void createBillingCycleAndDrafts();
                    }}
                    style={{ display: "grid", gap: 14 }}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <label style={{ display: "grid", gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)" }}>
                          TỪ NGÀY (BẮT ĐẦU KỲ)
                        </span>
                        <DateInput
                          value={periodStart}
                          onChange={(e) => setPeriodStart(e.target.value)}
                        />
                      </label>

                      <label style={{ display: "grid", gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)" }}>
                          ĐẾN NGÀY (CHỐT SỐ ĐIỆN NƯỚC)
                        </span>
                        <DateInput
                          value={periodEnd}
                          onChange={(e) => setPeriodEnd(e.target.value)}
                        />
                      </label>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <label style={{ display: "grid", gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)" }}>
                          MÃ KỲ HÓA ĐƠN
                        </span>
                        <input
                          type="text"
                          value={cycleCode}
                          onChange={(e) => setCycleCode(e.target.value)}
                          required
                          style={{
                            height: 38,
                            padding: "0 10px",
                            border: "1px solid var(--color-border)",
                            borderRadius: 8,
                            fontSize: 13
                          }}
                        />
                      </label>

                      <label style={{ display: "grid", gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)" }}>
                          HẠN NỘP TIỀN
                        </span>
                        <DateInput
                          value={dueDate}
                          onChange={(e) => setDueDate(e.target.value)}
                        />
                      </label>
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => setBillingProperty(null)}
                        disabled={creatingCycle}
                      >
                        Hủy
                      </button>
                      <button
                        className="primary-button"
                        type="submit"
                        disabled={creatingCycle || !cycleCode || !periodStart || !periodEnd}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                      >
                        <CalculatorOutlined /> {creatingCycle ? "Đang tính toán…" : "Tạo kỳ & Tính tiền phòng ngay"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}
    </AdminShell>
  );
}
