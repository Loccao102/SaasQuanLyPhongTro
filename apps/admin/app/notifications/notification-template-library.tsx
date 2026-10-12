"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  adminNotificationsApi,
  type NotificationMessageTemplate,
  type NotificationTemplateCategory,
  type NotificationTemplateInput
} from "../../lib/admin-notifications-api";
import { templateVariables, variableLabels } from "../../lib/notification-template-render";

const categories: Array<{ value: NotificationTemplateCategory; label: string }> = [
  { value: "RENT", label: "Tiền phòng" },
  { value: "PAYMENT", label: "Thanh toán" },
  { value: "UTILITY", label: "Điện nước" },
  { value: "MAINTENANCE", label: "Bảo trì" },
  { value: "GENERAL", label: "Thông báo chung" }
];

export function NotificationTemplateLibrary({
  onUse
}: {
  onUse: (template: NotificationMessageTemplate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<NotificationMessageTemplate[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<NotificationTemplateCategory>("GENERAL");
  const [body, setBody] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const response = await adminNotificationsApi.templates();
      setTemplates(response.templates);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được thư viện mẫu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  function newTemplate(source?: NotificationMessageTemplate) {
    setEditId(source?.source === "CUSTOM" ? source.id : null);
    setName(source
      ? source.source === "PRESET" ? source.name + " - tùy chỉnh" : source.name
      : "");
    setCategory(source?.category ?? "GENERAL");
    setBody(source?.body ?? "");
    setEditing(true);
    setError(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const input: NotificationTemplateInput = { name: name.trim(), category, body: body.trim() };
    try {
      if (editId) await adminNotificationsApi.updateTemplate(editId, input);
      else await adminNotificationsApi.createTemplate(input);
      setEditing(false);
      setEditId(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được mẫu.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(template: NotificationMessageTemplate) {
    if (template.source !== "CUSTOM") return;
    if (!window.confirm("Xóa mẫu \"" + template.name + "\"? Các chiến dịch đã tạo sẽ không thay đổi.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminNotificationsApi.deleteTemplate(template.id);
      if (editId === template.id) { setEditing(false); setEditId(null); }
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể xóa mẫu.");
    } finally {
      setBusy(false);
    }
  }

  const visible = templates.filter((template) =>
    filter === "ALL" || template.category === filter
  );
  const variables = templateVariables(body);

  return (
    <section className="panel" aria-label="Thư viện mẫu tin nhắn" style={{ marginBottom: 20 }}>
      <div className="asset-section-heading" style={{ alignItems: "center" }}>
        <div>
          <span className="eyebrow">MESSAGE TEMPLATES</span>
          <h2>Mẫu tin nhắn</h2>
          <p style={{ color: "#64748b", marginTop: 4 }}>
            Chọn mẫu để soạn nhanh, hoặc lưu mẫu riêng cho tổ chức.
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={() => setOpen(!open)}>
          {open ? "Thu gọn" : "Quản lý mẫu tin"}
        </button>
      </div>

      {open && (
        <div style={{ display: "grid", gap: 16 }}>
          {error && <div className="admin-state admin-state--error" role="alert">{error}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <label style={{ flex: "1 1 180px", margin: 0 }}>
              <span>Loại tin</span>
              <select className="form-select" value={filter}
                onChange={(event) => setFilter(event.target.value)}>
                <option value="ALL">Tất cả mẫu</option>
                {categories.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <button className="primary-button" type="button" onClick={() => newTemplate()}>
              + Tạo mẫu riêng
            </button>
          </div>
          {loading && !templates.length ? (
            <p className="admin-state">Đang tải mẫu tin…</p>
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 270px), 1fr))",
              gap: 12
            }}>
              {visible.map((template) => (
                <article key={template.id} style={{
                  border: "1px solid #dbe4ef", borderRadius: 12,
                  padding: 14, display: "grid", gap: 9
                }}>
                  <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
                    <strong>{template.name}</strong>
                    <small style={{ color: "#64748b", whiteSpace: "nowrap" }}>
                      {template.source === "PRESET" ? "Mẫu gợi ý" : "Mẫu riêng"}
                    </small>
                  </div>
                  <small>{categories.find(c => c.value === template.category)?.label}</small>
                  <p style={{
                    color: "#475569", fontSize: 13, lineHeight: 1.6,
                    margin: 0, whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere", maxHeight: 80, overflow: "hidden"
                  }}>{template.body}</p>
                  <div className="button-row" style={{ flexWrap: "wrap", marginTop: "auto" }}>
                    <button type="button" className="primary-button" onClick={() => onUse(template)}>
                      Dùng mẫu
                    </button>
                    <button type="button" className="secondary-button"
                      onClick={() => newTemplate(template)}>
                      {template.source === "PRESET" ? "Tùy chỉnh" : "Sửa"}
                    </button>
                    {template.source === "CUSTOM" && (
                      <button type="button" className="danger-button" disabled={busy}
                        onClick={() => void remove(template)}>Xóa</button>
                    )}
                  </div>
                </article>
              ))}
              {visible.length === 0 && <p>Chưa có mẫu ở nhóm này.</p>}
            </div>
          )}

          {editing && (
            <form onSubmit={(event) => void save(event)} style={{
              display: "grid", gap: 12, padding: 16,
              border: "1px solid #cbd5e1", borderRadius: 12
            }}>
              <h3>{editId ? "Chỉnh sửa mẫu riêng" : "Lưu mẫu mới cho tổ chức"}</h3>
              <label>
                <span>Tên mẫu</span>
                <input className="form-input" value={name} maxLength={100} minLength={2}
                  onChange={(event) => setName(event.target.value)} required />
              </label>
              <label>
                <span>Danh mục</span>
                <select className="form-select" value={category}
                  onChange={(event) => setCategory(event.target.value as NotificationTemplateCategory)}>
                  {categories.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Nội dung mẫu</span>
                <textarea rows={6} maxLength={4000} required value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Xin chào, ban quản lý xin thông báo: {{noi_dung}}" />
              </label>
              <div>
                <strong style={{ fontSize: 13 }}>Biến có thể dùng</strong>
                <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7 }}>
                  {Object.keys(variableLabels).map((field) => "{{" + field + "}}").join(" · ")}
                </p>
                {variables.length > 0 && (
                  <small>Biến trong mẫu: {variables.join(", ")}</small>
                )}
              </div>
              <div className="button-row">
                <button type="submit" className="primary-button" disabled={busy}>
                  {busy ? "Đang lưu…" : editId ? "Lưu thay đổi" : "Lưu mẫu"}
                </button>
                <button type="button" className="secondary-button"
                  onClick={() => setEditing(false)}>Hủy</button>
              </div>
            </form>
          )}
          <small style={{ color: "#64748b" }}>
            Mẫu chỉ là bản nháp. Thay đổi hoặc xóa mẫu không làm thay đổi các tin đã xếp hàng.
            Trước khi gửi tin xác nhận thanh toán, hãy đối chiếu dữ liệu thực tế.
          </small>
        </div>
      )}
    </section>
  );
}
