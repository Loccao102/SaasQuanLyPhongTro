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
  type CmsJobsStatus,
  type CmsNotificationJob,
  type CmsNotificationProvider,
  type CmsOrganization,
  type CmsPlan,
  type CmsSetting,
  type CmsSubscriptionStatus,
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
  | { kind: "provisionSubscription"; organization: CmsOrganization }
  | { kind: "transitionSubscription"; organization: CmsOrganization }
  | { kind: "changeSubscriptionPlan"; organization: CmsOrganization }
  | { kind: "retryNotificationJob"; job: CmsNotificationJob }
  | {
      kind: "notificationProviderControl";
      provider: CmsNotificationProvider;
      targetStatus: "ACTIVE" | "PAUSED";
    }
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
    [
      "PAST_DUE",
      "GRACE_PERIOD",
      "RUNNING",
      "RETRY",
      "WARN",
      "DEGRADED",
      "PAUSED"
    ].includes(status)
  ) {
    return "warning";
  }
  if (["SUSPENDED", "CANCELLED", "FAILED", "ERROR", "DISABLED"].includes(status)) {
    return "danger";
  }
  return "neutral";
}

function subscriptionTargets(
  status: string
): CmsSubscriptionStatus[] {
  switch (status) {
    case "TRIALING":
      return ["ACTIVE", "CANCELLED"];
    case "ACTIVE":
      return ["PAST_DUE", "CANCELLED"];
    case "PAST_DUE":
      return ["ACTIVE", "GRACE_PERIOD", "CANCELLED"];
    case "GRACE_PERIOD":
      return ["ACTIVE", "SUSPENDED", "CANCELLED"];
    case "SUSPENDED":
      return ["ACTIVE", "CANCELLED"];
    default:
      return [];
  }
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
  const [jobsStatus, setJobsStatus] = useState<CmsJobsStatus | null>(null);
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

      if (modal.kind === "provisionSubscription") {
        const planCode = String(data.get("planCode") ?? "");
        const status = String(
          data.get("subscriptionStatus") ?? ""
        ) as "TRIALING" | "ACTIVE";
        const rawTrialEndsAt = String(data.get("trialEndsAt") ?? "").trim();
        const trialEndsAt =
          status === "TRIALING" && rawTrialEndsAt
            ? new Date(rawTrialEndsAt).toISOString()
            : null;

        await cmsApi.provisionSubscription(modal.organization.id, {
          planCode,
          status,
          trialEndsAt,
          reason
        });
      }

      if (modal.kind === "transitionSubscription") {
        const expectedVersion = modal.organization.subscriptionVersion;
        if (expectedVersion === null) {
          throw new Error("Subscription version is missing. Refresh and retry.");
        }

        const to = String(
          data.get("targetStatus") ?? ""
        ) as CmsSubscriptionStatus;
        await cmsApi.transitionSubscription(modal.organization.id, {
          to,
          expectedVersion,
          reason
        });
      }

      if (modal.kind === "changeSubscriptionPlan") {
        const expectedVersion = modal.organization.subscriptionVersion;
        if (expectedVersion === null) {
          throw new Error("Subscription version is missing. Refresh and retry.");
        }

        const targetPlanCode = String(data.get("targetPlanCode") ?? "").trim();
        if (!targetPlanCode) {
          throw new Error("Target plan is required.");
        }

        await cmsApi.changeSubscriptionPlan(modal.organization.id, {
          targetPlanCode,
          expectedVersion,
          reason
        });
      }

      if (modal.kind === "entitlement") {
        const organizationId = String(data.get("organizationId") ?? "");
        const key = String(data.get("entitlementKey") ?? "") as CmsEntitlementOverride["key"];
        const rawValue = String(data.get("overrideValue") ?? "").trim();
        const booleanKey = key === "advanced_reports" || key === "audit_log";
        if (booleanKey && rawValue !== "true" && rawValue !== "false") {
          throw new Error("Boolean entitlement phải là true hoặc false.");
        }
        const value = booleanKey ? rawValue === "true" : Number(rawValue);
        if (!booleanKey && (!Number.isInteger(value) || Number(value) < 0)) {
          throw new Error("Numeric entitlement phải là số nguyên không âm.");
        }
        const rawExpiry = String(data.get("expiresAt") ?? "").trim();
        const expiresAt = rawExpiry
          ? new Date(rawExpiry).toISOString()
          : null;

        const updated = await cmsApi.setEntitlementOverride(
          organizationId,
          key,
          { value, expiresAt, reason }
        );
        setEntitlementOverrides((items) => [
          ...items.filter(
            (item) =>
              !(
                item.organizationId === updated.organizationId &&
                item.key === updated.key
              )
          ),
          updated
        ]);
      }

      if (modal.kind === "revokeEntitlement") {
        await cmsApi.revokeEntitlementOverride(
          modal.override.organizationId,
          modal.override.key,
          reason
        );
        setEntitlementOverrides((items) =>
          items.filter((item) => item.id !== modal.override.id)
        );
      }

      if (modal.kind === "retryNotificationJob") {
        await cmsApi.retryNotificationJob(modal.job.id, reason);
      }

      if (modal.kind === "notificationProviderControl") {
        await cmsApi.updateNotificationProviderControl(
          modal.provider.provider,
          modal.targetStatus,
          reason
        );
      }

      const [nextAudit, nextDashboard, nextOrganizations, nextJobs] =
        await Promise.all([
          cmsApi.audit(),
          cmsApi.dashboard(),
          cmsApi.organizations(),
          cmsApi.jobs()
        ]);
      setAudit(nextAudit);
      setDashboard(nextDashboard);
      setOrganizations(nextOrganizations);
      setJobsStatus(nextJobs);
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
                        <th />
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
                              <small>
                                {org.subscriptionVersion !== null
                                  ? "v" + String(org.subscriptionVersion)
                                  : "No subscription version"}
                              </small>
                            </td>
                            <td className={roomOver ? "danger-text" : undefined}>
                              {org.rooms} / {org.roomLimit ?? "—"}
                            </td>
                            <td>
                              {org.staff} / {org.staffLimit ?? "—"}
                            </td>
                            <td>
                              {org.automationQuota === null ? (
                                "—"
                              ) : (
                                <>
                                  <strong>
                                    {(
                                      org.automationUsed +
                                      org.automationReserved
                                    ).toLocaleString("vi-VN")}{" "}
                                    /{" "}
                                    {org.automationQuota.toLocaleString("vi-VN")}
                                  </strong>
                                  <small>
                                    {org.automationUsed.toLocaleString("vi-VN")}{" "}
                                    consumed ·{" "}
                                    {org.automationReserved.toLocaleString(
                                      "vi-VN"
                                    )}{" "}
                                    reserved
                                  </small>
                                </>
                              )}
                            </td>
                            <td>
                              {org.subscriptionStatus === "UNASSIGNED" ? (
                                <button
                                  className="text-button"
                                  type="button"
                                  disabled={plans.length === 0}
                                  onClick={() =>
                                    setModal({
                                      kind: "provisionSubscription",
                                      organization: org
                                    })
                                  }
                                >
                                  Provision
                                </button>
                              ) : (
                                <div className="table-actions">
                                  {subscriptionTargets(org.subscriptionStatus)
                                    .length > 0 ? (
                                    <button
                                      className="text-button"
                                      type="button"
                                      onClick={() =>
                                        setModal({
                                          kind: "transitionSubscription",
                                          organization: org
                                        })
                                      }
                                    >
                                      Transition
                                    </button>
                                  ) : null}
                                  {org.subscriptionStatus !== "CANCELLED" ? (
                                    <button
                                      className="text-button"
                                      type="button"
                                      disabled={plans.length === 0}
                                      onClick={() =>
                                        setModal({
                                          kind: "changeSubscriptionPlan",
                                          organization: org
                                        })
                                      }
                                    >
                                      Change plan
                                    </button>
                                  ) : (
                                    <span className="cms-note">Terminal</span>
                                  )}
                                </div>
                              )}
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

          {!loading && view === "entitlements" && (
            <section className="cms-panel">
              <SectionHeader
                title="Entitlement overrides"
                action={
                  <button
                    className="primary-button"
                    type="button"
                    disabled={organizations.length === 0}
                    onClick={() => setModal({ kind: "entitlement" })}
                  >
                    Thêm override
                  </button>
                }
              />
              <p className="cms-note">
                Override chỉ dành cho ngoại lệ theo organization. Plan vẫn là
                default source; override có thể đặt expiry và luôn được audit.
              </p>
              {entitlementOverrides.length === 0 ? (
                <div className="empty-state">
                  Chưa có entitlement override đang hoạt động.
                </div>
              ) : (
                <div className="cms-table-wrap">
                  <table className="cms-table">
                    <thead>
                      <tr>
                        <th>Organization</th>
                        <th>Key</th>
                        <th>Value</th>
                        <th>Expires</th>
                        <th>Reason</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {entitlementOverrides.map((override) => (
                        <tr key={override.id}>
                          <td>
                            <strong>{override.organizationName}</strong>
                            <small>{override.organizationId}</small>
                          </td>
                          <td>{override.key}</td>
                          <td>{pretty(override.value)}</td>
                          <td>
                            {override.expiresAt
                              ? new Date(override.expiresAt).toLocaleString(
                                  "vi-VN"
                                )
                              : "Không hết hạn"}
                          </td>
                          <td>{override.reason}</td>
                          <td>
                            <button
                              className="text-button text-button--danger"
                              type="button"
                              onClick={() =>
                                setModal({
                                  kind: "revokeEntitlement",
                                  override
                                })
                              }
                            >
                              Revoke
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {!loading && view === "jobs" && (
            <section className="cms-panel">
              <SectionHeader
                title="Operational jobs"
                action={
                  <span className="cms-note">
                    Durable queue state · manual retry audited
                  </span>
                }
              />
              <div className="cms-state">
                <strong>
                  {jobsStatus?.connected
                    ? "Notification job persistence connected"
                    : "Job persistence chưa được nối"}
                </strong>
                <span>{jobsStatus?.reason}</span>
              </div>
              {jobsStatus?.connected && jobsStatus.providers.length > 0 ? (
                <div className="cms-table-wrap">
                  <table className="cms-table">
                    <thead>
                      <tr>
                        <th>Provider</th>
                        <th>Control</th>
                        <th>Workers</th>
                        <th>Last heartbeat</th>
                        <th>Reason</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {jobsStatus.providers.map((provider) => (
                        <tr key={provider.provider}>
                          <td>
                            <strong>{provider.provider}</strong>
                          </td>
                          <td>
                            <StatusBadge tone={statusTone(provider.status)}>
                              {provider.status}
                            </StatusBadge>
                          </td>
                          <td>
                            {provider.healthyWorkers} healthy /{" "}
                            {provider.degradedWorkers} degraded
                            <small>{provider.workerCount} registered</small>
                          </td>
                          <td>
                            {provider.lastSeenAt
                              ? new Date(provider.lastSeenAt).toLocaleString(
                                  "vi-VN"
                                )
                              : "—"}
                          </td>
                          <td>{provider.reason ?? "—"}</td>
                          <td>
                            <button
                              className={
                                provider.status === "ACTIVE"
                                  ? "text-button text-button--danger"
                                  : "text-button"
                              }
                              type="button"
                              onClick={() =>
                                setModal({
                                  kind: "notificationProviderControl",
                                  provider,
                                  targetStatus:
                                    provider.status === "ACTIVE"
                                      ? "PAUSED"
                                      : "ACTIVE"
                                })
                              }
                            >
                              {provider.status === "ACTIVE"
                                ? "Pause"
                                : "Resume"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {jobsStatus?.connected && jobsStatus.entries.length === 0 ? (
                <div className="empty-state">Chưa có notification job.</div>
              ) : null}
              {jobsStatus?.connected && jobsStatus.entries.length > 0 ? (
                <div className="cms-table-wrap">
                  <table className="cms-table">
                    <thead>
                      <tr>
                        <th>Organization / recipient</th>
                        <th>Status</th>
                        <th>Attempts</th>
                        <th>Verification</th>
                        <th>Provider</th>
                        <th>Last error</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {jobsStatus.entries.map((job) => (
                        <tr key={job.id}>
                          <td>
                            <strong>{job.organizationName}</strong>
                            <small>
                              {job.recipientDisplayName ?? job.recipientKey} ·{" "}
                              {job.campaignId}
                            </small>
                          </td>
                          <td>
                            <StatusBadge tone={statusTone(job.status)}>
                              {job.status}
                            </StatusBadge>
                            <small>{job.campaignStatus}</small>
                          </td>
                          <td>
                            {job.attemptCount} / {job.maxAttempts}
                            {job.nextAttemptAt ? (
                              <small>
                                next{" "}
                                {new Date(job.nextAttemptAt).toLocaleString(
                                  "vi-VN"
                                )}
                              </small>
                            ) : null}
                          </td>
                          <td>{job.verificationState}</td>
                          <td>{job.provider}</td>
                          <td>
                            {job.lastErrorCode ?? "—"}
                            {job.lastErrorMessage ? (
                              <small>{job.lastErrorMessage}</small>
                            ) : null}
                          </td>
                          <td>
                            {job.status === "FAILED" ||
                            job.status === "MANUAL_REVIEW" ? (
                              <button
                                className="text-button"
                                type="button"
                                onClick={() =>
                                  setModal({
                                    kind: "retryNotificationJob",
                                    job
                                  })
                                }
                              >
                                Retry
                              </button>
                            ) : (
                              <span className="cms-note">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
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

            {modal.kind === "provisionSubscription" && (
              <>
                <h2>Provision subscription</h2>
                <p className="modal-warning">
                  {modal.organization.name} sẽ snapshot current plan version.
                  Plan thay đổi về sau không rewrite subscription này.
                </p>
                <label>
                  Plan
                  <select name="planCode" required>
                    {plans
                      .filter((plan) => plan.status === "ACTIVE")
                      .map((plan) => (
                        <option value={plan.code} key={plan.code}>
                          {plan.name} · v{plan.version}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Initial status
                  <select name="subscriptionStatus" defaultValue="TRIALING">
                    <option value="TRIALING">TRIALING</option>
                    <option value="ACTIVE">ACTIVE</option>
                  </select>
                </label>
                <label>
                  Trial end (optional; ignored for ACTIVE)
                  <input name="trialEndsAt" type="datetime-local" />
                </label>
              </>
            )}

            {modal.kind === "transitionSubscription" && (
              <>
                <h2>Transition subscription</h2>
                <p className="modal-warning">
                  {modal.organization.name} · {modal.organization.subscriptionStatus}
                  {" → "}target state. Current optimistic version:{" "}
                  {modal.organization.subscriptionVersion ?? "—"}.
                </p>
                <label>
                  Target status
                  <select name="targetStatus" required>
                    {subscriptionTargets(
                      modal.organization.subscriptionStatus
                    ).map((status) => (
                      <option value={status} key={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            {modal.kind === "changeSubscriptionPlan" && (
              <>
                <h2>Change subscription plan</h2>
                <p className="modal-warning">
                  {modal.organization.name} · current plan{" "}
                  {modal.organization.planCode ?? "—"}. This command changes the
                  plan-version snapshot only; it does not charge or refund money.
                </p>
                <label>
                  Target plan
                  <select name="targetPlanCode" required>
                    {plans
                      .filter((plan) => plan.status === "ACTIVE")
                      .map((plan) => (
                        <option value={plan.code} key={plan.code}>
                          {plan.name} · v{plan.version}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}

            {modal.kind === "entitlement" && (
              <>
                <h2>Thêm entitlement override</h2>
                <p className="modal-warning">
                  Override sẽ supersede override chưa revoke cùng key của
                  organization. Dữ liệu plan không bị sửa.
                </p>
                <label>
                  Organization
                  <select name="organizationId" required>
                    {organizations.map((organization) => (
                      <option value={organization.id} key={organization.id}>
                        {organization.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Entitlement key
                  <select name="entitlementKey" required>
                    <option value="room_limit">room_limit</option>
                    <option value="staff_limit">staff_limit</option>
                    <option value="automation_actions_monthly">
                      automation_actions_monthly
                    </option>
                    <option value="advanced_reports">advanced_reports</option>
                    <option value="audit_log">audit_log</option>
                  </select>
                </label>
                <label>
                  Value
                  <input
                    name="overrideValue"
                    type="text"
                    placeholder="350 hoặc true / false"
                    required
                  />
                </label>
                <label>
                  Hết hạn (tùy chọn)
                  <input name="expiresAt" type="datetime-local" />
                </label>
              </>
            )}

            {modal.kind === "revokeEntitlement" && (
              <>
                <h2>Revoke entitlement override</h2>
                <p className="modal-warning">
                  {modal.override.organizationName} · {modal.override.key} ={" "}
                  {pretty(modal.override.value)} sẽ quay về giá trị từ plan sau
                  khi revoke.
                </p>
              </>
            )}

            {modal.kind === "retryNotificationJob" && (
              <>
                <h2>Retry notification job</h2>
                <p className="modal-warning">
                  {modal.job.organizationName} ·{" "}
                  {modal.job.recipientDisplayName ?? modal.job.recipientKey}. Job{" "}
                  {modal.job.status} sẽ quay lại QUEUED; quota đã consume trước đó
                  không bị trừ thêm khi worker claim retry.
                </p>
              </>
            )}

            {modal.kind === "notificationProviderControl" && (
              <>
                <h2>
                  {modal.targetStatus === "PAUSED" ? "Pause" : "Resume"}{" "}
                  notification provider
                </h2>
                <p className="modal-warning">
                  {modal.provider.provider} · {modal.provider.status}
                  {" → "}
                  {modal.targetStatus}. Khi PAUSED, worker vẫn heartbeat nhưng API
                  sẽ không claim job mới cho provider này.
                </p>
              </>
            )}

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
