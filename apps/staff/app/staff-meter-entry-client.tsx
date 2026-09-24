"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import { ProgressBar, StatusBadge } from "@propops/ui";
import {
  StaffMeteringApiError,
  staffMeteringApi,
  type MeterChecklist,
  type StaffMeteringChecklistResponse,
  type StaffPropertyChecklist,
  type StaffRoomChecklist
} from "../lib/staff-metering-api";
import {
  cacheChecklist,
  getCachedChecklist,
  listLocalReadings,
  putLocalReading,
  recoverInterruptedSync,
  type LocalMeterReading
} from "../lib/meter-reading-store";
import {
  anomalyWarning,
  normalizeMeterInput,
  validateAgainstPrevious
} from "../lib/meter-entry-domain";
import { useStaffAuth } from "../components/staff-auth-provider";

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function statusMeta(status: LocalMeterReading["status"]) {
  switch (status) {
    case "PENDING_SYNC":
      return { label: "CHỜ ĐỒNG BỘ", tone: "warning" as const };
    case "SYNCING":
      return { label: "ĐANG ĐỒNG BỘ", tone: "info" as const };
    case "SYNCED":
      return { label: "ĐÃ ĐỒNG BỘ", tone: "success" as const };
    case "CONFLICT":
      return { label: "XUNG ĐỘT", tone: "danger" as const };
    case "FAILED":
      return { label: "ĐỒNG BỘ LỖI", tone: "danger" as const };
    default:
      return { label: "BẢN NHÁP", tone: "neutral" as const };
  }
}

function meterLabel(meter: MeterChecklist) {
  return meter.meterType === "ELECTRICITY" ? "Điện mới" : "Nước mới";
}

function unitLabel(meter: MeterChecklist) {
  return meter.unit === "KWH" ? "kWh" : "m³";
}

function meterLocal(
  localReadings: LocalMeterReading[],
  meter: MeterChecklist | null
) {
  if (!meter) return null;
  return localReadings.find((reading) => reading.meterId === meter.id) ?? null;
}

function effectiveMeterValue(
  localReadings: LocalMeterReading[],
  meter: MeterChecklist | null
) {
  if (!meter) return "";
  const local = meterLocal(localReadings, meter);
  return local?.readingValue ?? meter.currentReading?.readingValue ?? "";
}

function meterDone(
  localReadings: LocalMeterReading[],
  meter: MeterChecklist | null
) {
  if (!meter) return false;
  if (meter.currentReading) return true;
  const local = meterLocal(localReadings, meter);
  return local !== null && local.status !== "DRAFT";
}

function roomDone(
  localReadings: LocalMeterReading[],
  room: StaffRoomChecklist
) {
  return (
    room.electricity !== null &&
    room.water !== null &&
    meterDone(localReadings, room.electricity) &&
    meterDone(localReadings, room.water)
  );
}

function roomHasConflict(
  localReadings: LocalMeterReading[],
  room: StaffRoomChecklist
) {
  return [room.electricity, room.water].some((meter) => {
    const local = meterLocal(localReadings, meter);
    return local?.status === "CONFLICT";
  });
}

function MeterInput({
  meter,
  value,
  onChange,
  inputRef,
  onEnter,
  local
}: {
  meter: MeterChecklist;
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onEnter: () => void;
  local: LocalMeterReading | null;
}) {
  const previous = meter.previousReading?.readingValue ?? null;
  const normalized = value ? normalizeMeterInput(value) : null;
  const validation =
    normalized === null && value
      ? "Nhập số không âm, tối đa 3 chữ số thập phân."
      : normalized
        ? validateAgainstPrevious(normalized, previous)
        : null;
  const warning =
    normalized && !validation
      ? anomalyWarning(normalized, previous, meter.baselineUsage)
      : null;
  const serverLocked = meter.currentReading !== null && local === null;
  const meta = local ? statusMeta(local.status) : null;

  return (
    <label className="meter-field">
      <span>
        <strong>{meterLabel(meter)}</strong>
        <small>
          {meter.previousReading
            ? "Cũ: " +
              meter.previousReading.readingValue +
              " " +
              unitLabel(meter)
            : "Chưa có chỉ số cũ"}
        </small>
      </span>
      <input
        ref={inputRef}
        inputMode="decimal"
        aria-label={meterLabel(meter)}
        value={value}
        readOnly={serverLocked}
        placeholder="Nhập chỉ số"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onEnter();
          }
        }}
      />
      {serverLocked ? (
        <span className="meter-help meter-help--success">
          Đã có số server cho ngày chốt này.
        </span>
      ) : null}
      {meta ? (
        <span className={"meter-help meter-help--" + meta.tone}>{meta.label}</span>
      ) : null}
      {validation ? (
        <span className="meter-help meter-help--danger">{validation}</span>
      ) : warning ? (
        <span className="meter-help meter-help--warning">{warning}</span>
      ) : null}
    </label>
  );
}

export function StaffMeterEntryClient() {
  const auth = useStaffAuth();
  const actorUserId = auth.session?.user.id ?? "";
  const authOrganizationId =
    auth.selectedMembership?.organizationId ?? "";

  const [readingDate, setReadingDate] = useState(todayIso);
  const [checklist, setChecklist] =
    useState<StaffMeteringChecklistResponse | null>(null);
  const [localReadings, setLocalReadings] = useState<LocalMeterReading[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [activeRoomId, setActiveRoomId] = useState("");
  const [electricityValue, setElectricityValue] = useState("");
  const [waterValue, setWaterValue] = useState("");
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const electricityRef = useRef<HTMLInputElement>(null);
  const waterRef = useRef<HTMLInputElement>(null);
  const syncQueueRef = useRef<() => Promise<void>>(async () => {});
  const autoSyncSignatureRef = useRef("");

  const refreshLocal = useCallback(
    async (organizationId: string, date = readingDate) => {
      const rows = await listLocalReadings(
        actorUserId,
        organizationId,
        date
      );
      setLocalReadings(rows);
      return rows;
    },
    [actorUserId, readingDate]
  );

  const loadChecklist = useCallback(
    async (date = readingDate) => {
      setLoading(true);
      setError(null);
      let loaded: StaffMeteringChecklistResponse | null = null;

      if (typeof navigator !== "undefined" && navigator.onLine) {
        try {
          loaded = await staffMeteringApi.checklist(date);
          await cacheChecklist(loaded, actorUserId);
        } catch (loadError) {
          if (
            loadError instanceof StaffMeteringApiError &&
            loadError.status !== 0
          ) {
            setError(loadError.message);
          }
        }
      }

      if (!loaded) {
        if (actorUserId && authOrganizationId) {
          loaded = await getCachedChecklist(
            actorUserId,
            authOrganizationId,
            date
          );
        }
      }

      if (!loaded) {
        setChecklist(null);
        setLoading(false);
        setError(
          "Chưa có checklist đã lưu trên máy. Kết nối mạng một lần để tải phạm vi được giao."
        );
        return;
      }

      setChecklist(loaded);
      setSelectedPropertyId((current) => {
        if (loaded?.properties.some((property) => property.id === current)) {
          return current;
        }
        return loaded?.properties[0]?.id ?? "";
      });
      await recoverInterruptedSync(
        actorUserId,
        loaded.organization.id,
        date
      );
      await refreshLocal(loaded.organization.id, date);
      setLoading(false);
    },
    [
      actorUserId,
      authOrganizationId,
      readingDate,
      refreshLocal
    ]
  );

  useEffect(() => {
    setOnline(navigator.onLine);
    void loadChecklist(readingDate);

    const handleOnline = () => {
      setOnline(true);
      autoSyncSignatureRef.current = "";
      setNotice("Đã có mạng. Hệ thống sẽ thử đồng bộ hàng chờ.");
      queueMicrotask(() => void syncQueueRef.current());
    };
    const handleOffline = () => {
      setOnline(false);
      autoSyncSignatureRef.current = "";
      setNotice("Đang offline. Số đã nhập vẫn được giữ trên máy.");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadChecklist, readingDate]);

  const selectedProperty = useMemo<StaffPropertyChecklist | null>(
    () =>
      checklist?.properties.find(
        (property) => property.id === selectedPropertyId
      ) ?? null,
    [checklist, selectedPropertyId]
  );

  const activeRoom = useMemo<StaffRoomChecklist | null>(
    () =>
      selectedProperty?.rooms.find((room) => room.id === activeRoomId) ?? null,
    [selectedProperty, activeRoomId]
  );

  useEffect(() => {
    if (!selectedProperty || selectedProperty.rooms.length === 0) {
      setActiveRoomId("");
      return;
    }
    if (selectedProperty.rooms.some((room) => room.id === activeRoomId)) {
      return;
    }
    const next =
      selectedProperty.rooms.find(
        (room) => !roomDone(localReadings, room) && !room.missingMeter
      ) ?? selectedProperty.rooms[0]!;
    setActiveRoomId(next.id);
  }, [selectedProperty, activeRoomId, localReadings]);

  useEffect(() => {
    if (!activeRoom) {
      setElectricityValue("");
      setWaterValue("");
      return;
    }
    setElectricityValue(
      effectiveMeterValue(localReadings, activeRoom.electricity)
    );
    setWaterValue(effectiveMeterValue(localReadings, activeRoom.water));
    queueMicrotask(() => electricityRef.current?.focus());
  }, [activeRoom, localReadings]);

  const syncQueue = useCallback(async () => {
    if (!checklist || !navigator.onLine || syncing) return;
    setSyncing(true);
    setError(null);

    try {
      const organizationId = checklist.organization.id;
      let rows = await listLocalReadings(
        actorUserId,
        organizationId,
        readingDate
      );
      const pending = rows.filter((row) => row.status === "PENDING_SYNC");

      for (const row of pending) {
        const syncingRow: LocalMeterReading = {
          ...row,
          status: "SYNCING",
          attemptCount: row.attemptCount + 1,
          lastError: null,
          updatedAt: new Date().toISOString()
        };
        await putLocalReading(syncingRow);

        try {
          await staffMeteringApi.addReading(row.meterId, {
            id: row.id,
            readingDate: row.readingDate,
            readingValue: row.readingValue
          });
          await putLocalReading({
            ...syncingRow,
            status: "SYNCED",
            conflictCode: null,
            serverReading: null,
            updatedAt: new Date().toISOString()
          });
        } catch (syncError) {
          if (
            syncError instanceof StaffMeteringApiError &&
            syncError.status === 409 &&
            (syncError.code === "METER_READING_DATE_CONFLICT" ||
              syncError.code === "METER_READING_ID_CONFLICT")
          ) {
            await putLocalReading({
              ...syncingRow,
              status: "CONFLICT",
              lastError: syncError.message,
              conflictCode: syncError.code,
              serverReading: syncError.serverReading,
              updatedAt: new Date().toISOString()
            });
          } else if (
            syncError instanceof StaffMeteringApiError &&
            syncError.status === 0
          ) {
            await putLocalReading({
              ...syncingRow,
              status: "PENDING_SYNC",
              lastError: syncError.message,
              updatedAt: new Date().toISOString()
            });
            break;
          } else {
            await putLocalReading({
              ...syncingRow,
              status: "FAILED",
              lastError:
                syncError instanceof Error
                  ? syncError.message
                  : "Đồng bộ thất bại.",
              updatedAt: new Date().toISOString()
            });
          }
        }
      }

      rows = await refreshLocal(organizationId);
      const remaining = rows.filter(
        (row) =>
          row.status === "PENDING_SYNC" ||
          row.status === "FAILED" ||
          row.status === "CONFLICT"
      ).length;
      if (remaining === 0) {
        setNotice("Tất cả chỉ số trên máy đã được đồng bộ.");
        const fresh = await staffMeteringApi.checklist(readingDate);
        await cacheChecklist(fresh, actorUserId);
        setChecklist(fresh);
      }
    } finally {
      setSyncing(false);
    }
  }, [
    actorUserId,
    checklist,
    readingDate,
    refreshLocal,
    syncing
  ]);

  useEffect(() => {
    syncQueueRef.current = syncQueue;
  }, [syncQueue]);

  useEffect(() => {
    if (!online || syncing) return;
    const pendingIds = localReadings
      .filter((reading) => reading.status === "PENDING_SYNC")
      .map((reading) => reading.id)
      .sort();
    const signature = pendingIds.join("|");
    if (!signature) {
      autoSyncSignatureRef.current = "";
      return;
    }
    if (signature === autoSyncSignatureRef.current) return;
    autoSyncSignatureRef.current = signature;
    void syncQueue();
  }, [online, localReadings, syncQueue, syncing]);

  async function saveRoom(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!checklist || !selectedProperty || !activeRoom) return;
    setError(null);
    setNotice(null);

    if (!selectedProperty.writeAllowed) {
      setError("Bạn không có quyền ghi chỉ số tại cơ sở này.");
      return;
    }
    if (!activeRoom.electricity || !activeRoom.water) {
      setError("Phòng chưa đủ đồng hồ điện/nước. Cần Admin cấu hình trước.");
      return;
    }

    const inputs = [
      {
        meter: activeRoom.electricity,
        raw: electricityValue
      },
      {
        meter: activeRoom.water,
        raw: waterValue
      }
    ];

    const prepared: Array<{ meter: MeterChecklist; value: string }> = [];
    for (const item of inputs) {
      if (item.meter.currentReading && !meterLocal(localReadings, item.meter)) {
        continue;
      }
      const value = normalizeMeterInput(item.raw);
      if (!value) {
        setError("Nhập đủ chỉ số điện và nước, tối đa 3 chữ số thập phân.");
        return;
      }
      const validation = validateAgainstPrevious(
        value,
        item.meter.previousReading?.readingValue ?? null
      );
      if (validation) {
        setError(validation);
        return;
      }
      prepared.push({ meter: item.meter, value });
    }

    for (const item of prepared) {
      const existing = meterLocal(localReadings, item.meter);
      if (existing?.status === "CONFLICT") {
        setError(
          "Phòng đang có xung đột với số server. Xử lý conflict trước khi nhập lại."
        );
        return;
      }
      await putLocalReading({
        id: existing?.id ?? crypto.randomUUID(),
        actorUserId,
        organizationId: checklist.organization.id,
        readingDate,
        propertyId: selectedProperty.id,
        roomId: activeRoom.id,
        roomCode: activeRoom.code,
        meterId: item.meter.id,
        meterType: item.meter.meterType,
        readingValue: item.value,
        status: "PENDING_SYNC",
        attemptCount: existing?.attemptCount ?? 0,
        updatedAt: new Date().toISOString(),
        lastError: null,
        conflictCode: null,
        serverReading: null
      });
    }

    const freshLocal = await refreshLocal(checklist.organization.id);
    setNotice(
      online
        ? "Đã lưu trên máy. Hệ thống đang đồng bộ."
        : "Đã lưu offline trên máy. Sẽ đồng bộ khi có mạng."
    );

    const currentIndex = selectedProperty.rooms.findIndex(
      (room) => room.id === activeRoom.id
    );
    const nextRoom =
      selectedProperty.rooms
        .slice(currentIndex + 1)
        .find(
          (room) => !roomDone(freshLocal, room) && !room.missingMeter
        ) ??
      selectedProperty.rooms.find(
        (room) => !roomDone(freshLocal, room) && !room.missingMeter
      );
    if (nextRoom) setActiveRoomId(nextRoom.id);

    if (online) void syncQueue();
  }

  async function retryReading(reading: LocalMeterReading) {
    await putLocalReading({
      ...reading,
      status: "PENDING_SYNC",
      lastError: null,
      updatedAt: new Date().toISOString()
    });
    if (checklist) await refreshLocal(checklist.organization.id);
    if (online) {
      autoSyncSignatureRef.current = "";
      queueMicrotask(() => void syncQueueRef.current());
    }
  }

  async function keepServer(reading: LocalMeterReading) {
    if (!reading.serverReading) return;
    await putLocalReading({
      ...reading,
      readingValue: reading.serverReading.readingValue,
      status: "SYNCED",
      lastError: null,
      conflictCode: null,
      updatedAt: new Date().toISOString()
    });
    if (checklist) await refreshLocal(checklist.organization.id);
    setNotice("Đã giữ chỉ số hiện có trên server.");
  }

  const selectedCompleted =
    selectedProperty?.rooms.filter((room) => roomDone(localReadings, room))
      .length ?? 0;
  const pendingCount = localReadings.filter(
    (reading) =>
      reading.status === "PENDING_SYNC" || reading.status === "SYNCING"
  ).length;
  const failed = localReadings.filter((reading) => reading.status === "FAILED");
  const conflicts = localReadings.filter(
    (reading) => reading.status === "CONFLICT"
  );

  if (loading) {
    return (
      <main className="staff-page">
        <div className="staff-phone">
          <div className="staff-state">Đang tải checklist chốt số…</div>
        </div>
      </main>
    );
  }

  return (
    <main className="staff-page">
      <div className="staff-phone">
        <header className="staff-header">
          <div>
            <span className="staff-kicker">HABI STAFF · METERING</span>
            <h1>Chốt chỉ số</h1>
          </div>
          <StatusBadge tone={online ? "success" : "warning"}>
            {online ? "ONLINE" : "OFFLINE"}
          </StatusBadge>
        </header>

        <section className="staff-session-strip">
          <div>
            <span className="staff-kicker">WORKSPACE</span>
            <select
              aria-label="Chọn workspace Staff"
              value={auth.selectedMembership?.organizationId ?? ""}
              onChange={(event) =>
                auth.switchOrganization(event.target.value)
              }
            >
              {auth.session?.memberships.map((membership) => (
                <option
                  key={membership.organizationId}
                  value={membership.organizationId}
                >
                  {membership.organizationName}
                </option>
              ))}
            </select>
            <small>
              {auth.session?.user.displayName ||
                auth.session?.user.email}
              {" · "}
              {auth.selectedMembership?.role}
            </small>
          </div>
          <button
            type="button"
            disabled={!auth.online}
            title={
              auth.online
                ? "Đăng xuất khỏi thiết bị"
                : "Cần có mạng để thu hồi phiên đăng nhập"
            }
            onClick={() => void auth.logout()}
          >
            Đăng xuất
          </button>
        </section>

        {auth.status === "offline-authenticated" ? (
          <div className="staff-state staff-state--warning">
            <strong>Phiên offline đang được dùng.</strong>
            <span>
              Có thể tiếp tục nhập. Hàng chờ chỉ sync sau khi mạng và phiên
              server được xác thực lại.
            </span>
          </div>
        ) : null}

        <section className="staff-toolbar">
          <label>
            <span>Ngày chốt</span>
            <input
              type="date"
              value={readingDate}
              onChange={(event) => {
                setReadingDate(event.target.value);
                setActiveRoomId("");
              }}
            />
          </label>
          <div className="staff-sync-summary">
            <strong>{pendingCount}</strong>
            <span>đang chờ sync</span>
          </div>
        </section>

        {error ? (
          <div className="staff-state staff-state--error">
            <strong>Chưa hoàn tất.</strong>
            <span>{error}</span>
          </div>
        ) : null}
        {notice ? (
          <div className="staff-state staff-state--success">
            <span>{notice}</span>
          </div>
        ) : null}

        {!checklist || checklist.properties.length === 0 ? (
          <div className="staff-state">
            <strong>Không có phòng trong phạm vi được giao.</strong>
            <span>Kiểm tra membership scope hoặc liên hệ Admin.</span>
          </div>
        ) : (
          <>
            <section className="staff-section">
              <div className="staff-section__title">
                <h2>Cơ sở được giao</h2>
                <span>{checklist.summary.propertyCount} cơ sở</span>
              </div>
              <div className="property-chip-row" role="list">
                {checklist.properties.map((property) => (
                  <button
                    className={
                      property.id === selectedPropertyId
                        ? "property-chip property-chip--active"
                        : "property-chip"
                    }
                    type="button"
                    key={property.id}
                    onClick={() => {
                      setSelectedPropertyId(property.id);
                      setActiveRoomId("");
                    }}
                  >
                    <strong>{property.code}</strong>
                    <span>
                      {property.completedRoomCount}/{property.roomCount} server
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {selectedProperty ? (
              <section className="staff-section">
                <div className="assignment-card">
                  <div className="assignment-card__header">
                    <div>
                      <span className="staff-kicker">{selectedProperty.code}</span>
                      <h3>{selectedProperty.name}</h3>
                    </div>
                    <strong>{selectedProperty.roomCount} phòng</strong>
                  </div>
                  <ProgressBar
                    value={selectedCompleted}
                    max={selectedProperty.roomCount}
                    label={
                      selectedCompleted +
                      " / " +
                      selectedProperty.roomCount +
                      " phòng đã nhập trên máy"
                    }
                  />
                  {selectedProperty.missingMeterRoomCount > 0 ? (
                    <span className="meter-help meter-help--warning">
                      {selectedProperty.missingMeterRoomCount} phòng chưa đủ đồng hồ
                      điện/nước.
                    </span>
                  ) : null}
                </div>
              </section>
            ) : null}

            {activeRoom && selectedProperty ? (
              <section className="staff-section">
                <div className="staff-section__title">
                  <h2>Phòng đang nhập</h2>
                  <span>
                    {selectedProperty.rooms.findIndex(
                      (room) => room.id === activeRoom.id
                    ) + 1}{" "}
                    / {selectedProperty.roomCount}
                  </span>
                </div>
                <form className="meter-card" onSubmit={saveRoom}>
                  <div className="room-title">
                    <div>
                      <span className="staff-kicker">
                        {activeRoom.floor?.name ?? "CHƯA GÁN TẦNG"}
                      </span>
                      <h3>{activeRoom.code}</h3>
                    </div>
                    <StatusBadge
                      tone={
                        roomHasConflict(localReadings, activeRoom)
                          ? "danger"
                          : roomDone(localReadings, activeRoom)
                            ? "success"
                            : activeRoom.missingMeter
                              ? "warning"
                              : "neutral"
                      }
                    >
                      {roomHasConflict(localReadings, activeRoom)
                        ? "XUNG ĐỘT"
                        : roomDone(localReadings, activeRoom)
                          ? "ĐÃ NHẬP"
                          : activeRoom.missingMeter
                            ? "THIẾU ĐỒNG HỒ"
                            : "CHƯA CHỐT"}
                    </StatusBadge>
                  </div>

                  {activeRoom.missingMeter ? (
                    <div className="staff-state staff-state--warning">
                      <strong>Chưa thể nhập phòng này.</strong>
                      <span>
                        Admin cần cấu hình đủ đồng hồ điện và nước đang hoạt động.
                      </span>
                    </div>
                  ) : (
                    <>
                      <MeterInput
                        meter={activeRoom.electricity!}
                        value={electricityValue}
                        onChange={setElectricityValue}
                        inputRef={electricityRef}
                        onEnter={() => waterRef.current?.focus()}
                        local={meterLocal(
                          localReadings,
                          activeRoom.electricity
                        )}
                      />
                      <MeterInput
                        meter={activeRoom.water!}
                        value={waterValue}
                        onChange={setWaterValue}
                        inputRef={waterRef}
                        onEnter={() => void saveRoom()}
                        local={meterLocal(localReadings, activeRoom.water)}
                      />
                      <button
                        className="primary-action"
                        type="submit"
                        disabled={!selectedProperty.writeAllowed}
                      >
                        Lưu trên máy & phòng tiếp theo →
                      </button>
                    </>
                  )}
                </form>

                <div className="room-strip" aria-label="Danh sách phòng">
                  {selectedProperty.rooms.map((room) => (
                    <button
                      key={room.id}
                      type="button"
                      className={
                        room.id === activeRoom.id
                          ? "room-pill room-pill--active"
                          : "room-pill"
                      }
                      onClick={() => setActiveRoomId(room.id)}
                    >
                      <span>{room.code}</span>
                      <small>
                        {roomHasConflict(localReadings, room)
                          ? "!"
                          : room.missingMeter
                            ? "?"
                            : roomDone(localReadings, room)
                              ? "✓"
                              : "•"}
                      </small>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}

        <section className="staff-section">
          <div className="staff-section__title">
            <h2>Đồng bộ</h2>
            <span>
              {conflicts.length} conflict · {failed.length} lỗi
            </span>
          </div>
          <button
            className="secondary-action"
            type="button"
            disabled={!online || syncing || pendingCount === 0}
            onClick={() => void syncQueue()}
          >
            {syncing ? "Đang đồng bộ…" : "Đồng bộ ngay"}
          </button>

          {conflicts.map((reading) => (
            <article className="sync-issue-card" key={reading.id}>
              <StatusBadge tone="danger">CONFLICT</StatusBadge>
              <strong>
                Phòng {reading.roomCode} ·{" "}
                {reading.meterType === "ELECTRICITY" ? "điện" : "nước"}
              </strong>
              <p>
                Local: {reading.readingValue} · Server:{" "}
                {reading.serverReading?.readingValue ?? "không rõ"}
              </p>
              <p>
                Không overwrite tự động. Nếu số local mới là số đúng, giữ conflict
                để Admin xử lý correction; nếu server đúng, chọn bên dưới.
              </p>
              {reading.serverReading ? (
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => void keepServer(reading)}
                >
                  Giữ số server
                </button>
              ) : null}
            </article>
          ))}

          {failed.map((reading) => (
            <article className="sync-issue-card" key={reading.id}>
              <StatusBadge tone="danger">FAILED</StatusBadge>
              <strong>
                Phòng {reading.roomCode} ·{" "}
                {reading.meterType === "ELECTRICITY" ? "điện" : "nước"}
              </strong>
              <p>{reading.lastError ?? "Đồng bộ thất bại."}</p>
              <button
                className="secondary-action"
                type="button"
                onClick={() => void retryReading(reading)}
              >
                Đưa lại vào hàng chờ
              </button>
            </article>
          ))}
        </section>

        <aside className="sync-note">
          <span aria-hidden="true">●</span>
          <div>
            <strong>
              {online
                ? "Online · dữ liệu luôn lưu local trước khi gửi."
                : "Offline · tiếp tục nhập bình thường."}
            </strong>
            <p>
              Refresh hoặc đóng app không làm mất số chưa sync. Client UUID được
              giữ nguyên khi retry để server xử lý idempotent.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
