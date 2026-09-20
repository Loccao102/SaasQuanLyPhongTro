"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";
import {
  MetricCard,
  SectionHeader,
  StatusBadge
} from "@propops/ui";
import {
  cmsApi,
  type CmsAuditEvent,
  type CmsDashboard,
  type CmsEntitlementOverride,
  type CmsOrganization,
  type CmsPlan,
  type CmsSetting,
  type IntegrationStatus
} from "../lib/cms-api";

type View =
  | "dashboard"
  | "settings"
  | "plans"
  | "organizations"
  | "entitlements"
  | "jobs"
  | "logs"
  | "audit";
type Tone = "neutral" | "success" | "warning" | "danger" | "info";
type ModalState =
  | { kind: "setting"; key: string }
  | { kind: "plan"; code: string }
  | { kind: "entitlement" }
  | { kind: "revokeEntitlement"; override: CmsEntitlementOverride }
  | null;

const navItems: Array<{ id: View; label: string }> = [
  { id: "dashboard", label: "Tổng quan" },
  { id: "settings", label: "Cấu hình" },
  { id: "plans", label: "Gói & giới hạn" },
  { id: "organizations", label: "Organizations" },
  { id: "entitlements", label: "Entitlement overrides" },
  { id: "jobs", label: "Jobs / Queue" },
  { id: "logs", label: "Technical logs" },
  { id: "audit", label: "Audit log" }
];

function statusTone(status: string): Tone {
  if (["ACTIVE", "TRIALING", "INFO", "ENABLED", "HEALTHY"].includes(status)) {
    return "success";
  }
  if (
    ["PAST_DUE", "GRACE_PERIOD", "RUNNING", "RETRY", "WARN", "DEGRADED"].includes(
      status
    )
  ) {
    return "warning";
  }
  if (["SUSPENDED", "FAILED", "ERROR", "DISABLED"].includes(status)) {
    return "danger";
  }
  return "neutral";
}

function money(value: number): string {
  return new Intl.NumberFormat("vi-VN").format(value) + "đ";
}

function pretty(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export default function CmsPage() {
  const [view, setView] = useState<View>("dashboard");
  const [dashboard, setDashboard] = useState<CmsDashboard | null>(null);
  const [settings, setSettings] = useState<CmsSetting[]>([]);
  const [plans, setPlans] = useState<CmsPlan[]>([]);
  const [organizations, setOrganizations] = useState<CmsOrganization[]>([]);
  const [entitlementOverrides, setEntitlementOverrides] = useState<CmsEntitlementOverride[]>([]);
  const [audit, setAudit] = useState<CmsAuditEvent[]>([]);
  const [jobsStatus, setJobsStatus] = useState<IntegrationStatus | null>(null);
  const [logsStatus, setLogsStatus] = useState<IntegrationStatus | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        nextDashboard,
        nextSettings,
        nextPlans,
        nextOrganizations,
        nextEntitlementOverrides,
        nextAudit,
        nextJobs,
        nextLogs
      ] = await Promise.all([
          cmsApi.dashboard(),
          cmsApi.settings(),
          cmsApi.plans(),
          cmsApi.organizations(),
          cmsApi.entitlementOverrides(),
          cmsApi.audit(),
          cmsApi.jobs(),
          cmsApi.logs()
        ]);
      setDashboard(nextDashboard);
      setSettings(nextSettings);
      setPlans(nextPlans);
      setOrganizations(nextOrganizations);
      setEntitlementOverrides(nextEntitlementOverrides);
      setAudit(nextAudit);
      setJobsStatus(nextJobs);
      setLogsStatus(nextLogs);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không thể tải dữ liệu CMS."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const planByCode = useMemo(
    () => new Map(plans.map((item) => [item.code, item])),
    [plans]
  );
  const overLimit = organizations.filter(
    (org) => org.roomLimit !== null && org.rooms > org.roomLimit
  ).length;

  async function submitModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;

    const data = new FormData(event.currentTarget);
    const reason = String(data.get("reason") ?? "").trim();
    if (reason.length < 3) return;

    setSaving(true);
    setError(null);
    try {
      if (modal.kind === "setting") {
        const current = settings.find((item) => item.key === modal.key);
        if (!current) return;
        const raw = data.get("value");
        const value =
          current.type === "BOOLEAN"
            ? raw === "true"
            : current.type === "INTEGER"
              ? Number(raw)
              : String(raw ?? "");
        const updated = await cmsApi.updateSetting(current.key, {
          value,
          expectedVersion: current.version,
          reason
        });
        setSettings((items) =>
          items.map((item) => (item.key === updated.key ? updated : item))
        );
      }

      if (modal.kind === "plan") {
        const current = plans.find((item) => item.code === modal.code);
        if (!current) return;
        const updated = await cmsApi.updatePlan(current.code, {
          monthlyPriceVnd: Number(data.get("monthlyPriceVnd")),
          roomLimit: Number(data.get("roomLimit")),
          staffLimit: Number(data.get("staffLimit")),
          automationQuota: Number(data.get("automationQuota")),
          expectedVersion: current.version,
          reason
        });
        setPlans((items) =>
          items.map((item) => (item.code === updated.code ? updated : item))
        );
      }

      const [nextAudit, nextDashboard] = await Promise.all([
        cmsApi.audit(),
        cmsApi.dashboard()
      ]);
      setAudit(nextAudit);
      setDashboard(nextDashboard);
      setModal(null);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Không thể lưu thay đổi."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cms-shell">
      <aside className="cms-sidebar">
        <div className="cms-brand">
          <span className="cms-brand__mark">P</span>
          <div>
            <strong>PropOps</strong>
            <span>Internal CMS</span>
          </div>
        </div>
        <nav className="cms-nav" aria-label="CMS navigation">
          {navItems.map((item) => (
            <button
              className={
                view === item.id
                  ? "cms-nav__item cms-nav__item--active"
                  : "cms-nav__item"
              }
              type="button"
              key={item.id}
              onClick={() => setView(item.id)}
              aria-current={view === item.id ? "page" : undefined}
            >
              <span className="cms-nav__dot" aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="cms-sidebar__footer">
          <span>Platform principal</span>
          <strong>Server-authorized</strong>
          <small>Local dev uses CMS_DEV_USER_ID on the API only.</small>
        </div>
      </aside>

      <main className="cms-main">
        <div className="cms-warning" role="note">
          CMS dùng SaaS PostgreSQL qua /api/cms/*. Browser không được quyền chọn platform user hay ghi DB trực tiếp.
        </div>

        <header className="cms-topbar">
          <div>
            <span className="cms-eyebrow">INTERNAL SAAS OPERATIONS</span>
            <h1>{navItems.find((item) => item.id === view)?.label}</h1>
          </div>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            Refresh
          </button>
        </header>

        <div className="cms-content">
          {loading && <div className="cms-state">Đang tải dữ liệu CMS…</div>}
          {error && (
            <div className="cms-state cms-state--error">
              <strong>Không thể hoàn tất thao tác.</strong>
              <span>{error}</span>
            </div>
          )}

          {!loading && view === "dashboard" && dashboard && (
            <>
              <section className="cms-metrics" aria-label="CMS summary">
                <MetricCard
                  label="Organizations"
                  value={String(dashboard.organizationCount)}
                  detail="Nguồn thật từ SaaS DB"
                  tone="info"
                />
                <MetricCard
                  label="Active rooms"
                  value={String(dashboard.activeRoomCount)}
                  detail={overLimit + " organization đang over-limit"}
                  tone={overLimit ? "warning" : "success"}
                />
                <MetricCard
                  label="Plans"
                  value={String(dashboard.activePlanCount)}
                  detail="Versioned plan configuration"
                  tone="neutral"
                />
                <MetricCard
                  label="Audit 24h"
                  value={String(dashboard.platformAudit24h)}
                  detail={dashboard.settingCount + " system settings"}
                  tone="neutral"
                />
              </section>

              <section className="cms-grid">
                <article className="cms-panel">
                  <SectionHeader title="Organizations cần chú ý" />
                  {organizations.length === 0 ? (
                    <div className="empty-state">Chưa có organization.</div>
                  ) : (
                    <div className="cms-table-wrap">
                      <table className="cms-table">
                        <thead>
                          <tr>
                            <th>Organization</th>
                            <th>Subscription</th>
                            <th>Plan</th>
                            <th>Rooms</th>
                          </tr>
                        </thead>
                        <tbody>
                          {organizations
                            .filter(
                              (org) =>
                                org.subscriptionStatus !== "ACTIVE" ||
                                (org.roomLimit !== null &&
                                  org.rooms > org.roomLimit)
                            )
                            .map((org) => (
                              <tr key={org.id}>
                                <td>
                                  <strong>{org.name}</strong>
                                  <small>{org.slug}</small>
                                </td>
                                <td>
                                  <StatusBadge
                                    tone={statusTone(org.subscriptionStatus)}
                                  >
                                    {org.subscriptionStatus}
                                  </StatusBadge>
                                </td>
                                <td>{org.planCode ?? "—"}</td>
                                <td>
                                  {org.rooms} / {org.roomLimit ?? "—"}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </article>

                <article className="cms-panel">
                  <SectionHeader title="Integrations" />
                  <div className="health-list">
                    <div>
                      <span>CMS API / PostgreSQL</span>
                      <StatusBadge tone="success">CONNECTED</StatusBadge>
                    </div>
                    <div>
                      <span>Jobs persistence</span>
                      <StatusBadge tone="warning">
                        {jobsStatus?.connected ? "CONNECTED" : "PENDING"}
                      </StatusBadge>
                    </div>
                    <div>
                      <span>Observability logs</span>
                      <StatusBadge tone="warning">
                        {logsStatus?.connected ? "CONNECTED" : "PENDING"}
                      </StatusBadge>
                    </div>
                  </div>
                </article>
              </section>
            </>
          )}

          {!loading &&
            view === "settings" &&
            ["General", "Billing", "Automation"].map((group) => (
              <section className="cms-panel" key={group}>
                <SectionHeader title={group} />
                <div className="settings-list">
                  {settings
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <div className="setting-row" key={item.key}>
                        <div>
                          <strong>{item.label}</strong>
                          <small>
                            {item.key} · v{item.version}
                          </small>
                        </div>
                        <div>
                          <span>
                            {item.type === "BOOLEAN" ? (
                              <StatusBadge
                                tone={statusTone(
                                  item.value ? "ENABLED" : "DISABLED"
                                )}
                              >
                                {item.value ? "ENABLED" : "DISABLED"}
                              </StatusBadge>
                            ) : (
                              pretty(item.value)
                            )}
                          </span>
                          <small>{item.description}</small>
                        </div>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() =>
                            setModal({ kind: "setting", key: item.key })
                          }
                        >
                          Chỉnh
                        </button>
                      </div>
                    ))}
                </div>
              </section>
            ))}

          {!loading && view === "plans" && (
            <section className="cms-panel">
              <SectionHeader
                title="Pricing configuration"
                action={
                  <span className="cms-note">
                    Mỗi lần sửa tạo plan version mới.
                  </span>
                }
              />
              <div className="cms-table-wrap">
                <table className="cms-table">
                  <thead>
                    <tr>
                      <th>Plan</th>
                      <th>Version</th>
                      <th>Monthly</th>
                      <th>Rooms</th>
                      <th>Staff</th>
                      <th>Automation</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map((plan) => (
                      <tr key={plan.code}>
                        <td>
                          <strong>{plan.name}</strong>
                          <small>{plan.code}</small>
                        </td>
                        <td>v{plan.version}</td>
                        <td>{money(plan.monthlyPriceVnd)}</td>
                        <td>{plan.roomLimit}</td>
                        <td>{plan.staffLimit}</td>
                        <td>
                          {plan.automationQuota.toLocaleString("vi-VN")}
                        </td>
                        <td>
                          <button
                            className="text-button"
                            type="button"
                            onClick={() =>
                              setModal({ kind: "plan", code: plan.code })
                            }
                          >
                            Chỉnh
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="cms-callout">
                Existing subscription giữ plan_version_id đã snapshot; sửa giá
                hiện tại không rewrite lịch sử.
              </p>
            </section>
          )}

          {!loading && view === "organizations" && (
            <section className="cms-panel">
              <SectionHeader
                title="Organization inspection"
                action={
                  <span className="cms-note">
                    Read từ SaaS source of truth.
                  </span>
                }
              />
              {organizations.length === 0 ? (
                <div className="empty-state">Chưa có organization.</div>
              ) : (
                <div className="cms-table-wrap">
                  <table className="cms-table">
                    <thead>
                      <tr>
                        <th>Organization</th>
                        <th>Plan</th>
                        <th>Subscription</th>
                        <th>Rooms</th>
                        <th>Staff</th>
                        <th>Automation quota</th>
                      </tr>
                    </thead>
                    <tbody>
                      {organizations.map((org) => {
                        const roomOver =
                          org.roomLimit !== null && org.rooms > org.roomLimit;
                        return (
                          <tr key={org.id}>
                            <td>
                              <strong>{org.name}</strong>
                              <small>
                                {org.ownerName ?? "No active owner"} · {org.slug}
                              </small>
                            </td>
                            <td>{org.planCode ?? "—"}</td>
                            <td>
                              <StatusBadge
                                tone={statusTone(org.subscriptionStatus)}
                              >
                                {org.subscriptionStatus}
                              </StatusBadge>
                            </td>
                            <td className={roomOver ? "danger-text" : undefined}>
                              {org.rooms} / {org.roomLimit ?? "—"}
                            </td>
                            <td>
                              {org.staff} / {org.staffLimit ?? "—"}
                            </td>
                            <td>
                              {org.automationQuota?.toLocaleString("vi-VN") ??
                                "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {!loading && view === "jobs" && (
            <section className="cms-panel">
              <SectionHeader title="Operational jobs" />
              <div className="cms-state">
                <strong>
                  {jobsStatus?.connected
                    ? "Job integration connected"
                    : "Job persistence chưa được nối"}
                </strong>
                <span>{jobsStatus?.reason}</span>
              </div>
            </section>
          )}

          {!loading && view === "logs" && (
            <section className="cms-panel">
              <SectionHeader title="Technical logs" />
              <div className="cms-state">
                <strong>
                  {logsStatus?.connected
                    ? "Observability connected"
                    : "Observability chưa được nối"}
                </strong>
                <span>{logsStatus?.reason}</span>
              </div>
            </section>
          )}

          {!loading && view === "audit" && (
            <section className="cms-panel">
              <SectionHeader
                title="Platform audit"
                action={<span className="cms-note">Read-only.</span>}
              />
              {audit.length === 0 ? (
                <div className="empty-state">Chưa có platform audit event.</div>
              ) : (
                <div className="audit-list">
                  {audit.map((item) => (
                    <article className="audit-item" key={item.id}>
                      <div>
                        <strong>{item.action}</strong>
                        <StatusBadge>{item.target}</StatusBadge>
                      </div>
                      <p>
                        {pretty(item.before)} → {pretty(item.after)}
                      </p>
                      <small>
                        {new Date(item.at).toLocaleString("vi-VN")} ·{" "}
                        {item.actor} · Reason: {item.reason}
                      </small>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </main>

      {modal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setModal(null);
          }}
        >
          <form
            className="cms-modal"
            role="dialog"
            aria-modal="true"
            onSubmit={submitModal}
          >
            {modal.kind === "setting" &&
              (() => {
                const item = settings.find((value) => value.key === modal.key);
                if (!item) return null;
                return (
                  <>
                    <h2>Chỉnh {item.label}</h2>
                    <p className="modal-warning">
                      Backend sẽ kiểm tra version, validate kiểu dữ liệu,
                      idempotency và ghi audit trong cùng transaction.
                    </p>
                    <label>
                      Giá trị
                      {item.type === "BOOLEAN" ? (
                        <select name="value" defaultValue={String(item.value)}>
                          <option value="true">Enabled</option>
                          <option value="false">Disabled</option>
                        </select>
                      ) : (
                        <input
                          name="value"
                          type={item.type === "INTEGER" ? "number" : "text"}
                          min={item.type === "INTEGER" ? 0 : undefined}
                          defaultValue={String(item.value)}
                          required
                        />
                      )}
                    </label>
                  </>
                );
              })()}

            {modal.kind === "plan" &&
              (() => {
                const item = planByCode.get(modal.code);
                if (!item) return null;
                return (
                  <>
                    <h2>Chỉnh {item.name}</h2>
                    <p className="modal-warning">
                      Tạo version mới; subscription cũ không bị rewrite.
                    </p>
                    <label>
                      Giá/tháng (VND)
                      <input
                        name="monthlyPriceVnd"
                        type="number"
                        min={0}
                        step={1000}
                        defaultValue={item.monthlyPriceVnd}
                        required
                      />
                    </label>
                    <label>
                      Room limit
                      <input
                        name="roomLimit"
                        type="number"
                        min={1}
                        defaultValue={item.roomLimit}
                        required
                      />
                    </label>
                    <label>
                      Staff limit
                      <input
                        name="staffLimit"
                        type="number"
                        min={1}
                        defaultValue={item.staffLimit}
                        required
                      />
                    </label>
                    <label>
                      Automation quota
                      <input
                        name="automationQuota"
                        type="number"
                        min={0}
                        defaultValue={item.automationQuota}
                        required
                      />
                    </label>
                  </>
                );
              })()}

            <label>
              Lý do
              <textarea
                name="reason"
                minLength={3}
                required
                placeholder="Ghi lý do để audit..."
              />
            </label>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={saving}
                onClick={() => setModal(null)}
              >
                Hủy
              </button>
              <button className="primary-button" type="submit" disabled={saving}>
                {saving ? "Đang lưu…" : "Xác nhận thay đổi"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
