"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlusOutlined,
  SwapOutlined
} from "@ant-design/icons";
import { MetricCard, MoneyDisplay, StatusBadge, formatDateVi } from "@propops/ui";
import { DateInput } from "@propops/ui/date-input";
import {
  adminReservationsApi,
  type RoomReservation
} from "../../lib/admin-leases-api";
import {
  adminAssetsApi,
  type AdminPropertyDetail
} from "../../lib/admin-assets-api";

function reservationStatusMeta(status: RoomReservation["status"]) {
  switch (status) {
    case "ACTIVE":
      return { label: "ĐANG GIỮ CHỖ", tone: "success" as const };
    case "CONVERTED_TO_LEASE":
      return { label: "ĐÃ LẬP HỢP ĐỒNG", tone: "info" as const };
    case "CANCELLED_REFUNDED":
      return { label: "ĐÃ HOÀN CỌC", tone: "warning" as const };
    case "CANCELLED_FORFEITED":
      return { label: "TỊCH THU CỌC", tone: "neutral" as const };
    case "EXPIRED":
      return { label: "ĐÃ HẾT HẠN", tone: "neutral" as const };
    default:
      return { label: status, tone: "neutral" as const };
  }
}

export type ReservationsTabProps = {
  properties: Array<{ id: string; name: string }>;
  activePropertyId: string;
};

export function ReservationsTab({ properties, activePropertyId }: ReservationsTabProps) {
  const router = useRouter();
  const [reservations, setReservations] = useState<RoomReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Create Modal State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createPropertyId, setCreatePropertyId] = useState("");
  const [createRoomId, setCreateRoomId] = useState("");
  const [propertyRooms, setPropertyRooms] = useState<Array<{ id: string; code: string; name: string; occupancy: string }>>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [savingReservation, setSavingReservation] = useState(false);

  // Form Fields
  const [formTenantName, setFormTenantName] = useState("");
  const [formTenantPhone, setFormTenantPhone] = useState("");
  const [formTenantIdNumber, setFormTenantIdNumber] = useState("");
  const [formDepositVnd, setFormDepositVnd] = useState<number>(1000000);
  const [formRentVnd, setFormRentVnd] = useState<number>(3500000);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const defaultUntilStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }, []);

  const [formReservedFrom, setFormReservedFrom] = useState(todayStr);
  const [formReservedUntil, setFormReservedUntil] = useState(defaultUntilStr);
  const [formExpectedMoveIn, setFormExpectedMoveIn] = useState(defaultUntilStr);
  const [formNotes, setFormNotes] = useState("");

  // Cancel Modal State
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [targetReservation, setTargetReservation] = useState<RoomReservation | null>(null);
  const [cancelAction, setCancelAction] = useState<"REFUND" | "FORFEIT">("REFUND");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Load reservations
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminReservationsApi.list({
        propertyId: activePropertyId !== "ALL" ? activePropertyId : undefined,
        status: statusFilter !== "ALL" ? statusFilter : undefined
      });
      setReservations(res.reservations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải danh sách đặt cọc giữ chỗ.");
    } finally {
      setLoading(false);
    }
  }, [activePropertyId, statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Load rooms when createPropertyId changes
  useEffect(() => {
    if (!createPropertyId) {
      setPropertyRooms([]);
      setCreateRoomId("");
      return;
    }
    let active = true;
    setLoadingRooms(true);
    adminAssetsApi
      .property(createPropertyId)
      .then((detail: AdminPropertyDetail) => {
        if (!active) return;
        const allRooms: Array<{ id: string; code: string; name: string; occupancy: string }> = [];
        for (const floor of detail.floors) {
          for (const rm of floor.rooms) {
            allRooms.push({
              id: rm.id,
              code: rm.code,
              name: rm.name,
              occupancy: rm.occupancy
            });
          }
        }
        setPropertyRooms(allRooms);
        if (allRooms.length > 0) {
          // Default to first vacant room if available
          const firstVacant = allRooms.find((r) => r.occupancy === "VACANT");
          setCreateRoomId(firstVacant ? firstVacant.id : (allRooms[0]?.id ?? ""));
        }
      })
      .catch(() => {
        if (active) setPropertyRooms([]);
      })
      .finally(() => {
        if (active) setLoadingRooms(false);
      });

    return () => {
      active = false;
    };
  }, [createPropertyId]);

  // Open Create Modal handler
  function handleOpenCreateModal() {
    const initialPropId = activePropertyId !== "ALL" && activePropertyId ? activePropertyId : (properties[0]?.id || "");
    setCreatePropertyId(initialPropId);
    setFormTenantName("");
    setFormTenantPhone("");
    setFormTenantIdNumber("");
    setFormDepositVnd(1000000);
    setFormRentVnd(3500000);
    setFormReservedFrom(todayStr);
    setFormReservedUntil(defaultUntilStr);
    setFormExpectedMoveIn(defaultUntilStr);
    setFormNotes("");
    setFeedback(null);
    setCreateModalOpen(true);
  }

  // Submit Create Reservation
  async function handleSubmitCreate(e: FormEvent) {
    e.preventDefault();
    if (!createPropertyId) {
      setFeedback({ type: "error", message: "Vui lòng chọn cơ sở." });
      return;
    }
    if (!createRoomId) {
      setFeedback({ type: "error", message: "Vui lòng chọn phòng giữ chỗ." });
      return;
    }
    if (!formTenantName.trim() || !formTenantPhone.trim()) {
      setFeedback({ type: "error", message: "Vui lòng nhập tên và số điện thoại khách giữ chỗ." });
      return;
    }
    if (formDepositVnd <= 0) {
      setFeedback({ type: "error", message: "Số tiền đặt cọc phải lớn hơn 0 VND." });
      return;
    }
    if (!formReservedUntil) {
      setFeedback({ type: "error", message: "Vui lòng chọn ngày hết hạn giữ chỗ." });
      return;
    }

    setSavingReservation(true);
    setFeedback(null);
    try {
      await adminReservationsApi.create({
        propertyId: createPropertyId,
        roomId: createRoomId,
        prospectiveTenantName: formTenantName.trim(),
        prospectiveTenantPhone: formTenantPhone.trim(),
        prospectiveTenantIdNumber: formTenantIdNumber.trim() || undefined,
        depositAmountVnd: formDepositVnd,
        reservedFrom: formReservedFrom || undefined,
        reservedUntil: formReservedUntil,
        expectedMoveInDate: formExpectedMoveIn || undefined,
        expectedMonthlyRentVnd: formRentVnd > 0 ? formRentVnd : undefined,
        notes: formNotes.trim() || undefined
      });
      setCreateModalOpen(false);
      setFeedback({
        type: "success",
        message: `Đã tạo phiếu cọc giữ chỗ phòng thành công cho khách hàng ${formTenantName.trim()}.`
      });
      await loadData();
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Không thể tạo phiếu đặt cọc giữ chỗ."
      });
    } finally {
      setSavingReservation(false);
    }
  }

  // Convert to Lease
  async function handleConvertToLease(res: RoomReservation) {
    const confirmed = window.confirm(
      `Chuyển cọc giữ chỗ phòng ${res.roomCode} của khách ${res.prospectiveTenantName} thành Hợp đồng thuê?\n` +
      `Số tiền cọc: ${res.depositAmountVnd.toLocaleString("vi-VN")} VND sẽ được ghi nhận vào hợp đồng.`
    );
    if (!confirmed) return;

    setFeedback(null);
    try {
      await adminReservationsApi.convertToLease(res.id);
      setFeedback({
        type: "success",
        message: `Đã chuyển đổi cọc thành công! Đang chuyển tới trang tạo hợp đồng...`
      });
      await loadData();
      router.push(
        `/leases/new?roomId=${encodeURIComponent(res.roomId)}&depositRequiredVnd=${res.depositAmountVnd}&baseRentVnd=${res.expectedMonthlyRentVnd || ""}`
      );
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Không thể chuyển cọc giữ chỗ thành hợp đồng."
      });
    }
  }

  // Open Cancel Modal
  function handleOpenCancelModal(res: RoomReservation) {
    setTargetReservation(res);
    setCancelAction("REFUND");
    setCancelReason("");
    setCancelModalOpen(true);
    setFeedback(null);
  }

  // Submit Cancel Reservation
  async function handleSubmitCancel(e: FormEvent) {
    e.preventDefault();
    if (!targetReservation) return;

    setCancelling(true);
    setFeedback(null);
    try {
      await adminReservationsApi.cancel(targetReservation.id, {
        action: cancelAction,
        reason: cancelReason.trim() || undefined
      });
      setCancelModalOpen(false);
      setFeedback({
        type: "success",
        message:
          cancelAction === "REFUND"
            ? `Đã hoàn cọc ${targetReservation.depositAmountVnd.toLocaleString("vi-VN")} VND cho khách ${targetReservation.prospectiveTenantName}.`
            : `Đã ghi nhận tịch thu cọc phòng ${targetReservation.roomCode} thành công.`
      });
      await loadData();
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Không thể hủy đặt cọc."
      });
    } finally {
      setCancelling(false);
    }
  }

  // Filtered reservations
  const filteredReservations = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase("vi");
    return reservations.filter((r) => {
      if (!q) return true;
      const haystack = [
        r.prospectiveTenantName,
        r.prospectiveTenantPhone,
        r.roomCode,
        r.propertyName,
        r.prospectiveTenantIdNumber ?? "",
        r.notes ?? ""
      ]
        .join(" ")
        .toLocaleLowerCase("vi");
      return haystack.includes(q);
    });
  }, [reservations, searchQuery]);

  // Metrics summary
  const metrics = useMemo(() => {
    let activeCount = 0;
    let activeDepositTotal = 0;
    let convertedCount = 0;
    let refundedCount = 0;
    let forfeitedCount = 0;

    for (const r of reservations) {
      if (r.status === "ACTIVE") {
        activeCount++;
        activeDepositTotal += r.depositAmountVnd;
      } else if (r.status === "CONVERTED_TO_LEASE") {
        convertedCount++;
      } else if (r.status === "CANCELLED_REFUNDED") {
        refundedCount++;
      } else if (r.status === "CANCELLED_FORFEITED") {
        forfeitedCount++;
      }
    }

    return {
      activeCount,
      activeDepositTotal,
      convertedCount,
      refundedCount,
      forfeitedCount
    };
  }, [reservations]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* FEEDBACK ALERT */}
      {feedback ? (
        <div
          className={`admin-state ${
            feedback.type === "success" ? "admin-state--success" : "admin-state--error"
          }`}
        >
          <strong>{feedback.type === "success" ? "Thành công:" : "Lỗi:"}</strong>
          <span>{feedback.message}</span>
        </div>
      ) : null}

      {/* METRIC CARDS */}
      <section className="metrics-grid" aria-label="Tình trạng đặt cọc giữ chỗ">
        <MetricCard
          label="Đang giữ chỗ"
          value={String(metrics.activeCount)}
          detail={`Tổng cọc giữ: ${metrics.activeDepositTotal.toLocaleString("vi-VN")} đ`}
          tone="success"
        />
        <MetricCard
          label="Đã chuyển hợp đồng"
          value={String(metrics.convertedCount)}
          detail="Khách đã ký HĐ và vào ở"
          tone="info"
        />
        <MetricCard
          label="Đã hoàn cọc"
          value={String(metrics.refundedCount)}
          detail="Hoàn tiền trả lại khách"
          tone="warning"
        />
        <MetricCard
          label="Tịch thu cọc"
          value={String(metrics.forfeitedCount)}
          detail="Khách hủy cọc / không vào ở"
          tone="neutral"
        />
      </section>

      {/* TOOLBAR & CONTROLS */}
      <section className="panel">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
            marginBottom: "16px"
          }}
        >
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <div className="lease-search">
              <label htmlFor="reservation-search">Tìm kiếm</label>
              <input
                id="reservation-search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tên khách, SĐT, số phòng..."
              />
            </div>

            <label className="compact-field">
              <span>Trạng thái</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="ALL">Tất cả trạng thái</option>
                <option value="ACTIVE">Đang giữ chỗ (Active)</option>
                <option value="CONVERTED_TO_LEASE">Đã lập hợp đồng</option>
                <option value="CANCELLED_REFUNDED">Đã hoàn cọc</option>
                <option value="CANCELLED_FORFEITED">Tịch thu cọc</option>
                <option value="EXPIRED">Đã hết hạn</option>
              </select>
            </label>
          </div>

          <button
            type="button"
            className="primary-button"
            onClick={handleOpenCreateModal}
          >
            <PlusOutlined aria-hidden="true" /> + Đặt cọc giữ chỗ
          </button>
        </div>

        {/* RESERVATIONS TABLE */}
        {error ? (
          <div className="admin-state admin-state--error">
            <strong>Không thể tải danh sách cọc:</strong>
            <span>{error}</span>
            <button className="secondary-button" type="button" onClick={() => void loadData()}>
              Thử lại
            </button>
          </div>
        ) : loading ? (
          <div className="admin-state">Đang tải danh sách đặt cọc giữ chỗ…</div>
        ) : filteredReservations.length === 0 ? (
          <div className="admin-state">
            <strong>Không tìm thấy phiếu giữ chỗ nào.</strong>
            <span>Khách hàng có thể đặt cọc giữ chỗ trước khi ký hợp đồng chính thức.</span>
          </div>
        ) : (
          <div className="lease-table" role="table" aria-label="Danh sách đặt cọc giữ chỗ">
            <div className="lease-table__row lease-table__head" role="row">
              <span role="columnheader">Khách giữ chỗ</span>
              <span role="columnheader">Phòng & Cơ sở</span>
              <span role="columnheader">Tiền đặt cọc</span>
              <span role="columnheader">Thời hạn cọc</span>
              <span role="columnheader">Dự kiến dọn vào</span>
              <span role="columnheader">Trạng thái</span>
              <span role="columnheader" style={{ textAlign: "right" }}>Thao tác</span>
            </div>

            {filteredReservations.map((res) => {
              const meta = reservationStatusMeta(res.status);
              const isOverdue =
                res.status === "ACTIVE" && new Date(res.reservedUntil) < new Date();

              return (
                <div
                  className="lease-table__row"
                  role="row"
                  key={res.id}
                  style={{ textDecoration: "none", color: "inherit", cursor: "default" }}
                >
                  <span role="cell">
                    <strong>{res.prospectiveTenantName}</strong>
                    <small>SĐT: {res.prospectiveTenantPhone}</small>
                    {res.prospectiveTenantIdNumber ? (
                      <small>CCCD: {res.prospectiveTenantIdNumber}</small>
                    ) : null}
                  </span>

                  <span role="cell">
                    <strong>Phòng {res.roomCode}</strong>
                    <small>{res.propertyName}</small>
                  </span>

                  <strong role="cell" style={{ color: "var(--color-primary, #0284c7)" }}>
                    <MoneyDisplay amountVnd={res.depositAmountVnd} />
                  </strong>

                  <span role="cell">
                    <strong>Đến {formatDateVi(res.reservedUntil)}</strong>
                    <small>Từ {formatDateVi(res.reservedFrom)}</small>
                    {isOverdue ? (
                      <span style={{ color: "#ef4444", fontSize: "11px", fontWeight: 600 }}>
                        (Quá hạn cọc)
                      </span>
                    ) : null}
                  </span>

                  <span role="cell">
                    <strong>
                      {res.expectedMoveInDate ? formatDateVi(res.expectedMoveInDate) : "—"}
                    </strong>
                    {res.expectedMonthlyRentVnd ? (
                      <small>
                        Giá: {res.expectedMonthlyRentVnd.toLocaleString("vi-VN")} đ/tháng
                      </small>
                    ) : null}
                  </span>

                  <span role="cell">
                    <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                  </span>

                  <span role="cell" style={{ textAlign: "right" }}>
                    {res.status === "ACTIVE" ? (
                      <div style={{ display: "inline-flex", gap: "6px" }}>
                        <button
                          type="button"
                          className="primary-button"
                          style={{ padding: "4px 8px", fontSize: "12px" }}
                          onClick={() => void handleConvertToLease(res)}
                          title="Chuyển thành hợp đồng thuê chính thức"
                        >
                          <SwapOutlined aria-hidden="true" /> Lập HĐ
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          style={{ padding: "4px 8px", fontSize: "12px", color: "#ef4444" }}
                          onClick={() => handleOpenCancelModal(res)}
                          title="Hủy cọc (Hoàn cọc hoặc Tịch thu cọc)"
                        >
                          <CloseCircleOutlined aria-hidden="true" /> Hủy
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: "12px", color: "var(--color-text-secondary, #64748b)" }}>
                        {res.notes || "—"}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* CREATE RESERVATION MODAL */}
      {createModalOpen ? (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "16px"
          }}
        >
          <div
            className="panel"
            style={{
              width: "100%",
              maxWidth: "640px",
              maxHeight: "90vh",
              overflowY: "auto",
              background: "#ffffff",
              borderRadius: "8px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)"
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
                borderBottom: "1px solid var(--color-border)",
                paddingBottom: "12px"
              }}
            >
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>
                Đặt cọc giữ chỗ phòng trọ
              </h3>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setCreateModalOpen(false)}
                style={{ padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={(e) => void handleSubmitCreate(e)}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "16px" }}>
                <label className="compact-field">
                  <span>Cơ sở *</span>
                  <select
                    value={createPropertyId}
                    onChange={(e) => setCreatePropertyId(e.target.value)}
                    required
                  >
                    <option value="">-- Chọn cơ sở --</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="compact-field">
                  <span>Phòng giữ chỗ * {loadingRooms ? "(Đang tải…)" : ""}</span>
                  <select
                    value={createRoomId}
                    onChange={(e) => setCreateRoomId(e.target.value)}
                    required
                    disabled={!createPropertyId || loadingRooms}
                  >
                    <option value="">-- Chọn phòng --</option>
                    {propertyRooms.map((rm) => (
                      <option key={rm.id} value={rm.id}>
                        Phòng {rm.code} ({rm.occupancy === "VACANT" ? "Trống" : "Đang thuê"})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "16px" }}>
                <label className="compact-field">
                  <span>Họ và tên khách *</span>
                  <input
                    type="text"
                    value={formTenantName}
                    onChange={(e) => setFormTenantName(e.target.value)}
                    placeholder="Nguyễn Văn A"
                    required
                  />
                </label>

                <label className="compact-field">
                  <span>Số điện thoại *</span>
                  <input
                    type="tel"
                    value={formTenantPhone}
                    onChange={(e) => setFormTenantPhone(e.target.value)}
                    placeholder="0912345678"
                    required
                  />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "16px" }}>
                <label className="compact-field">
                  <span>Số CCCD / CMND</span>
                  <input
                    type="text"
                    value={formTenantIdNumber}
                    onChange={(e) => setFormTenantIdNumber(e.target.value)}
                    placeholder="001200001234 (tùy chọn)"
                  />
                </label>

                <label className="compact-field">
                  <span>Số tiền đặt cọc (VND) *</span>
                  <input
                    type="number"
                    min="10000"
                    step="50000"
                    value={formDepositVnd}
                    onChange={(e) => setFormDepositVnd(Number(e.target.value))}
                    required
                  />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "16px" }}>
                <label className="compact-field">
                  <span>Ngày cọc</span>
                  <DateInput
                    value={formReservedFrom}
                    onChange={(e) => setFormReservedFrom(e.target.value)}
                  />
                </label>

                <label className="compact-field">
                  <span>Hạn giữ chỗ đến ngày *</span>
                  <DateInput
                    value={formReservedUntil}
                    min={formReservedFrom}
                    onChange={(e) => setFormReservedUntil(e.target.value)}
                    required
                  />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "16px" }}>
                <label className="compact-field">
                  <span>Dự kiến dọn vào</span>
                  <DateInput
                    value={formExpectedMoveIn}
                    onChange={(e) => setFormExpectedMoveIn(e.target.value)}
                  />
                </label>

                <label className="compact-field">
                  <span>Giá thuê dự kiến (VND/tháng)</span>
                  <input
                    type="number"
                    min="0"
                    step="100000"
                    value={formRentVnd}
                    onChange={(e) => setFormRentVnd(Number(e.target.value))}
                  />
                </label>
              </div>

              <label className="compact-field" style={{ marginBottom: "20px" }}>
                <span>Ghi chú thỏa thuận</span>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Ví dụ: Đã nhận cọc tiền mặt 1 triệu, cam kết dọn vào trước ngày 15..."
                  style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid var(--color-border)" }}
                />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setCreateModalOpen(false)}
                  disabled={savingReservation}
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={savingReservation}
                >
                  <CheckCircleOutlined aria-hidden="true" />
                  {savingReservation ? "Đang lưu…" : "Xác nhận đặt cọc"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* CANCEL RESERVATION MODAL */}
      {cancelModalOpen && targetReservation ? (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "16px"
          }}
        >
          <div
            className="panel"
            style={{
              width: "100%",
              maxWidth: "500px",
              background: "#ffffff",
              borderRadius: "8px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)"
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
                borderBottom: "1px solid var(--color-border)",
                paddingBottom: "12px"
              }}
            >
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#ef4444" }}>
                Hủy đặt cọc giữ chỗ phòng {targetReservation.roomCode}
              </h3>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setCancelModalOpen(false)}
                style={{ padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={(e) => void handleSubmitCancel(e)}>
              <p style={{ fontSize: "14px", marginBottom: "16px" }}>
                Khách hàng: <strong>{targetReservation.prospectiveTenantName}</strong> ({targetReservation.prospectiveTenantPhone})
                <br />
                Số tiền cọc: <strong>{targetReservation.depositAmountVnd.toLocaleString("vi-VN")} đ</strong>
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>Hình thức xử lý tiền cọc:</span>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="cancelAction"
                    value="REFUND"
                    checked={cancelAction === "REFUND"}
                    onChange={() => setCancelAction("REFUND")}
                  />
                  <span>
                    <strong>Hoàn cọc lại cho khách (REFUND)</strong> — Trả lại 100% tiền cọc
                  </span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="cancelAction"
                    value="FORFEIT"
                    checked={cancelAction === "FORFEIT"}
                    onChange={() => setCancelAction("FORFEIT")}
                  />
                  <span>
                    <strong>Tịch thu cọc (FORFEIT)</strong> — Khách hủy hẹn, không hoàn lại
                  </span>
                </label>
              </div>

              <label className="compact-field" style={{ marginBottom: "20px" }}>
                <span>Lý do hủy / Ghi chú:</span>
                <textarea
                  rows={2}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Ví dụ: Khách đổi ý không thuê nữa / Đã chuyển khoản trả lại cọc qua Vietcombank..."
                  style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid var(--color-border)" }}
                />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setCancelModalOpen(false)}
                  disabled={cancelling}
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  style={{ backgroundColor: "#ef4444", borderColor: "#ef4444" }}
                  disabled={cancelling}
                >
                  {cancelling ? "Đang xử lý…" : "Xác nhận hủy cọc"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
