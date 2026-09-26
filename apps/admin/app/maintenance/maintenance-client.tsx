"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  MetricCard,
  MoneyDisplay,
  PageHeader,
  SectionHeader,
  StatusBadge
} from "@propops/ui";
import { AdminShell } from "../../components/admin-shell";
import {
  adminMaintenanceApi,
  type CreateMaintenanceTicketInput,
  type MaintenanceFilterQuery,
  type MaintenanceTicket,
  type MaintenanceTicketCategory,
  type MaintenanceTicketPriority,
  type MaintenanceTicketStatus
} from "../../lib/admin-maintenance-api";
import {
  adminAssetsApi,
  type AdminAssetPropertySummary
} from "../../lib/admin-assets-api";

function formatVnd(amount: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}

const categoryMeta: Record<
  MaintenanceTicketCategory,
  { label: string; tone: "warning" | "info" | "neutral" | "danger" | "success" }
> = {
  ELECTRICITY: { label: "Điện & Ánh sáng", tone: "warning" },
  PLUMBING: { label: "Cấp thoát nước", tone: "info" },
  APPLIANCE: { label: "Điện máy / Đồ đạc", tone: "warning" },
  STRUCTURAL: { label: "Cửa & Kết cấu", tone: "neutral" },
  INTERNET: { label: "Mạng & Wifi", tone: "info" },
  OTHER: { label: "Sự cố khác", tone: "neutral" }
};

const priorityMeta: Record<
  MaintenanceTicketPriority,
  { label: string; tone: "warning" | "info" | "neutral" | "danger" | "success" }
> = {
  URGENT: { label: "Khẩn cấp", tone: "danger" },
  HIGH: { label: "Ưu tiên cao", tone: "warning" },
  NORMAL: { label: "Bình thường", tone: "info" },
  LOW: { label: "Thấp", tone: "neutral" }
};

const statusMeta: Record<
  MaintenanceTicketStatus,
  { label: string; tone: "warning" | "info" | "neutral" | "danger" | "success" }
> = {
  OPEN: { label: "Mới tiếp nhận", tone: "warning" },
  IN_PROGRESS: { label: "Đang xử lý", tone: "info" },
  RESOLVED: { label: "Đã khắc phục", tone: "success" },
  CLOSED: { label: "Đã đóng", tone: "neutral" },
  CANCELLED: { label: "Đã huỷ", tone: "danger" }
};

export function MaintenanceClient() {
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [properties, setProperties] = useState<AdminAssetPropertySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [selectedPriority, setSelectedPriority] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [resolvingTicket, setResolvingTicket] = useState<MaintenanceTicket | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query: MaintenanceFilterQuery = {};
      if (selectedPropertyId) query.propertyId = selectedPropertyId;
      if (selectedStatus) query.status = selectedStatus as MaintenanceTicketStatus;
      if (selectedPriority) query.priority = selectedPriority as MaintenanceTicketPriority;
      if (selectedCategory) query.category = selectedCategory as MaintenanceTicketCategory;

      const [ticketsRes, overviewRes] = await Promise.all([
        adminMaintenanceApi.list(query),
        adminAssetsApi.overview()
      ]);

      setTickets(ticketsRes);
      setProperties(overviewRes.properties);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Không thể tải danh sách sự cố báo hỏng."
      );
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId, selectedStatus, selectedPriority, selectedCategory]);

  useEffect(() => {
    void load();
  }, [load]);

  // Metrics
  const openCount = tickets.filter((t) => t.status === "OPEN").length;
  const inProgressCount = tickets.filter((t) => t.status === "IN_PROGRESS").length;
  const resolvedCount = tickets.filter(
    (t) => t.status === "RESOLVED" || t.status === "CLOSED"
  ).length;
  const totalRepairCostVnd = tickets.reduce((sum, t) => sum + t.repairCostVnd, 0);

  async function handleCreateTicket(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setCreating(true);
    setCreateError(null);
    try {
      const propertyId = String(form.get("propertyId") ?? "");
      const title = String(form.get("title") ?? "");
      const residentName = String(form.get("residentName") ?? "");
      const residentPhone = String(form.get("residentPhone") ?? "");
      const category = String(form.get("category") ?? "OTHER") as MaintenanceTicketCategory;
      const priority = String(form.get("priority") ?? "NORMAL") as MaintenanceTicketPriority;
      const description = String(form.get("description") ?? "");

      await adminMaintenanceApi.create({
        propertyId,
        title,
        residentName,
        residentPhone: residentPhone || undefined,
        category,
        priority,
        description
      });

      setShowCreateModal(false);
      await load();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Không thể tạo yêu cầu báo hỏng."
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleStatusChange(ticketId: string, status: MaintenanceTicketStatus) {
    try {
      await adminMaintenanceApi.update(ticketId, { status });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Không thể cập nhật trạng thái.");
    }
  }

  async function handleResolveTicket(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!resolvingTicket) return;
    const form = new FormData(e.currentTarget);
    setResolving(true);
    setResolveError(null);
    try {
      const resolutionNote = String(form.get("resolutionNote") ?? "");
      const repairCostVnd = Number(form.get("repairCostVnd") ?? 0);
      const syncToOperatingExpense = form.get("syncExpense") === "on";

      await adminMaintenanceApi.update(resolvingTicket.id, {
        status: "RESOLVED",
        resolutionNote: resolutionNote || undefined,
        repairCostVnd,
        syncToOperatingExpense
      });

      setResolvingTicket(null);
      await load();
    } catch (err) {
      setResolveError(
        err instanceof Error ? err.message : "Không thể hoàn thành xử lý sự cố."
      );
    } finally {
      setResolving(false);
    }
  }

  async function handleDeleteTicket(ticketId: string, title: string) {
    if (!window.confirm(`Bạn có chắc muốn xoá sự cố "${title}"?`)) return;
    try {
      await adminMaintenanceApi.delete(ticketId);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Không thể xoá sự cố.");
    }
  }

  return (
    <AdminShell
      title="Tiếp nhận & Xử lý Báo hỏng"
      eyebrow="VẬN HÀNH · TICKETS & MAINTENANCE"
      activeNav="Báo hỏng & Sửa chữa"
    >
      <PageHeader
        title="Tiếp nhận & Xử lý Báo hỏng"
        eyebrow="TICKET BÁO SỰ CỐ"
        description="Theo dõi sự cố điện nước, đồ đạc từ khách thuê, tiến độ sửa chữa và tự động liên kết hạch toán chi phí bảo trì vào sổ quỹ."
        action={
          <button
            className="primary-button"
            type="button"
            onClick={() => setShowCreateModal(true)}
          >
            + Tiếp nhận sự cố
          </button>
        }
      />

      <section className="metrics-grid">
        <MetricCard
          label="Mới tiếp nhận"
          value={openCount.toString()}
          detail="Cần kiểm tra & điều phối"
          tone={openCount > 0 ? "warning" : "neutral"}
        />
        <MetricCard
          label="Đang khắc phục"
          value={inProgressCount.toString()}
          detail="Thợ đang xử lý tại phòng"
          tone="info"
        />
        <MetricCard
          label="Đã giải quyết"
          value={resolvedCount.toString()}
          detail="Sự cố hoàn thành / đã đóng"
          tone="success"
        />
        <MetricCard
          label="Tổng phí sửa chữa"
          value={formatVnd(totalRepairCostVnd)}
          detail="Liên kết chi phí vận hành"
          tone="neutral"
        />
      </section>

      {/* Filter Bar */}
      <section
        className="panel"
        style={{
          display: "flex",
          gap: "1rem",
          alignItems: "center",
          flexWrap: "wrap",
          padding: "1rem 1.25rem"
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--color-muted, #64748b)", fontWeight: 600 }}>CƠ SỞ</span>
          <select
            value={selectedPropertyId}
            onChange={(e) => setSelectedPropertyId(e.target.value)}
            style={{ padding: "0.4rem 0.75rem", borderRadius: "6px", border: "1px solid var(--color-border, #cbd5e1)" }}
          >
            <option value="">Tất cả cơ sở</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--color-muted, #64748b)", fontWeight: 600 }}>TRẠNG THÁI</span>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            style={{ padding: "0.4rem 0.75rem", borderRadius: "6px", border: "1px solid var(--color-border, #cbd5e1)" }}
          >
            <option value="">Tất cả trạng thái</option>
            <option value="OPEN">Mới tiếp nhận</option>
            <option value="IN_PROGRESS">Đang xử lý</option>
            <option value="RESOLVED">Đã khắc phục</option>
            <option value="CLOSED">Đã đóng</option>
            <option value="CANCELLED">Đã huỷ</option>
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--color-muted, #64748b)", fontWeight: 600 }}>ƯU TIÊN</span>
          <select
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value)}
            style={{ padding: "0.4rem 0.75rem", borderRadius: "6px", border: "1px solid var(--color-border, #cbd5e1)" }}
          >
            <option value="">Tất cả mức độ</option>
            <option value="URGENT">Khẩn cấp</option>
            <option value="HIGH">Ưu tiên cao</option>
            <option value="NORMAL">Bình thường</option>
            <option value="LOW">Thấp</option>
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--color-muted, #64748b)", fontWeight: 600 }}>DANH MỤC</span>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={{ padding: "0.4rem 0.75rem", borderRadius: "6px", border: "1px solid var(--color-border, #cbd5e1)" }}
          >
            <option value="">Tất cả danh mục</option>
            <option value="ELECTRICITY">Điện & Ánh sáng</option>
            <option value="PLUMBING">Cấp thoát nước</option>
            <option value="APPLIANCE">Điện máy / Đồ đạc</option>
            <option value="STRUCTURAL">Cửa & Kết cấu</option>
            <option value="INTERNET">Mạng & Wifi</option>
            <option value="OTHER">Khác</option>
          </select>
        </div>

        {(selectedPropertyId || selectedStatus || selectedPriority || selectedCategory) ? (
          <button
            className="secondary-button"
            type="button"
            style={{ alignSelf: "flex-end", padding: "0.4rem 0.75rem", fontSize: "0.85rem" }}
            onClick={() => {
              setSelectedPropertyId("");
              setSelectedStatus("");
              setSelectedPriority("");
              setSelectedCategory("");
            }}
          >
            Xoá bộ lọc
          </button>
        ) : null}
      </section>

      {/* Main Ticket List */}
      <section className="panel">
        <div className="asset-section-heading">
          <div>
            <span className="eyebrow">DANH SÁCH YÊU CẦU</span>
            <h2>Sự cố & Đề nghị bảo dưỡng ({tickets.length})</h2>
          </div>
        </div>

        {error ? (
          <div className="admin-state admin-state--error">
            <strong>Không thể tải dữ liệu sự cố.</strong>
            <span>{error}</span>
            <button className="secondary-button" type="button" onClick={() => void load()}>
              Thử lại
            </button>
          </div>
        ) : loading ? (
          <div className="admin-state">Đang tải danh sách sự cố…</div>
        ) : tickets.length === 0 ? (
          <div className="admin-state" style={{ padding: "3rem 1.5rem" }}>
            <StatusBadge tone="success">VẬN HÀNH ỔN ĐỊNH</StatusBadge>
            <h3 style={{ marginTop: "1rem" }}>Không có sự cố nào cần xử lý</h3>
            <p style={{ color: "var(--color-muted, #64748b)", maxWidth: "480px", margin: "0.5rem auto 1.5rem auto" }}>
              Tất cả các phòng đang vận hành tốt hoặc chưa có báo hỏng nào phù hợp với bộ lọc hiện tại.
            </p>
            <button
              className="primary-button"
              type="button"
              onClick={() => setShowCreateModal(true)}
            >
              + Tiếp nhận sự cố mới
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "1rem" }}>
            {tickets.map((ticket) => {
              const cat = categoryMeta[ticket.category] ?? categoryMeta.OTHER;
              const pri = priorityMeta[ticket.priority] ?? priorityMeta.NORMAL;
              const st = statusMeta[ticket.status] ?? statusMeta.OPEN;

              return (
                <div
                  key={ticket.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                    padding: "1.25rem",
                    background: "var(--color-surface, #ffffff)",
                    border: "1px solid var(--color-border, #e2e8f0)",
                    borderRadius: "10px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.02)"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                      gap: "0.5rem"
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                        <StatusBadge tone={pri.tone}>{pri.label}</StatusBadge>
                        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                        <span
                          style={{
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            padding: "0.2rem 0.5rem",
                            background: "var(--color-bg-muted, #f1f5f9)",
                            borderRadius: "4px",
                            color: "var(--color-muted, #475569)"
                          }}
                        >
                          {cat.label}
                        </span>
                        <span style={{ fontSize: "0.85rem", color: "var(--color-muted, #64748b)" }}>
                          {ticket.propertyName}
                          {ticket.roomCode ? ` · Phòng ${ticket.roomCode}` : ""}
                        </span>
                      </div>
                      <h3 style={{ fontSize: "1.1rem", margin: "0.4rem 0 0.2rem 0" }}>
                        {ticket.title}
                      </h3>
                    </div>

                    <div style={{ textAlign: "right", fontSize: "0.8rem", color: "var(--color-muted, #64748b)" }}>
                      <div>Báo lúc: {new Date(ticket.reportedAt).toLocaleString("vi-VN")}</div>
                      {ticket.resolvedAt ? (
                        <div style={{ color: "#16a34a", fontWeight: 500 }}>
                          Khắc phục: {new Date(ticket.resolvedAt).toLocaleString("vi-VN")}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <p
                    style={{
                      fontSize: "0.95rem",
                      color: "var(--color-text, #1e293b)",
                      margin: "0",
                      background: "var(--color-bg-muted, #f8fafc)",
                      padding: "0.75rem 1rem",
                      borderRadius: "6px",
                      borderLeft: "3px solid var(--color-border, #cbd5e1)"
                    }}
                  >
                    {ticket.description}
                  </p>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "0.75rem",
                      fontSize: "0.85rem",
                      color: "var(--color-muted, #64748b)"
                    }}
                  >
                    <div>
                      <span>Người báo: </span>
                      <strong style={{ color: "var(--color-text, #0f172a)" }}>{ticket.residentName}</strong>
                      {ticket.residentPhone ? ` (${ticket.residentPhone})` : ""}
                    </div>

                    {ticket.repairCostVnd > 0 ? (
                      <div>
                        <span>Chi phí: </span>
                        <strong style={{ color: "#dc2626", fontSize: "0.95rem" }}>
                          {formatVnd(ticket.repairCostVnd)}
                        </strong>
                        {ticket.linkedExpenseId ? (
                          <span style={{ marginLeft: "0.4rem", color: "#16a34a", fontSize: "0.75rem" }}>
                            ✓ Đã hạch toán sổ quỹ
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {ticket.resolutionNote ? (
                    <div
                      style={{
                        fontSize: "0.85rem",
                        padding: "0.5rem 0.75rem",
                        background: "#f0fdf4",
                        border: "1px solid #bbf7d0",
                        borderRadius: "6px",
                        color: "#166534"
                      }}
                    >
                      <strong>Kết quả xử lý: </strong>
                      {ticket.resolutionNote}
                    </div>
                  ) : null}

                  {/* Actions Row */}
                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      alignItems: "center",
                      flexWrap: "wrap",
                      marginTop: "0.25rem",
                      borderTop: "1px solid var(--color-border, #f1f5f9)",
                      paddingTop: "0.75rem"
                    }}
                  >
                    {ticket.status === "OPEN" ? (
                      <button
                        className="secondary-button"
                        type="button"
                        style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem" }}
                        onClick={() => void handleStatusChange(ticket.id, "IN_PROGRESS")}
                      >
                        Tiến hành xử lý
                      </button>
                    ) : null}

                    {ticket.status !== "RESOLVED" && ticket.status !== "CLOSED" ? (
                      <button
                        className="primary-button"
                        type="button"
                        style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem" }}
                        onClick={() => setResolvingTicket(ticket)}
                      >
                        ✓ Hoàn thành khắc phục
                      </button>
                    ) : null}

                    {ticket.status === "RESOLVED" ? (
                      <button
                        className="secondary-button"
                        type="button"
                        style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem" }}
                        onClick={() => void handleStatusChange(ticket.id, "CLOSED")}
                      >
                        Đóng sự cố
                      </button>
                    ) : null}

                    {ticket.status !== "CANCELLED" && ticket.status !== "CLOSED" ? (
                      <button
                        className="secondary-button"
                        type="button"
                        style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem", color: "#64748b" }}
                        onClick={() => void handleStatusChange(ticket.id, "CANCELLED")}
                      >
                        Huỷ sự cố
                      </button>
                    ) : null}

                    <button
                      className="danger-button"
                      type="button"
                      style={{ padding: "0.35rem 0.6rem", fontSize: "0.85rem", marginLeft: "auto" }}
                      onClick={() => void handleDeleteTicket(ticket.id, ticket.title)}
                    >
                      Xoá
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Modal: Tiếp nhận sự cố */}
      {showCreateModal ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "1rem"
          }}
        >
          <div
            style={{
              background: "var(--color-surface, #ffffff)",
              borderRadius: "12px",
              padding: "1.75rem",
              maxWidth: "600px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Tiếp nhận sự cố mới</h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer", color: "#64748b" }}
              >
                ✕
              </button>
            </div>

            {createError ? (
              <div className="admin-state admin-state--error" style={{ marginBottom: "1rem" }}>
                <span>{createError}</span>
              </div>
            ) : null}

            <form onSubmit={(e) => void handleCreateTicket(e)} className="asset-form">
              <label>
                <span>Cơ sở / Bất động sản *</span>
                <select name="propertyId" required defaultValue={selectedPropertyId || (properties[0]?.id ?? "")}>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Tiêu đề sự cố *</span>
                <input name="title" placeholder="vd: Máy lạnh không mát / Rò rỉ nước bồn rửa" required />
              </label>

              <label>
                <span>Danh mục sự cố</span>
                <select name="category" defaultValue="OTHER">
                  <option value="ELECTRICITY">Điện & Ánh sáng</option>
                  <option value="PLUMBING">Cấp thoát nước</option>
                  <option value="APPLIANCE">Điện máy / Đồ đạc</option>
                  <option value="STRUCTURAL">Cửa sổ, cửa đi, tường nứt</option>
                  <option value="INTERNET">Mạng Wifi / Internet</option>
                  <option value="OTHER">Sự cố khác</option>
                </select>
              </label>

              <label>
                <span>Mức độ ưu tiên</span>
                <select name="priority" defaultValue="NORMAL">
                  <option value="LOW">Thấp (Chưa gấp)</option>
                  <option value="NORMAL">Bình thường (Trong vòng 24-48h)</option>
                  <option value="HIGH">Ưu tiên cao (Trong ngày)</option>
                  <option value="URGENT">Khẩn cấp (Cháy chập, ngập nước...)</option>
                </select>
              </label>

              <label>
                <span>Tên người báo *</span>
                <input name="residentName" placeholder="vd: Nguyễn Văn A (Phòng 102)" required />
              </label>

              <label>
                <span>Số điện thoại liên hệ</span>
                <input name="residentPhone" placeholder="vd: 0901234567" />
              </label>

              <label className="asset-form__wide">
                <span>Mô tả chi tiết sự cố *</span>
                <textarea
                  name="description"
                  rows={3}
                  placeholder="Mô tả cụ thể hiện trạng, thời điểm xảy ra sự cố..."
                  required
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--color-border, #cbd5e1)" }}
                />
              </label>

              <div className="button-row asset-form__wide" style={{ marginTop: "1rem" }}>
                <button className="primary-button" type="submit" disabled={creating}>
                  {creating ? "Đang lưu..." : "Lưu & Tiếp nhận sự cố"}
                </button>
                <button className="secondary-button" type="button" onClick={() => setShowCreateModal(false)}>
                  Huỷ
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal: Hoàn thành & Ghi nhận chi phí */}
      {resolvingTicket ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "1rem"
          }}
        >
          <div
            style={{
              background: "var(--color-surface, #ffffff)",
              borderRadius: "12px",
              padding: "1.75rem",
              maxWidth: "540px",
              width: "100%",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Xác nhận hoàn thành sự cố</h2>
              <button
                type="button"
                onClick={() => setResolvingTicket(null)}
                style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer", color: "#64748b" }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: "0.9rem", color: "var(--color-muted, #64748b)", margin: "0 0 1rem 0" }}>
              Đang hoàn thành sự cố: <strong>{resolvingTicket.title}</strong>
            </p>

            {resolveError ? (
              <div className="admin-state admin-state--error" style={{ marginBottom: "1rem" }}>
                <span>{resolveError}</span>
              </div>
            ) : null}

            <form onSubmit={(e) => void handleResolveTicket(e)} className="asset-form">
              <label className="asset-form__wide">
                <span>Ghi chú kết quả khắc phục</span>
                <input
                  name="resolutionNote"
                  placeholder="vd: Thợ điện đã thay ổ cắm và CB mới, hoạt động bình thường..."
                  defaultValue={resolvingTicket.resolutionNote ?? ""}
                />
              </label>

              <label className="asset-form__wide">
                <span>Chi phí sửa chữa (VNĐ)</span>
                <input
                  name="repairCostVnd"
                  type="number"
                  min="0"
                  step="10000"
                  placeholder="vd: 250000"
                  defaultValue={resolvingTicket.repairCostVnd || ""}
                />
              </label>

              <label
                className="asset-form__wide"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  cursor: "pointer",
                  marginTop: "0.5rem"
                }}
              >
                <input
                  type="checkbox"
                  name="syncExpense"
                  defaultChecked={!resolvingTicket.linkedExpenseId}
                  style={{ width: "1.1rem", height: "1.1rem" }}
                />
                <span style={{ fontSize: "0.9rem", color: "var(--color-text, #0f172a)" }}>
                  Tự động ghi vào <strong>Sổ quỹ Thu - Chi</strong> (Khoản Chi sửa chữa / bảo trì)
                </span>
              </label>

              <div className="button-row asset-form__wide" style={{ marginTop: "1.25rem" }}>
                <button className="primary-button" type="submit" disabled={resolving}>
                  {resolving ? "Đang cập nhật..." : "Xác nhận đã khắc phục"}
                </button>
                <button className="secondary-button" type="button" onClick={() => setResolvingTicket(null)}>
                  Huỷ
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
