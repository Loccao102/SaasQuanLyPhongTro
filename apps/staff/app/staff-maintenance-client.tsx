"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  PhoneOutlined,
  PlusOutlined,
  ReloadOutlined,
  ToolOutlined,
  WarningOutlined
} from "@ant-design/icons";
import { StatusBadge } from "@propops/ui";
import {
  staffMaintenanceApi,
  type MaintenanceTicketCategory,
  type MaintenanceTicketPriority,
  type MaintenanceTicketStatus,
  type StaffMaintenanceTicket
} from "../lib/staff-maintenance-api";
import { useStaffAuth } from "../components/staff-auth-provider";

function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND"
  }).format(amount);
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString("vi-VN")} ${d.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit"
    })}`;
  } catch {
    return iso;
  }
}

const CATEGORY_LABELS: Record<MaintenanceTicketCategory, string> = {
  ELECTRICITY: "Điện",
  PLUMBING: "Nước & Đường ống",
  APPLIANCE: "Thiết bị & Đồ dùng",
  STRUCTURAL: "Kết cấu & Tường",
  INTERNET: "Mạng Internet / Wifi",
  OTHER: "Khác"
};

const PRIORITY_TONES: Record<
  MaintenanceTicketPriority,
  { label: string; tone: "danger" | "warning" | "info" | "neutral" }
> = {
  URGENT: { label: "KHẨN CẤP", tone: "danger" },
  HIGH: { label: "ƯU TIÊN CAO", tone: "warning" },
  NORMAL: { label: "BÌNH THƯỜNG", tone: "info" },
  LOW: { label: "THẤP", tone: "neutral" }
};

export function StaffMaintenanceClient() {
  const auth = useStaffAuth();
  const [tickets, setTickets] = useState<StaffMaintenanceTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Status Filter
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "OPEN" | "IN_PROGRESS" | "RESOLVED"
  >("ALL");

  // Resolving Modal state
  const [resolvingTicket, setResolvingTicket] =
    useState<StaffMaintenanceTicket | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [repairCostVnd, setRepairCostVnd] = useState("");
  const [submittingResolve, setSubmittingResolve] = useState(false);

  // Create Ticket Modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createCategory, setCreateCategory] =
    useState<MaintenanceTicketCategory>("ELECTRICITY");
  const [createPriority, setCreatePriority] =
    useState<MaintenanceTicketPriority>("NORMAL");
  const [createDescription, setCreateDescription] = useState("");
  const [createRoomName, setCreateRoomName] = useState("");
  const [createResidentName, setCreateResidentName] = useState("");
  const [createResidentPhone, setCreateResidentPhone] = useState("");
  const [submittingCreate, setSubmittingCreate] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await staffMaintenanceApi.list();
      setTickets(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Không thể tải danh sách sự cố."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const counts = useMemo(() => {
    return {
      all: tickets.length,
      open: tickets.filter((t) => t.status === "OPEN").length,
      inProgress: tickets.filter((t) => t.status === "IN_PROGRESS").length,
      resolved: tickets.filter((t) => t.status === "RESOLVED").length
    };
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    if (statusFilter === "ALL") return tickets;
    return tickets.filter((t) => t.status === statusFilter);
  }, [tickets, statusFilter]);

  async function handleTakeTicket(ticket: StaffMaintenanceTicket) {
    setError(null);
    setNotice(null);
    try {
      await staffMaintenanceApi.update(ticket.id, {
        status: "IN_PROGRESS"
      });
      setNotice(`Đã tiếp nhận xử lý sự cố "${ticket.title}".`);
      void loadTickets();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Lỗi khi tiếp nhận sự cố."
      );
    }
  }

  async function handleResolveSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!resolvingTicket) return;
    setSubmittingResolve(true);
    setError(null);
    try {
      const costNumber = parseInt(repairCostVnd.replace(/\D/g, ""), 10) || 0;
      await staffMaintenanceApi.update(resolvingTicket.id, {
        status: "RESOLVED",
        resolutionNote: resolutionNote.trim() || "Đã hoàn thành sửa chữa.",
        repairCostVnd: costNumber
      });
      setNotice(`Đã cập nhật hoàn thành sự cố "${resolvingTicket.title}".`);
      setResolvingTicket(null);
      setResolutionNote("");
      setRepairCostVnd("");
      void loadTickets();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Lỗi khi báo cáo hoàn thành sự cố."
      );
    } finally {
      setSubmittingResolve(false);
    }
  }

  async function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!createTitle.trim()) return;
    setSubmittingCreate(true);
    setError(null);
    try {
      // Find a default property from existing tickets or memberships
      const propertyId = tickets[0]?.propertyId;
      if (!propertyId) {
        throw new Error(
          "Chưa xác định được cơ sở. Vui lòng liên hệ Admin để gán cơ sở."
        );
      }
      await staffMaintenanceApi.create({
        propertyId,
        title: createTitle.trim(),
        category: createCategory,
        priority: createPriority,
        description: createDescription.trim(),
        residentName: createResidentName.trim() || undefined,
        residentPhone: createResidentPhone.trim() || undefined
      });
      setNotice(`Đã tạo yêu cầu sự cố "${createTitle}".`);
      setCreateModalOpen(false);
      setCreateTitle("");
      setCreateDescription("");
      setCreateRoomName("");
      setCreateResidentName("");
      setCreateResidentPhone("");
      void loadTickets();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Lỗi khi tạo yêu cầu sự cố."
      );
    } finally {
      setSubmittingCreate(false);
    }
  }

  return (
    <div className="staff-section" style={{ marginTop: 0 }}>
      {/* Action Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 4
        }}
      >
        <button
          className="secondary-button"
          type="button"
          onClick={() => void loadTickets()}
          disabled={loading}
          style={{
            fontSize: 12,
            padding: "6px 10px",
            display: "inline-flex",
            alignItems: "center",
            gap: 4
          }}
        >
          <ReloadOutlined /> Làm mới
        </button>

        <button
          className="primary-action"
          type="button"
          onClick={() => setCreateModalOpen(true)}
          style={{
            width: "auto",
            minHeight: 38,
            padding: "0 14px",
            fontSize: 13,
            display: "inline-flex",
            alignItems: "center",
            gap: 6
          }}
        >
          <PlusOutlined /> Báo sự cố mới
        </button>
      </div>

      {notice ? (
        <div className="staff-state staff-state--success">
          <strong>Thông báo:</strong>
          <span>{notice}</span>
        </div>
      ) : null}

      {error ? (
        <div className="staff-state staff-state--error">
          <WarningOutlined />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Filter Tabs */}
      <div className="property-chip-row" style={{ paddingBottom: 2 }}>
        <button
          className={`property-chip ${statusFilter === "ALL" ? "property-chip--active" : ""}`}
          type="button"
          onClick={() => setStatusFilter("ALL")}
        >
          <strong>Tất cả</strong>
          <span>{counts.all} yêu cầu</span>
        </button>
        <button
          className={`property-chip ${statusFilter === "OPEN" ? "property-chip--active" : ""}`}
          type="button"
          onClick={() => setStatusFilter("OPEN")}
        >
          <strong style={{ color: counts.open > 0 ? "#b54708" : "inherit" }}>
            Chờ xử lý
          </strong>
          <span>{counts.open} yêu cầu</span>
        </button>
        <button
          className={`property-chip ${statusFilter === "IN_PROGRESS" ? "property-chip--active" : ""}`}
          type="button"
          onClick={() => setStatusFilter("IN_PROGRESS")}
        >
          <strong style={{ color: "#0284c7" }}>Đang sửa</strong>
          <span>{counts.inProgress} yêu cầu</span>
        </button>
        <button
          className={`property-chip ${statusFilter === "RESOLVED" ? "property-chip--active" : ""}`}
          type="button"
          onClick={() => setStatusFilter("RESOLVED")}
        >
          <strong style={{ color: "#059669" }}>Đã xong</strong>
          <span>{counts.resolved} yêu cầu</span>
        </button>
      </div>

      {/* Ticket List */}
      {loading && tickets.length === 0 ? (
        <div className="staff-state">Đang tải danh sách sự cố…</div>
      ) : filteredTickets.length === 0 ? (
        <div className="staff-state" style={{ textAlign: "center", padding: "24px 16px" }}>
          <ToolOutlined style={{ fontSize: 28, color: "#9ca3af", marginBottom: 8 }} />
          <strong>Không có yêu cầu sự cố nào.</strong>
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Các sự cố được cư dân gửi hoặc nhân viên ghi nhận sẽ xuất hiện tại đây.
          </span>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {filteredTickets.map((ticket) => {
            const priorityInfo = PRIORITY_TONES[ticket.priority] || {
              label: ticket.priority,
              tone: "neutral" as const
            };

            return (
              <article key={ticket.id} className="maintenance-card">
                <div className="maintenance-card__top">
                  <div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 750,
                        textTransform: "uppercase",
                        color: "var(--color-text-muted)",
                        letterSpacing: "0.05em"
                      }}
                    >
                      {CATEGORY_LABELS[ticket.category] || ticket.category}
                    </span>
                    <h3 className="maintenance-card__title">{ticket.title}</h3>
                    <div className="maintenance-card__location">
                      <span>{ticket.propertyName}</span>
                      {ticket.roomCode ? (
                        <>
                          <span>·</span>
                          <strong style={{ color: "var(--color-primary)" }}>
                            Phòng {ticket.roomCode}
                          </strong>
                        </>
                      ) : (
                        <>
                          <span>·</span>
                          <span>Khu vực chung</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 4, justifyItems: "end" }}>
                    <StatusBadge
                      tone={
                        ticket.status === "OPEN"
                          ? "warning"
                          : ticket.status === "IN_PROGRESS"
                            ? "info"
                            : ticket.status === "RESOLVED"
                              ? "success"
                              : "neutral"
                      }
                    >
                      {ticket.status === "OPEN"
                        ? "CHỜ XỬ LÝ"
                        : ticket.status === "IN_PROGRESS"
                          ? "ĐANG SỬA"
                          : ticket.status === "RESOLVED"
                            ? "ĐÃ XỬ LÝ"
                            : ticket.status}
                    </StatusBadge>

                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background:
                          priorityInfo.tone === "danger"
                            ? "#fee2e2"
                            : priorityInfo.tone === "warning"
                              ? "#fef3c7"
                              : "#f0f9ff",
                        color:
                          priorityInfo.tone === "danger"
                            ? "#991b1b"
                            : priorityInfo.tone === "warning"
                              ? "#92400e"
                              : "#0369a1"
                      }}
                    >
                      {priorityInfo.label}
                    </span>
                  </div>
                </div>

                {ticket.description ? (
                  <p className="maintenance-card__desc">{ticket.description}</p>
                ) : null}

                {/* Resident info */}
                {ticket.residentName ? (
                  <div className="maintenance-card__resident">
                    <div>
                      <strong>{ticket.residentName}</strong>
                      <span style={{ color: "var(--color-text-muted)", marginLeft: 6 }}>
                        (Người báo)
                      </span>
                    </div>
                    {ticket.residentPhone ? (
                      <a
                        href={`tel:${ticket.residentPhone}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <PhoneOutlined /> {ticket.residentPhone}
                      </a>
                    ) : null}
                  </div>
                ) : null}

                {/* Resolution info if resolved */}
                {ticket.status === "RESOLVED" ? (
                  <div
                    style={{
                      padding: 10,
                      background: "#f0fdf4",
                      border: "1px solid #bbf7d0",
                      borderRadius: 8,
                      fontSize: 12,
                      display: "grid",
                      gap: 4
                    }}
                  >
                    <div style={{ color: "#166534", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                      <CheckCircleOutlined /> Đã sửa xong {ticket.resolvedAt ? `· ${formatDate(ticket.resolvedAt)}` : ""}
                    </div>
                    {ticket.resolutionNote ? (
                      <div style={{ color: "#15803d" }}>
                        <strong>Ghi chú:</strong> {ticket.resolutionNote}
                      </div>
                    ) : null}
                    {ticket.repairCostVnd > 0 ? (
                      <div style={{ color: "#15803d" }}>
                        <strong>Chi phí:</strong> {formatVnd(ticket.repairCostVnd)}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Card Actions */}
                <div className="maintenance-card__actions">
                  {ticket.status === "OPEN" ? (
                    <button
                      className="maintenance-action-btn maintenance-action-btn--primary"
                      type="button"
                      onClick={() => void handleTakeTicket(ticket)}
                    >
                      <ToolOutlined /> Tiếp nhận sửa
                    </button>
                  ) : null}

                  {ticket.status === "IN_PROGRESS" ? (
                    <button
                      className="maintenance-action-btn maintenance-action-btn--success"
                      type="button"
                      onClick={() => {
                        setResolvingTicket(ticket);
                        setResolutionNote("");
                        setRepairCostVnd("");
                      }}
                    >
                      <CheckCircleOutlined /> Báo cáo hoàn thành
                    </button>
                  ) : null}
                </div>

                <div
                  style={{
                    fontSize: 10,
                    color: "var(--color-text-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4
                  }}
                >
                  <ClockCircleOutlined /> Báo lúc: {formatDate(ticket.reportedAt)}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* MODAL: Báo cáo hoàn thành sửa chữa */}
      {resolvingTicket ? (
        <div
          className="staff-modal-backdrop"
          onClick={() => {
            if (!submittingResolve) setResolvingTicket(null);
          }}
        >
          <div className="staff-modal" onClick={(e) => e.stopPropagation()}>
            <div className="staff-modal__header">
              <div>
                <span className="staff-kicker">HOÀN TẤT BẢO TRÌ</span>
                <h3>Báo cáo sửa chữa</h3>
                <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--color-text-muted)" }}>
                  {resolvingTicket.title} {resolvingTicket.roomCode ? `(Phòng ${resolvingTicket.roomCode})` : ""}
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setResolvingTicket(null)}
                disabled={submittingResolve}
              >
                <CloseOutlined />
              </button>
            </div>

            <form onSubmit={(e) => void handleResolveSubmit(e)} style={{ display: "grid", gap: 14 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>
                  GHI CHÚ XỬ LÝ & LINH KIỆN THAY THẾ *
                </span>
                <textarea
                  rows={3}
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder="Ví dụ: Đã thay ổ cắm điện mới, kiểm tra điện áp hoạt động ổn định..."
                  required
                  style={{
                    padding: 10,
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 13,
                    fontFamily: "inherit"
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>
                  CHI PHÍ SỬA CHỮA / MUA VẬT TƯ (VNĐ)
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={repairCostVnd}
                  onChange={(e) => setRepairCostVnd(e.target.value)}
                  placeholder="0 (nếu không phát sinh)"
                  style={{
                    height: 44,
                    padding: "0 10px",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 15,
                    fontWeight: 600
                  }}
                />
              </label>

              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ flex: 1, minHeight: 46 }}
                  onClick={() => setResolvingTicket(null)}
                  disabled={submittingResolve}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="primary-action"
                  style={{ flex: 2, minHeight: 46, background: "#059669" }}
                  disabled={submittingResolve || !resolutionNote.trim()}
                >
                  {submittingResolve ? "Đang lưu…" : "Xác nhận đã xong"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* MODAL: Tạo sự cố mới tại hiện trường */}
      {createModalOpen ? (
        <div
          className="staff-modal-backdrop"
          onClick={() => {
            if (!submittingCreate) setCreateModalOpen(false);
          }}
        >
          <div className="staff-modal" onClick={(e) => e.stopPropagation()}>
            <div className="staff-modal__header">
              <div>
                <span className="staff-kicker">HIỆN TRƯỜNG</span>
                <h3>Báo cáo sự cố mới</h3>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setCreateModalOpen(false)}
                disabled={submittingCreate}
              >
                <CloseOutlined />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreateSubmit(e)} style={{ display: "grid", gap: 14 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>TIÊU ĐỀ SỰ CỐ *</span>
                <input
                  type="text"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  placeholder="Ví dụ: Bóng đèn hành lang tầng 2 bị cháy..."
                  required
                  style={{
                    height: 44,
                    padding: "0 10px",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 14
                  }}
                />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>PHÂN LOẠI</span>
                  <select
                    value={createCategory}
                    onChange={(e) =>
                      setCreateCategory(
                        e.target.value as MaintenanceTicketCategory
                      )
                    }
                    style={{
                      height: 44,
                      padding: "0 8px",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      fontSize: 13,
                      background: "#fff"
                    }}
                  >
                    {Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
                      <option key={cat} value={cat}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>MỨC ĐỘ</span>
                  <select
                    value={createPriority}
                    onChange={(e) =>
                      setCreatePriority(
                        e.target.value as MaintenanceTicketPriority
                      )
                    }
                    style={{
                      height: 44,
                      padding: "0 8px",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      fontSize: 13,
                      background: "#fff"
                    }}
                  >
                    <option value="LOW">Thấp</option>
                    <option value="NORMAL">Bình thường</option>
                    <option value="HIGH">Ưu tiên cao</option>
                    <option value="URGENT">Khẩn cấp</option>
                  </select>
                </label>
              </div>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>MÔ TẢ CHI TIẾT</span>
                <textarea
                  rows={3}
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder="Mô tả hiện trạng hư hỏng, vị trí cần sửa..."
                  style={{
                    padding: 10,
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 13,
                    fontFamily: "inherit"
                  }}
                />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>TÊN NGƯỜI BÁO (NẾU CÓ)</span>
                  <input
                    type="text"
                    value={createResidentName}
                    onChange={(e) => setCreateResidentName(e.target.value)}
                    placeholder="Anh Nam..."
                    style={{
                      height: 42,
                      padding: "0 10px",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      fontSize: 13
                    }}
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>SỐ ĐT NGƯỜI BÁO</span>
                  <input
                    type="tel"
                    value={createResidentPhone}
                    onChange={(e) => setCreateResidentPhone(e.target.value)}
                    placeholder="0912..."
                    style={{
                      height: 42,
                      padding: "0 10px",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      fontSize: 13
                    }}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ flex: 1, minHeight: 46 }}
                  onClick={() => setCreateModalOpen(false)}
                  disabled={submittingCreate}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="primary-action"
                  style={{ flex: 2, minHeight: 46 }}
                  disabled={submittingCreate || !createTitle.trim()}
                >
                  {submittingCreate ? "Đang gửi…" : "Tạo phiếu sự cố"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
