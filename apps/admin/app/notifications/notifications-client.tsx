"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { StatusBadge } from "@propops/ui";
import Link from "next/link";
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
    case "SENT": return "Đã gửi thành công";
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
    case "RECIPIENT_NOT_FOUND":
      return "⚠️ Không tìm thấy Zalo: Số điện thoại chưa đăng ký Zalo hoặc người này chặn tìm kiếm bằng số điện thoại.";
    case "RECIPIENT_AMBIGUOUS":
      return "⚠️ Trùng tên hiển thị: Tìm thấy nhiều tài khoản trùng tên. Hệ thống dừng lại để tránh gửi nhầm người.";
    case "RECIPIENT_VERIFICATION_FAILED":
      return "⚠️ Không khớp người nhận: Tên trong khung chat Zalo không khớp với tên người thuê trên hợp đồng.";
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
  const [filterTab, setFilterTab] = useState<"ALL" | "MANUAL_REVIEW" | "SENT" | "PENDING" | "FAILED">("ALL");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [zaloConnected, setZaloConnected] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await adminNotificationsApi.list();
      setData(next);
      setZaloConnected((await adminZaloPersonalApi.status().catch(() => null))?.status === "CONNECTED");
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

  async function openCampaign(campaign: NotificationCampaignSummary) {
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
    } catch (mutation) {
      setError(mutation instanceof Error ? mutation.message : "Không thể cập nhật campaign.");
    } finally {
      setSaving(false);
    }
  }

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const recipientsText = String(form.get("recipients") ?? "");
    const recipients = recipientsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [recipientKey, ...nameParts] = line.split("|");
        return {
          recipientKey: recipientKey!.trim(),
          recipientDisplayName: nameParts.join("|").trim() || null
        };
      });

    await mutate(() =>
      adminNotificationsApi.create({
        idempotencyKey: crypto.randomUUID(),
        messageBody: String(form.get("messageBody") ?? ""),
        recipients
      })
    );
    setShowCreate(false);
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

      {!zaloConnected && !loading && (
        <section className="admin-state" role="status">
          Bạn cần liên kết Zalo của tổ chức trước khi gửi tin.
          <Link href="/zalo-personal" className="text-link" style={{ marginLeft: 12 }}>
            Kết nối Zalo 1 Chạm
          </Link>
        </section>
      )}
      <section className="asset-context">
        <div>
          <span className="eyebrow">ZALO / NOTIFICATION QUEUE</span>
          <h2>{data?.organization.name ?? "Workspace hiện tại"}</h2>
          <p>Mỗi người nhận là một nhiệm vụ độc lập (durable job); trạng thái UNKNOWN/MANUAL_REVIEW không bao giờ bị coi là gửi thành công.</p>
        </div>
        <button className="primary-button" type="button" disabled={!zaloConnected} onClick={() => setShowCreate((value) => !value)}>
          + Tạo chiến dịch
        </button>
      </section>

      {showCreate ? (
        <section className="panel">
          <div className="asset-section-heading">
            <div><span className="eyebrow">NEW CAMPAIGN</span><h2>Tạo chiến dịch thông báo</h2></div>
          </div>
          <form className="notification-create-form" onSubmit={(event) => void createCampaign(event)}>
            <label>
              <span>Nội dung</span>
              <textarea name="messageBody" rows={5} maxLength={4000} required placeholder="Nội dung tin nhắn..." />
            </label>
            <label>
              <span>Người nhận · mỗi dòng: Số điện thoại (tùy chọn thêm | Tên Zalo)</span>
              <textarea name="recipients" rows={8} required placeholder={"0901234567\n0909999999 | Trần B"} />
            </label>
            <div className="button-row">
              <button className="primary-button" type="submit" disabled={saving}>Xếp hàng gửi</button>
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
                    <small>{campaign.sent} đã gửi · {campaign.failed + campaign.manualReview} cần xử lý</small>
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
                <StatusBadge tone={campaignTone(selected.status)}>{selected.sent}/{selected.totalRecipients} ĐÃ GỬI</StatusBadge>
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
                  <button className="secondary-button" disabled={saving} onClick={() => void mutate(() => adminNotificationsApi.retry(selected.id))}>Gửi lại mục lỗi / cần kiểm tra</button>
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
            </>
          )}
        </div>
      </section>
    </AdminShell>
  );
}
