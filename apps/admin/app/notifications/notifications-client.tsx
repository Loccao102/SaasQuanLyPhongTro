"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { StatusBadge } from "@propops/ui";
import Link from "next/link";
import { ZaloLiveMonitor } from "./zalo-live-monitor";
import { NotificationTemplateLibrary } from "./notification-template-library";
import { renderNotificationTemplate, templateVariables, variableLabels } from "../../lib/notification-template-render";
import type { NotificationMessageTemplate } from "../../lib/admin-notifications-api";
import { TenantNotificationRecipientsPicker, normalizeTenantPhone, type SelectedTenantRecipient } from "./tenant-recipients-picker";
import { adminZaloPersonalApi } from "../../lib/admin-zalo-personal-api";
import { AdminShell } from "../../components/admin-shell";
import {
  adminNotificationsApi,
  type NotificationCampaignList,
  type NotificationCampaignSummary
} from "../../lib/admin-notifications-api";

function campaignTone(status: string) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "PARTIAL_FAILED" || status === "MANUAL_REVIEW") return "warning" as const;
  if (status === "FAILED") return "danger" as const;
  if (status === "CANCELLED") return "neutral" as const;
  return "info" as const;
}

function jobTone(status: string) {
  if (status === "SENT") return "success" as const;
  if (status === "MANUAL_REVIEW") return "warning" as const;
  if (status === "FAILED") return "danger" as const;
  if (status === "RUNNING") return "info" as const;
  if (status === "RETRY_WAIT") return "warning" as const;
  return "neutral" as const;
}

function campaignStatusLabel(status: string) {
  switch (status) {
    case "COMPLETED": return "Đã hoàn thành";
    case "PARTIAL_FAILED": return "Thất bại một phần";
    case "MANUAL_REVIEW": return "Cần kiểm tra";
    case "PAUSED": return "Tạm dừng";
    case "CANCELLED": return "Đã hủy";
    case "QUEUED": return "Đang xếp hàng";
    case "RUNNING": return "Đang gửi";
    default: return status;
  }
}

function jobStatusLabel(status: string) {
  switch (status) {
    case "SENT": return "Đã gửi trên Zalo Web";
    case "MANUAL_REVIEW": return "Cần kiểm tra";
    case "RUNNING": return "Đang gửi...";
    case "QUEUED": return "Chờ gửi";
    case "RETRY_WAIT": return "Chờ gửi lại";
    case "FAILED": return "Thất bại";
    case "CANCELLED": return "Đã hủy";
    default: return status;
  }
}

function explainError(code: string | null, message: string | null): string | null {
  if (!code && !message) return null;
  switch (code) {
    case "RECIPIENT_DISPLAY_NAME_REQUIRED":
      return "⚠️ Job cũ yêu cầu tên Zalo. Tạo chiến dịch mới chỉ với số điện thoại để sử dụng cơ chế tìm người nhận đã cập nhật.";
    case "RECIPIENT_NOT_FOUND":
      return "⚠️ Không xác minh được người nhận: Có thể không tìm thấy, họ hạn chế tìm kiếm hoặc giao diện Zalo đã thay đổi.";
    case "ZALO_RECIPIENT_BLOCKED":
      return "⚠️ Zalo thông báo người nhận đã chặn. Không tự gửi lại.";
    case "ZALO_RATE_RESTRICTED":
      return "🛑 Zalo báo hạn chế gửi. Queue tổ chức đã tạm dừng; hãy kiểm tra trước khi tiếp tục.";
    case "ZALO_SEND_REJECTED":
      return "⚠️ Zalo báo lỗi gửi: Chưa xác nhận tin đã đi. Kiểm tra trong Zalo trước khi gửi lại.";
    case "RECIPIENT_AMBIGUOUS":
      return "⚠️ Trùng tên hiển thị: Tìm thấy nhiều tài khoản trùng tên. Hệ thống dừng lại để tránh gửi nhầm người.";
    case "RECIPIENT_VERIFICATION_FAILED":
      return "⚠️ Không xác minh được cuộc trò chuyện với kết quả tìm kiếm Zalo đã chọn. Dừng gửi để tránh nhầm người.";
    case "CAPTCHA":
      return "🛑 Zalo yêu cầu xác minh CAPTCHA: Hệ thống đã tự động tạm dừng để bảo vệ tài khoản, tránh bị khóa nick.";
    case "AUTH_REQUIRED":
    case "SESSION_EXPIRED":
      return "🛑 Phiên Zalo hết hạn: Vui lòng quét mã QR đăng nhập lại Zalo Web.";
    case "SESSION_BUSY":
      return "⏳ Phiên Zalo đang bận: Đang gửi tin nhắn trước đó, sẽ tự động xử lý tiếp.";
    case "PROVIDER_UI_BROKEN":
      return "⚠️ Không tìm thấy ô tìm kiếm người nhận hoặc khung chat trên Zalo Web. Cần kiểm tra giao diện worker.";
    case "POST_SEND_TIMEOUT":
    case "UNKNOWN":
      return "⚠️ Chưa xác nhận được tin nhắn sau khi bấm gửi. Vui lòng mở Zalo kiểm tra trực tiếp.";
    default:
      return message ? `⚠️ ${message}` : `Lỗi (${code})`;
  }
}

export function NotificationsClient() {
  const [data, setData] = useState<NotificationCampaignList | null>(null);
  const [selected, setSelected] = useState<NotificationCampaignSummary | null>(null);
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof adminNotificationsApi.detail>>["jobs"]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [messageBody, setMessageBody] = useState("");
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({});
  const [recipientMode, setRecipientMode] = useState<"MANUAL" | "TENANTS">("TENANTS");
  const [tenantRecipients, setTenantRecipients] = useState<SelectedTenantRecipient[]>([]);
  const [filterTab, setFilterTab] = useState<"ALL" | "MANUAL_REVIEW" | "SENT" | "PENDING" | "FAILED">("ALL");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [monitorJobId, setMonitorJobId] = useState<string | null>(null);
  const [zaloConnected, setZaloConnected] = useState(false);
  const [zaloSendingPaused, setZaloSendingPaused] = useState(false);
  const [zaloProviderPaused, setZaloProviderPaused] = useState(false);
  const [zaloProviderReason, setZaloProviderReason] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await adminNotificationsApi.list();
      setData(next);
      const zalo = await adminZaloPersonalApi.status().catch(() => null);
      setZaloConnected(zalo?.status === "CONNECTED");
      setZaloSendingPaused(zalo?.sending?.paused ?? false);
      setZaloProviderPaused(zalo?.provider?.status === "PAUSED");
      setZaloProviderReason(zalo?.provider?.reason ?? null);
      if (selected) {
        const detail = await adminNotificationsApi.detail(selected.id);
        setSelected(detail.campaign);
        setJobs(detail.jobs);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải thông báo.");
    } finally {
      setLoading(false);
    }
  }, [selected?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const selectedId = selected?.id;
    if (!selectedId) return;
    const timer = window.setInterval(() => {
      void adminNotificationsApi.detail(selectedId).then((detail) => {
        setSelected((old) => old?.id === selectedId ? detail.campaign : old);
        setJobs(detail.jobs);
      }).catch(() => {});
      void adminZaloPersonalApi.status().then((zalo) => {
        setZaloConnected(zalo.status === "CONNECTED");
        setZaloSendingPaused(zalo.sending?.paused ?? false);
        setZaloProviderPaused(zalo.provider?.status === "PAUSED");
        setZaloProviderReason(zalo.provider?.reason ?? null);
      }).catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, [selected?.id]);

  async function openCampaign(campaign: NotificationCampaignSummary) {
    setMonitorJobId(null);
    setSelected(campaign);
    setError(null);
    setFilterTab("ALL");
    try {
      const detail = await adminNotificationsApi.detail(campaign.id);
      setSelected(detail.campaign);
      setJobs(detail.jobs);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "Không thể tải campaign.");
    }
  }

  async function mutate(action: () => Promise<NotificationCampaignSummary>) {
    setSaving(true);
    setError(null);
    try {
      const campaign = await action();
      setSelected(campaign);
      const detail = await adminNotificationsApi.detail(campaign.id);
      setJobs(detail.jobs);
      setData(await adminNotificationsApi.list());
      return true;
    } catch (mutation) {
      setError(mutation instanceof Error ? mutation.message : "Không thể cập nhật campaign.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function useTemplate(template: NotificationMessageTemplate) {
    setMessageBody(template.body);
    setTemplateName(template.name);
    setTemplateValues({});
    setShowCreate(true);
    setError(null);
    requestAnimationFrame(() => {
      document.getElementById("notification-create-campaign")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const recipientsText = String(form.get("recipients") ?? "");
    const recipients = recipientMode === "TENANTS" ? tenantRecipients :
      recipientsText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
        .map(line => {
          const [phone, ...nameParts] = line.split("|");
          return {
            recipientKey: normalizeTenantPhone(phone?.trim() ?? "") ?? "",
            recipientDisplayName: nameParts.join("|").trim() || null
          };
        });

    const rendered = renderNotificationTemplate(messageBody, templateValues);
    if (rendered.invalid.length || rendered.missing.length) {
      setError("Mẫu tin còn biến chưa hợp lệ hoặc chưa điền: " +
        [...rendered.invalid, ...rendered.missing].join(", "));
      return;
    }
    if (!rendered.body.trim() || rendered.body.length > 4000) {
      setError("Nội dung tin sau khi điền biến phải từ 1 đến 4.000 ký tự.");
      return;
    }
    if (recipients.length > 1 &&
      templateVariables(messageBody).some(key => ["ten_khach", "so_phong", "so_tien"].includes(key))) {
      setError("Mẫu này chứa thông tin riêng từng người/phòng/số tiền. Hãy gửi riêng từng người để tránh nhầm dữ liệu.");
      return;
    }

    if (!recipients.length) {
      setError("Hãy chọn ít nhất một khách thuê hoặc nhập một số điện thoại hợp lệ.");
      return;
    }
    if (recipients.some(r => !r.recipientKey)) {
      setError("Danh sách có số điện thoại không hợp lệ. Vui lòng kiểm tra lại.");
      return;
    }
    if (new Set(recipients.map(r => r.recipientKey)).size !== recipients.length) {
      setError("Danh sách có số điện thoại trùng. Mỗi số chỉ được nhận một lần.");
      return;
    }
    if (recipients.length > 5000) {
      setError("Một chiến dịch tối đa 5.000 số điện thoại.");
      return;
    }
    if (!window.confirm(`Tạo chiến dịch Zalo cho ${recipients.length} số điện thoại? Các tin được đưa vào hàng đợi và chỉ gửi khi provider hoạt động.`)) {
      return;
    }
    const succeeded = await mutate(() =>
      adminNotificationsApi.create({
        idempotencyKey: crypto.randomUUID(),
        messageBody: rendered.body,
        recipients
      })
    );
    if (succeeded) {
      setShowCreate(false);
      setTenantRecipients([]);
      setMessageBody("");
      setTemplateValues({});
      setTemplateName(null);
    }
  }

  const reviewCount = jobs.filter((j) => j.status === "MANUAL_REVIEW").length;
  const sentCount = jobs.filter((j) => j.status === "SENT").length;
  const pendingCount = jobs.filter((j) => ["QUEUED", "RUNNING", "RETRY_WAIT"].includes(j.status)).length;
  const failedCount = jobs.filter((j) => j.status === "FAILED").length;

  const filteredJobs = jobs.filter((job) => {
    if (filterTab === "MANUAL_REVIEW") return job.status === "MANUAL_REVIEW";
    if (filterTab === "SENT") return job.status === "SENT";
    if (filterTab === "PENDING") return ["QUEUED", "RUNNING", "RETRY_WAIT"].includes(job.status);
    if (filterTab === "FAILED") return job.status === "FAILED";
    return true;
  });

  return (
    <AdminShell title="Thông báo & tin nhắn" eyebrow="AUTOMATION · LIVE QUEUE" activeNav="Thông báo">
      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Thao tác chưa hoàn tất.</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {zaloProviderPaused && !loading && (
        <section className="admin-state admin-state--error" role="alert">
          Nhà cung cấp gửi Zalo đang tạm dừng. Phiên Zalo vẫn có thể kết nối,
          nhưng các tin trong hàng đợi sẽ không được gửi cho đến khi quản trị hệ thống
          kiểm tra và bật lại. {zaloProviderReason ? "Lý do: " + zaloProviderReason : ""}
        </section>
      )}
      {zaloSendingPaused && !loading && (
        <section className="admin-state admin-state--error" role="alert">
          Gửi Zalo của tổ chức đang tạm dừng do cảnh báo hoặc thao tác quản trị.
          <Link href="/zalo-personal" className="text-link" style={{ marginLeft: 12 }}>
            Xem trạng thái
          </Link>
        </section>
      )}
      {!zaloConnected && !loading && (
        <section className="admin-state" role="status">
          Bạn cần liên kết Zalo của tổ chức trước khi gửi tin.
          <Link href="/zalo-personal" className="text-link" style={{ marginLeft: 12 }}>
            Kết nối Zalo 1 Chạm
          </Link>
        </section>
      )}
      <NotificationTemplateLibrary onUse={useTemplate} />
      <section className="asset-context">
        <div>
          <span className="eyebrow">ZALO / NOTIFICATION QUEUE</span>
          <h2>{data?.organization.name ?? "Workspace hiện tại"}</h2>
          <p>Queue tự giãn nhịp gửi và nghỉ ngoài giờ. “Đã gửi trên Zalo Web” không đồng nghĩa đã giao hoặc đã đọc. Tin chưa xác minh sẽ không tự gửi lại.</p>
        </div>
        <button className="primary-button" type="button" disabled={!zaloConnected || zaloSendingPaused || zaloProviderPaused} onClick={() => setShowCreate((value) => !value)}>
          + Tạo chiến dịch
        </button>
      </section>

      {showCreate ? (
        <section className="panel" id="notification-create-campaign">
          <div className="asset-section-heading">
            <div><span className="eyebrow">NEW CAMPAIGN</span><h2>Tạo chiến dịch thông báo</h2></div>
          </div>
          <form className="notification-create-form" onSubmit={(event) => void createCampaign(event)}>
            {templateName && (
              <div className="admin-state" role="status">
                Đang dùng mẫu: <strong>{templateName}</strong>. Bạn có thể chỉnh sửa nội dung trước khi gửi.
              </div>
            )}
            <label>
              <span>Nội dung</span>
              <textarea name="messageBody" rows={6} maxLength={4000} required
                value={messageBody}
                onChange={event => {
                  setMessageBody(event.target.value);
                  setTemplateName(null);
                }}
                placeholder="Nhập tin nhắn hoặc chọn một mẫu ở thư viện phía trên…" />
            </label>
            {templateVariables(messageBody).length > 0 && (
              <fieldset style={{
                border: "1px solid #dbe4ef", borderRadius: 12,
                padding: 16, display: "grid", gap: 10
              }}>
                <legend style={{ padding: "0 8px", fontWeight: 600 }}>Điền biến nội dung</legend>
                <small>Các giá trị sẽ dùng chung cho mọi người nhận. Thông tin cá nhân hoặc số tiền nên gửi riêng từng người.</small>
                {templateVariables(messageBody).map(variable => (
                  <label key={variable}>
                    <span>{variableLabels[variable] ?? "Biến không hỗ trợ: " + variable}</span>
                    {variable === "noi_dung" ? (
                      <textarea rows={3} value={templateValues[variable] ?? ""}
                        onChange={event => setTemplateValues(old => ({
                          ...old, [variable]: event.target.value
                        }))} placeholder={"Điền " + variable} />
                    ) : (
                      <input className="form-input" value={templateValues[variable] ?? ""}
                        onChange={event => setTemplateValues(old => ({
                          ...old, [variable]: event.target.value
                        }))} placeholder={"Điền " + variable} />
                    )}
                  </label>
                ))}
                <div style={{ background: "#f8fafc", borderRadius: 10, padding: 12 }}>
                  <strong>Bản xem trước trước khi xếp hàng</strong>
                  <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 8 }}>
                    {renderNotificationTemplate(messageBody, templateValues).body}
                  </p>
                  {renderNotificationTemplate(messageBody, templateValues).missing.length > 0 && (
                    <small style={{ color: "#b45309" }}>Cần điền: {
                      renderNotificationTemplate(messageBody, templateValues).missing.join(", ")
                    }</small>
                  )}
                </div>
              </fieldset>
            )}
            <fieldset style={{ border: "1px solid #dbe4ef", borderRadius: 12, padding: 16 }}>
              <legend style={{ padding: "0 8px", fontWeight: 600 }}>Chọn nguồn người nhận</legend>
              <div className="button-row" style={{ marginBottom: 14 }}>
                <button type="button" className={recipientMode === "TENANTS" ? "primary-button" : "secondary-button"}
                  onClick={() => setRecipientMode("TENANTS")}>Khách đang thuê phòng</button>
                <button type="button" className={recipientMode === "MANUAL" ? "primary-button" : "secondary-button"}
                  onClick={() => setRecipientMode("MANUAL")}>Nhập số điện thoại</button>
              </div>
              {recipientMode === "TENANTS" ? (
                <TenantNotificationRecipientsPicker onChange={setTenantRecipients} />
              ) : (
                <label>
                  <span>Người nhận · mỗi dòng: Số điện thoại (Tên Zalo tùy chọn sau dấu |)</span>
                  <textarea name="recipients" rows={8} required
                    placeholder={"0901234567\n0909999999 | Tên Zalo nếu biết"} />
                </label>
              )}
            </fieldset>
            <p style={{ fontSize: 13, color: "#64748b" }}>
              Hãy kiểm tra danh sách trước khi xếp hàng. Nhà cung cấp Zalo đang tạm dừng sẽ không tự gửi cho đến khi được kích hoạt.
            </p>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <input name="recipientConsent" type="checkbox" required style={{ marginTop: 4 }} />
              <span>Tôi xác nhận người nhận đã đồng ý nhận thông báo; không gửi tin quảng cáo trái mong muốn.</span>
            </label>
            <div className="button-row">
              <button className="primary-button" type="submit" disabled={saving || zaloSendingPaused || zaloProviderPaused}>Xếp hàng gửi</button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="notification-layout">
        <div className="panel">
          <div className="asset-section-heading">
            <div><span className="eyebrow">CAMPAIGNS</span><h2>Chiến dịch gần đây</h2></div>
            <button className="secondary-button" type="button" onClick={() => void load()}>Làm mới</button>
          </div>
          {loading || !data ? (
            <div className="admin-state">Đang tải queue…</div>
          ) : data.campaigns.length === 0 ? (
            <div className="admin-state">Chưa có campaign nào.</div>
          ) : (
            <div className="notification-campaign-list">
              {data.campaigns.map((campaign) => (
                <button
                  className={"notification-campaign-row" + (selected?.id === campaign.id ? " notification-campaign-row--active" : "")}
                  type="button"
                  key={campaign.id}
                  onClick={() => void openCampaign(campaign)}
                >
                  <div>
                    <strong>{campaign.messageBody.slice(0, 80)}</strong>
                    <span>{campaign.provider} · {campaign.totalRecipients} người nhận</span>
                  </div>
                  <div>
                    <StatusBadge tone={campaignTone(campaign.status)}>{campaignStatusLabel(campaign.status)}</StatusBadge>
                    <small>{campaign.sent} đã hiện trên Zalo Web · {campaign.failed + campaign.manualReview} cần xử lý</small>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          {!selected ? (
            <div className="admin-state">
              <strong>Chọn một campaign để theo dõi và vận hành.</strong>
              <span>Tạm dừng, tiếp tục, hủy và gửi lại đều được kiểm soát an toàn trên server.</span>
            </div>
          ) : (
            <>
              <div className="asset-section-heading">
                <div><span className="eyebrow">{selected.provider}</span><h2>{campaignStatusLabel(selected.status)}</h2></div>
                <StatusBadge tone={campaignTone(selected.status)}>{selected.sent}/{selected.totalRecipients} ĐÃ HIỆN TRÊN ZALO WEB</StatusBadge>
              </div>
              <p className="notification-message-preview">{selected.messageBody}</p>
              <div className="notification-stats">
                <span>Chờ gửi <strong>{selected.queued}</strong></span>
                <span>Đang gửi <strong>{selected.running}</strong></span>
                <span>Chờ gửi lại <strong>{selected.retryWaiting}</strong></span>
                <span>Thất bại <strong>{selected.failed}</strong></span>
                <span>Cần kiểm tra <strong>{selected.manualReview}</strong></span>
              </div>
              <div className="button-row">
                {selected.status === "PAUSED" ? (
                  <button className="secondary-button" disabled={saving} onClick={() => void mutate(() => adminNotificationsApi.resume(selected.id))}>Tiếp tục gửi</button>
                ) : selected.status !== "CANCELLED" && selected.status !== "COMPLETED" ? (
                  <button className="secondary-button" disabled={saving} onClick={() => {
                    const reason = window.prompt("Lý do tạm dừng campaign:");
                    if (reason?.trim()) void mutate(() => adminNotificationsApi.pause(selected.id, reason.trim()));
                  }}>Tạm dừng</button>
                ) : null}
                {selected.failed + selected.manualReview > 0 && selected.status !== "CANCELLED" ? (
                  <button className="secondary-button" disabled={saving} onClick={() => {
                    if (window.confirm("Bạn đã kiểm tra trực tiếp Zalo và chắc chắn tin chưa gửi? Gửi lại khi chưa xác minh có thể tạo tin trùng.")) {
                      void mutate(() => adminNotificationsApi.retry(selected.id));
                    }
                  }}>Gửi lại sau khi xác minh</button>
                ) : null}
                {selected.status !== "CANCELLED" && selected.status !== "COMPLETED" ? (
                  <button className="danger-button" disabled={saving} onClick={() => {
                    const reason = window.prompt("Lý do hủy campaign:");
                    if (reason?.trim()) void mutate(() => adminNotificationsApi.cancel(selected.id, reason.trim()));
                  }}>Hủy các tin chưa gửi</button>
                ) : null}
              </div>

              {/* Status Filter Tabs */}
              <div className="notification-filter-tabs">
                <button
                  type="button"
                  className={"notification-filter-tab" + (filterTab === "ALL" ? " notification-filter-tab--active" : "")}
                  onClick={() => setFilterTab("ALL")}
                >
                  Tất cả <span className="notification-filter-tab__count">{jobs.length}</span>
                </button>
                <button
                  type="button"
                  className={"notification-filter-tab" + (filterTab === "MANUAL_REVIEW" ? " notification-filter-tab--active" : "") + (reviewCount > 0 ? " notification-filter-tab--warn" : "")}
                  onClick={() => setFilterTab("MANUAL_REVIEW")}
                >
                  ⚠️ Cần kiểm tra <span className="notification-filter-tab__count">{reviewCount}</span>
                </button>
                <button
                  type="button"
                  className={"notification-filter-tab" + (filterTab === "SENT" ? " notification-filter-tab--active" : "")}
                  onClick={() => setFilterTab("SENT")}
                >
                  ✅ Đã gửi <span className="notification-filter-tab__count">{sentCount}</span>
                </button>
                <button
                  type="button"
                  className={"notification-filter-tab" + (filterTab === "PENDING" ? " notification-filter-tab--active" : "")}
                  onClick={() => setFilterTab("PENDING")}
                >
                  ⏳ Đang xử lý / Chờ <span className="notification-filter-tab__count">{pendingCount}</span>
                </button>
                {failedCount > 0 ? (
                  <button
                    type="button"
                    className={"notification-filter-tab" + (filterTab === "FAILED" ? " notification-filter-tab--active" : "")}
                    onClick={() => setFilterTab("FAILED")}
                  >
                    ❌ Thất bại <span className="notification-filter-tab__count">{failedCount}</span>
                  </button>
                ) : null}
              </div>

              <div className="notification-job-list">
                {filteredJobs.length === 0 ? (
                  <div className="admin-state" style={{ padding: "20px 0" }}>
                    Không có người nhận nào trong mục này.
                  </div>
                ) : (
                  filteredJobs.slice(0, 200).map((job) => (
                    <div className="notification-job-row" key={job.id}>
                      <div>
                        <strong>{job.recipientDisplayName ?? job.recipientKey}</strong>
                        <span>{job.recipientKey}</span>
                        <div className="notification-job-actions">
                          <button type="button" className="notification-copy-btn"
                            onClick={() => setMonitorJobId((current) => current === job.id ? null : job.id)}>
                            {monitorJobId === job.id ? "Ẩn màn hình" : "👁 Xem thao tác"}
                          </button>
                          <button
                            type="button"
                            className="notification-copy-btn"
                            title="Sao chép số điện thoại"
                            onClick={() => {
                              void navigator.clipboard.writeText(job.recipientKey);
                              setCopiedId(job.id);
                              setTimeout(() => setCopiedId((curr) => curr === job.id ? null : curr), 2000);
                            }}
                          >
                            {copiedId === job.id ? "✓ Đã chép SĐT" : "📋 Chép SĐT"}
                          </button>
                        </div>
                      </div>
                      <div>
                        <StatusBadge tone={jobTone(job.status)}>{jobStatusLabel(job.status)}</StatusBadge>
                        <small>Lần thử {job.attemptCount}/{job.maxAttempts}</small>
                      </div>
                      {explainError(job.lastErrorCode, job.lastErrorMessage) ? (
                        <div className="notification-job-error">
                          {explainError(job.lastErrorCode, job.lastErrorMessage)}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
              {monitorJobId && jobs.some((job) => job.id === monitorJobId) ? (
                <ZaloLiveMonitor
                  key={selected.id + ":" + monitorJobId}
                  campaignId={selected.id}
                  jobId={monitorJobId}
                />
              ) : null}
            </>
          )}
        </div>
      </section>
    </AdminShell>
  );
}
