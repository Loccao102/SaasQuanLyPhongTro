"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { StatusBadge } from "@propops/ui";
import { AdminShell } from "../../components/admin-shell";
import {
  adminNotificationsApi,
  type NotificationCampaignList,
  type NotificationCampaignSummary
} from "../../lib/admin-notifications-api";

function tone(status: string) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "PARTIAL_FAILED" || status === "MANUAL_REVIEW") return "warning" as const;
  if (status === "CANCELLED") return "neutral" as const;
  return "info" as const;
}

export function NotificationsClient() {
  const [data, setData] = useState<NotificationCampaignList | null>(null);
  const [selected, setSelected] = useState<NotificationCampaignSummary | null>(null);
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof adminNotificationsApi.detail>>["jobs"]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await adminNotificationsApi.list();
      setData(next);
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

  return (
    <AdminShell title="Thông báo & tin nhắn" eyebrow="AUTOMATION · LIVE QUEUE" activeNav="Thông báo">
      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Thao tác chưa hoàn tất.</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <section className="asset-context">
        <div>
          <span className="eyebrow">ZALO / NOTIFICATION QUEUE</span>
          <h2>{data?.organization.name ?? "Workspace hiện tại"}</h2>
          <p>Mỗi người nhận là một durable job; trạng thái UNKNOWN/MANUAL_REVIEW không được coi là gửi thành công.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setShowCreate((value) => !value)}>
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
              <span>Người nhận · mỗi dòng: recipientKey | Tên hiển thị</span>
              <textarea name="recipients" rows={8} required placeholder={"0901234567 | Nguyễn Văn A\n0909999999 | Trần B"} />
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
            <button className="secondary-button" type="button" onClick={() => void load()}>Refresh</button>
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
                    <StatusBadge tone={tone(campaign.status)}>{campaign.status}</StatusBadge>
                    <small>{campaign.sent} sent · {campaign.failed + campaign.manualReview} cần xử lý</small>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          {!selected ? (
            <div className="admin-state">
              <strong>Chọn một campaign để vận hành.</strong>
              <span>Pause, resume, cancel và retry đều được thực hiện server-side.</span>
            </div>
          ) : (
            <>
              <div className="asset-section-heading">
                <div><span className="eyebrow">{selected.provider}</span><h2>{selected.status}</h2></div>
                <StatusBadge tone={tone(selected.status)}>{selected.sent}/{selected.totalRecipients} SENT</StatusBadge>
              </div>
              <p className="notification-message-preview">{selected.messageBody}</p>
              <div className="notification-stats">
                <span>Queue <strong>{selected.queued}</strong></span>
                <span>Running <strong>{selected.running}</strong></span>
                <span>Retry <strong>{selected.retryWaiting}</strong></span>
                <span>Failed <strong>{selected.failed}</strong></span>
                <span>Review <strong>{selected.manualReview}</strong></span>
              </div>
              <div className="button-row">
                {selected.status === "PAUSED" ? (
                  <button className="secondary-button" disabled={saving} onClick={() => void mutate(() => adminNotificationsApi.resume(selected.id))}>Resume</button>
                ) : selected.status !== "CANCELLED" && selected.status !== "COMPLETED" ? (
                  <button className="secondary-button" disabled={saving} onClick={() => {
                    const reason = window.prompt("Lý do pause campaign:");
                    if (reason?.trim()) void mutate(() => adminNotificationsApi.pause(selected.id, reason.trim()));
                  }}>Pause</button>
                ) : null}
                {selected.failed + selected.manualReview > 0 && selected.status !== "CANCELLED" ? (
                  <button className="secondary-button" disabled={saving} onClick={() => void mutate(() => adminNotificationsApi.retry(selected.id))}>Retry lỗi/review</button>
                ) : null}
                {selected.status !== "CANCELLED" && selected.status !== "COMPLETED" ? (
                  <button className="danger-button" disabled={saving} onClick={() => {
                    const reason = window.prompt("Lý do hủy campaign:");
                    if (reason?.trim()) void mutate(() => adminNotificationsApi.cancel(selected.id, reason.trim()));
                  }}>Cancel pending</button>
                ) : null}
              </div>

              <div className="notification-job-list">
                {jobs.slice(0, 100).map((job) => (
                  <div className="notification-job-row" key={job.id}>
                    <div>
                      <strong>{job.recipientDisplayName ?? job.recipientKey}</strong>
                      <span>{job.recipientKey}</span>
                    </div>
                    <div>
                      <StatusBadge tone={tone(job.status)}>{job.status}</StatusBadge>
                      <small>{job.attemptCount}/{job.maxAttempts} · {job.verificationState}</small>
                    </div>
                    {job.lastErrorMessage ? <p>{job.lastErrorMessage}</p> : null}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </AdminShell>
  );
}
