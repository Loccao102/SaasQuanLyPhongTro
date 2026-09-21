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
  type CmsBillingReconciliation,
  type CmsBillingWebhookEvent,
  type CmsBootstrap,
  type CmsDashboard,
  type CmsEntitlementOverride,
  type CmsJobsStatus,
  type CmsNotificationJob,
  type CmsNotificationProvider,
  type CmsOrganization,
  type CmsPlatformPermission,
  type CmsProviderPaymentReview,
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
  | "billing"
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
  | {
      kind: "subscriptionCancellation";
      organization: CmsOrganization;
      cancelAtPeriodEnd: boolean;
    }
  | { kind: "manualSubscriptionPayment"; organization: CmsOrganization }
  | {
      kind: "allocateProviderPayment";
      payment: CmsProviderPaymentReview;
    }
  | {
      kind: "requeueBillingWebhook";
      event: CmsBillingWebhookEvent;
    }
  | { kind: "retryNotificationJob"; job: CmsNotificationJob }
  | {
      kind: "notificationProviderControl";
      provider: CmsNotificationProvider;
      targetStatus: "ACTIVE" | "PAUSED";
    }
  | null;

const navItems: Array<{
  id: View;
  label: string;
  permission?: CmsPlatformPermission;
}> = [
  { id: "dashboard", label: "Tổng quan" },
  { id: "settings", label: "Cấu hình" },
  { id: "plans", label: "Gói & giới hạn" },
  {
    id: "organizations",
    label: "Organizations",
    permission: "platform.organizations.inspect"
  },
  {
    id: "billing",
    label: "SaaS Billing",
    permission: "platform.billing.read"
  },
  {
    id: "entitlements",
    label: "Entitlement overrides",
    permission: "platform.organizations.inspect"
  },
  { id: "jobs", label: "Jobs / Queue", permission: "platform.jobs.read" },
  { id: "logs", label: "Technical logs", permission: "platform.logs.read" },
  { id: "audit", label: "Audit log", permission: "platform.audit.read" }
];

function statusTone(status: string): Tone {
  if (
    [
      "ACTIVE",
      "TRIALING",
      "INFO",
      "ENABLED",
      "HEALTHY",
      "PAID",
      "ALLOCATED"
    ].includes(
      status
    )
  ) {
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
      "PAUSED",
      "OPEN",
      "PARTIALLY_PAID",
      "REVIEW_REQUIRED",
      "UNALLOCATED"
    ].includes(status)
  ) {
    return "warning";
  }
  if (
    [
      "SUSPENDED",
      "CANCELLED",
      "FAILED",
      "ERROR",
      "DISABLED",
      "OVERDUE"
    ].includes(status)
  ) {
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
  const [bootstrap, setBootstrap] = useState<CmsBootstrap | null>(null);
  const [dashboard, setDashboard] = useState<CmsDashboard | null>(null);
  const [settings, setSettings] = useState<CmsSetting[]>([]);
  const [plans, setPlans] = useState<CmsPlan[]>([]);
  const [organizations, setOrganizations] = useState<CmsOrganization[]>([]);
  const [entitlementOverrides, setEntitlementOverrides] = useState<CmsEntitlementOverride[]>([]);
  const [audit, setAudit] = useState<CmsAuditEvent[]>([]);
  const [jobsStatus, setJobsStatus] = useState<CmsJobsStatus | null>(null);
  const [billingReconciliation, setBillingReconciliation] =
    useState<CmsBillingReconciliation | null>(null);
  const [logsStatus, setLogsStatus] = useState<IntegrationStatus | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextBootstrap = await cmsApi.bootstrap();
      setBootstrap(nextBootstrap);

      const can = (permission: CmsPlatformPermission) =>
        nextBootstrap.permissions.includes(permission);

      const [
        nextDashboard,
        nextSettings,
        nextPlans,
        nextOrganizations,
        nextEntitlementOverrides,
        nextAudit,
        nextJobs,
        nextBillingReconciliation,
        nextLogs
      ] = await Promise.all([
        cmsApi.dashboard(),
        cmsApi.settings(),
        cmsApi.plans(),
        can("platform.organizations.inspect")
          ? cmsApi.organizations()
          : Promise.resolve([]),
        can("platform.organizations.inspect")
          ? cmsApi.entitlementOverrides()
          : Promise.resolve([]),
        can("platform.audit.read")
          ? cmsApi.audit()
          : Promise.resolve([]),
        can("platform.jobs.read")
          ? cmsApi.jobs()
          : Promise.resolve(null),
        can("platform.billing.read")
          ? cmsApi.billingReconciliation()
          : Promise.resolve(null),
        can("platform.logs.read")
          ? cmsApi.logs()
          : Promise.resolve(null)
      ]);

      setDashboard(nextDashboard);
      setSettings(nextSettings);
      setPlans(nextPlans);
      setOrganizations(nextOrganizations);
      setEntitlementOverrides(nextEntitlementOverrides);
      setAudit(nextAudit);
      setJobsStatus(nextJobs);
      setBillingReconciliation(nextBillingReconciliation);
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

  const hasPermission = useCallback(
    (permission: CmsPlatformPermission) =>
      bootstrap?.permissions.includes(permission) ?? false,
    [bootstrap]
  );

  const visibleNavItems = useMemo(
    () =>
      bootstrap
        ? navItems.filter(
            (item) =>
              item.permission === undefined ||
              bootstrap.permissions.includes(item.permission)
          )
        : navItems.filter((item) => item.id === "dashboard"),
    [bootstrap]
  );

  useEffect(() => {
    if (
      bootstrap &&
      !visibleNavItems.some((item) => item.id === view)
    ) {
      setView("dashboard");
    }
  }, [bootstrap, visibleNavItems, view]);

  const planByCode = useMemo(
    () => new Map(plans.map((item) => [item.code, item])),
    [plans]
  );
  const organizationById = useMemo(
    () => new Map(organizations.map((item) => [item.id, item])),
    [organizations]
  );
  const reconciliationInvoiceByReference = useMemo(
    () =>
      new Map(
        (billingReconciliation?.invoices ?? []).map((item) => [
          item.paymentReference,
          item
        ])
      ),
    [billingReconciliation]
  );

  const overLimit = organizations.filter(
    (org) => org.roomLimit !== null && org.rooms > org.roomLimit
  ).length;

  const dashboardNumber = (value: number) =>
    new Intl.NumberFormat(dashboard?.display.locale ?? "vi-VN").format(value);
  const dashboardMoney = (value: number) =>
    new Intl.NumberFormat(dashboard?.display.locale ?? "vi-VN", {
      style: "currency",
      currency: dashboard?.display.currencyCode ?? "VND",
      maximumFractionDigits: 0
    }).format(value);
  const dashboardPercent = (value: number) =>
    new Intl.NumberFormat(dashboard?.display.locale ?? "vi-VN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1
    }).format(value) + "%";

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
        const billingInterval = String(
          data.get("billingInterval") ?? "MONTHLY"
        ) as "MONTHLY" | "YEARLY";
        const rawTrialEndsAt = String(data.get("trialEndsAt") ?? "").trim();
        const trialEndsAt =
          status === "TRIALING" && rawTrialEndsAt
            ? new Date(rawTrialEndsAt).toISOString()
            : null;

        await cmsApi.provisionSubscription(modal.organization.id, {
          planCode,
          status,
          billingInterval,
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

      if (modal.kind === "subscriptionCancellation") {
        const expectedVersion = modal.organization.subscriptionVersion;
        if (expectedVersion === null) {
          throw new Error("Subscription version is missing. Refresh and retry.");
        }

        await cmsApi.setSubscriptionCancellation(
          modal.organization.id,
          {
            cancelAtPeriodEnd: modal.cancelAtPeriodEnd,
            expectedVersion,
            reason
          }
        );
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

      if (modal.kind === "manualSubscriptionPayment") {
        const invoice = modal.organization.latestInvoice;
        if (!invoice) {
          throw new Error("Organization không có invoice để thanh toán.");
        }
        if (
          invoice.status !== "OPEN" &&
          invoice.status !== "PARTIALLY_PAID"
        ) {
          throw new Error(
            "Invoice hiện tại không còn ở trạng thái nhận thanh toán."
          );
        }

        const amountVnd = Number(data.get("paymentAmountVnd"));
        if (
          !Number.isInteger(amountVnd) ||
          amountVnd <= 0 ||
          amountVnd > invoice.remainingAmountVnd
        ) {
          throw new Error(
            "Số tiền phải là số nguyên dương và không vượt quá số tiền còn lại."
          );
        }

        await cmsApi.recordSubscriptionPayment(
          modal.organization.id,
          invoice.id,
          amountVnd,
          reason
        );
      }

      if (modal.kind === "allocateProviderPayment") {
        const invoiceId = String(
          data.get("reconciliationInvoiceId") ?? ""
        ).trim();
        const amountVnd = Number(
          data.get("reconciliationAmountVnd")
        );
        const invoice = billingReconciliation?.invoices.find(
          (item) => item.id === invoiceId
        );

        if (!invoice) {
          throw new Error("Invoice reconciliation không còn tồn tại.");
        }
        if (
          !Number.isInteger(amountVnd) ||
          amountVnd <= 0 ||
          amountVnd > modal.payment.payment.unallocatedAmountVnd ||
          amountVnd > invoice.remainingAmountVnd
        ) {
          throw new Error(
            "Allocation phải là số nguyên dương và không vượt số dư payment/invoice."
          );
        }

        await cmsApi.allocateProviderPayment(
          modal.payment.payment.id,
          invoiceId,
          amountVnd,
          reason
        );
      }

      if (modal.kind === "requeueBillingWebhook") {
        await cmsApi.requeueBillingWebhook(
          modal.event.id,
          reason
        );
      }

      const [
        nextAudit,
        nextDashboard,
        nextOrganizations,
        nextJobs,
        nextBillingReconciliation
      ] = await Promise.all([
        hasPermission("platform.audit.read")
          ? cmsApi.audit()
          : Promise.resolve([]),
        cmsApi.dashboard(),
        hasPermission("platform.organizations.inspect")
          ? cmsApi.organizations()
          : Promise.resolve([]),
        hasPermission("platform.jobs.read")
          ? cmsApi.jobs()
          : Promise.resolve(null),
        hasPermission("platform.billing.read")
          ? cmsApi.billingReconciliation()
          : Promise.resolve(null)
      ]);
      setAudit(nextAudit);
      setDashboard(nextDashboard);
      setOrganizations(nextOrganizations);
      setJobsStatus(nextJobs);
      setBillingReconciliation(nextBillingReconciliation);
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
          <img
            className="cms-brand__mark"
            src="/propops-mark.svg"
            alt=""
            width={42}
            height={42}
          />
          <div>
            <strong>{dashboard?.branding.productName ?? "PropOps"}</strong>
            <span>Control Plane</span>
          </div>
        </div>
        <nav className="cms-nav" aria-label="CMS navigation">
          {visibleNavItems.map((item) => (
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
          <strong>{bootstrap?.role ?? "Authorizing…"}</strong>
          <small>
            {bootstrap
              ? String(bootstrap.permissions.length) + " capabilities"
              : "Loading platform capabilities…"}
          </small>
        </div>
      </aside>

      <main className="cms-main">
        <div className="cms-warning" role="note">
          LIVE DB · Control Plane đọc dữ liệu vận hành trực tiếp từ PostgreSQL qua /api/cms/*. Không có KPI demo/hardcode.
        </div>

        <header className="cms-topbar">
          <div>
            <span className="cms-eyebrow">
              {dashboard?.branding.tagline ??
                "VẬN HÀNH HIỆU QUẢ · KIẾN TẠO GIÁ TRỊ BỀN VỮNG"}
            </span>
            <h1>{visibleNavItems.find((item) => item.id === view)?.label}</h1>
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
              <section className="cms-hero">
                <div className="cms-hero__brand">
                  <img
                    src="/propops-logo.svg"
                    alt={dashboard.branding.productName}
                    className="cms-hero__logo"
                  />
                  <div>
                    <span className="cms-eyebrow">CONTROL PLANE · LIVE DATA</span>
                    <h2>{dashboard.branding.tagline}</h2>
                    <p>
                      {dashboard.branding.descriptor} · {dashboard.display.locale}
                      {" · "}
                      {dashboard.display.timezone}
                    </p>
                  </div>
                </div>
                <div className="cms-hero__status">
                  <StatusBadge tone="success">POSTGRESQL LIVE</StatusBadge>
                  <small>
                    cửa sổ gần đây {dashboard.windows.recentHours}h · hợp đồng
                    sắp hết hạn {dashboard.windows.leaseExpiryDays} ngày
                  </small>
                </div>
              </section>

              <SectionHeader
                title="Tài sản & vận hành tenant"
                action={
                  <span className="cms-note">
                    Tổng hợp trực tiếp từ properties / rooms / residents / leases
                  </span>
                }
              />
              <section className="cms-metrics cms-metrics--dense">
                <MetricCard
                  label="Cơ sở đang hoạt động"
                  value={dashboardNumber(dashboard.assets.activeProperties)}
                  detail={dashboardNumber(dashboard.organizations.active) + " organization active"}
                  tone="info"
                />
                <MetricCard
                  label="Phòng đang hoạt động"
                  value={dashboardNumber(dashboard.assets.activeRooms)}
                  detail={overLimit + " organization vượt room limit"}
                  tone={overLimit ? "warning" : "success"}
                />
                <MetricCard
                  label="Phòng có hợp đồng"
                  value={dashboardNumber(dashboard.assets.occupiedRooms)}
                  detail={dashboardPercent(dashboard.assets.occupancyRatePercent) + " lấp đầy"}
                  tone="success"
                />
                <MetricCard
                  label="Phòng trống"
                  value={dashboardNumber(dashboard.assets.vacantRooms)}
                  detail="Suy ra từ phòng active không có lease hiện hành"
                  tone={dashboard.assets.vacantRooms > 0 ? "warning" : "success"}
                />
                <MetricCard
                  label="Cư dân active"
                  value={dashboardNumber(dashboard.assets.activeResidents)}
                  detail={dashboardNumber(dashboard.organizations.activeMemberships) + " thành viên tổ chức active"}
                  tone="info"
                />
                <MetricCard
                  label="Hợp đồng active"
                  value={dashboardNumber(dashboard.assets.activeLeases)}
                  detail={dashboardNumber(dashboard.assets.terminationScheduledLeases) + " đang chờ chấm dứt"}
                  tone="neutral"
                />
                <MetricCard
                  label={"HĐ hết hạn ≤ " + dashboard.windows.leaseExpiryDays + " ngày"}
                  value={dashboardNumber(dashboard.assets.expiringLeases)}
                  detail="Theo planned_end_date của lease hiện hành"
                  tone={dashboard.assets.expiringLeases > 0 ? "warning" : "success"}
                />
                <MetricCard
                  label="Tỷ lệ lấp đầy"
                  value={dashboardPercent(dashboard.assets.occupancyRatePercent)}
                  detail={
                    dashboardNumber(dashboard.assets.occupiedRooms) +
                    " / " +
                    dashboardNumber(dashboard.assets.activeRooms) +
                    " phòng"
                  }
                  tone="success"
                />
              </section>

              <SectionHeader
                title="SaaS subscription & billing"
                action={
                  <span className="cms-note">
                    Financial KPI là billing của PropOps, không phải doanh thu tiền trọ
                  </span>
                }
              />
              <section className="cms-metrics cms-metrics--dense">
                <MetricCard
                  label="Organizations"
                  value={dashboardNumber(dashboard.organizations.total)}
                  detail={
                    dashboardNumber(dashboard.organizations.suspended) +
                    " organization suspended"
                  }
                  tone={dashboard.organizations.suspended > 0 ? "warning" : "info"}
                />
                <MetricCard
                  label="Subscription active"
                  value={dashboardNumber(dashboard.commercial.activeSubscriptions)}
                  detail={
                    dashboardNumber(dashboard.commercial.trialingSubscriptions) +
                    " trialing"
                  }
                  tone="success"
                />
                <MetricCard
                  label="Delinquent"
                  value={dashboardNumber(
                    dashboard.commercial.delinquentOrganizationCount ?? 0
                  )}
                  detail={
                    dashboardNumber(dashboard.commercial.pastDueSubscriptions) +
                    " past due · " +
                    dashboardNumber(dashboard.commercial.gracePeriodSubscriptions) +
                    " grace"
                  }
                  tone={
                    (dashboard.commercial.delinquentOrganizationCount ?? 0) > 0
                      ? "danger"
                      : "success"
                  }
                />
                <MetricCard
                  label="Cancel cuối kỳ"
                  value={dashboardNumber(
                    dashboard.commercial.cancelAtPeriodEndSubscriptions
                  )}
                  detail="Scheduled cancellation"
                  tone={
                    dashboard.commercial.cancelAtPeriodEndSubscriptions > 0
                      ? "warning"
                      : "neutral"
                  }
                />
                {hasPermission("platform.billing.read") ? (
                  <>
                    <MetricCard
                      label="SaaS chưa thu"
                      value={dashboardMoney(
                        dashboard.commercial.outstandingVnd ?? 0
                      )}
                      detail={
                        dashboardNumber(
                          dashboard.commercial.unpaidInvoiceCount ?? 0
                        ) + " invoice còn số dư"
                      }
                      tone={
                        (dashboard.commercial.outstandingVnd ?? 0) > 0
                          ? "warning"
                          : "success"
                      }
                    />
                    <MetricCard
                      label="SaaS quá hạn"
                      value={dashboardMoney(dashboard.commercial.overdueVnd ?? 0)}
                      detail={
                        dashboardNumber(
                          dashboard.commercial.overdueInvoiceCount ?? 0
                        ) + " invoice overdue"
                      }
                      tone={
                        (dashboard.commercial.overdueVnd ?? 0) > 0
                          ? "danger"
                          : "success"
                      }
                    />
                    <MetricCard
                      label={"Thanh toán " + dashboard.windows.recentHours + "h"}
                      value={dashboardMoney(
                        dashboard.commercial.successfulPaymentVndRecent ?? 0
                      )}
                      detail={
                        dashboardNumber(
                          dashboard.commercial.successfulPaymentCountRecent ?? 0
                        ) + " payment thành công"
                      }
                      tone="success"
                    />
                  </>
                ) : null}
                <MetricCard
                  label="Plan active"
                  value={dashboardNumber(dashboard.commercial.activePlans)}
                  detail={dashboard.planDistribution
                    .map((item) => item.planCode + " " + item.subscriptions)
                    .join(" · ")}
                  tone="neutral"
                />
              </section>

              <section className="cms-dashboard-grid">
                <article className="cms-panel">
                  <SectionHeader title="Top organization theo số phòng" />
                  {dashboard.topOrganizations.length === 0 ? (
                    <div className="empty-state">Chưa có dữ liệu phòng.</div>
                  ) : (
                    <div className="dashboard-ranking">
                      {dashboard.topOrganizations.map((item) => {
                        const maxRooms = Math.max(
                          1,
                          ...dashboard.topOrganizations.map(
                            (organization) => organization.activeRooms
                          )
                        );
                        const width = Math.round(
                          (item.activeRooms / maxRooms) * 100
                        );
                        return (
                          <div className="dashboard-ranking__row" key={item.id}>
                            <div>
                              <strong>{item.name}</strong>
                              <small>{item.slug}</small>
                            </div>
                            <div className="dashboard-ranking__bar">
                              <span style={{ width: width + "%" }} />
                            </div>
                            <strong>{dashboardNumber(item.activeRooms)}</strong>
                            <small>{dashboardNumber(item.currentLeases)} lease</small>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </article>

                <article className="cms-panel">
                  <SectionHeader title="Automation & payment pipeline" />
                  <div className="dashboard-health-grid">
                    <div>
                      <span>Notification queued</span>
                      <strong>{dashboardNumber(dashboard.automation.queuedJobs)}</strong>
                    </div>
                    <div>
                      <span>Retry wait</span>
                      <strong>{dashboardNumber(dashboard.automation.retryWaitJobs)}</strong>
                    </div>
                    <div>
                      <span>Manual review</span>
                      <strong>{dashboardNumber(dashboard.automation.manualReviewJobs)}</strong>
                    </div>
                    <div>
                      <span>Sent {dashboard.windows.recentHours}h</span>
                      <strong>{dashboardNumber(dashboard.automation.sentJobsRecent)}</strong>
                    </div>
                    <div>
                      <span>Healthy workers</span>
                      <strong>{dashboardNumber(dashboard.automation.healthyWorkers)}</strong>
                    </div>
                    <div>
                      <span>Stale workers</span>
                      <strong>{dashboardNumber(dashboard.automation.staleWorkers)}</strong>
                    </div>
                    <div>
                      <span>Webhook review</span>
                      <strong>{dashboardNumber(dashboard.automation.webhookReviewRequired)}</strong>
                    </div>
                    <div>
                      <span>Webhook failed</span>
                      <strong>{dashboardNumber(dashboard.automation.webhookFailed)}</strong>
                    </div>
                  </div>
                </article>
              </section>

              <section className="cms-grid">
                <article className="cms-panel">
                  <SectionHeader title="Organizations cần chú ý" />
                  {!hasPermission("platform.organizations.inspect") ? (
                    <div className="empty-state">
                      Role hiện tại không có quyền inspect organizations.
                    </div>
                  ) : organizations.length === 0 ? (
                    <div className="empty-state">Chưa có organization.</div>
                  ) : (
                    <div className="cms-table-wrap">
                      <table className="cms-table">
                        <thead>
                          <tr>
                            <th>Organization</th>
                            <th>Subscription</th>
                            <th>Plan</th>
                            <th>Billing</th>
                            <th>Rooms</th>
                          </tr>
                        </thead>
                        <tbody>
                          {organizations
                            .filter(
                              (org) =>
                                org.subscriptionStatus !== "ACTIVE" ||
                                (org.latestInvoice !== null &&
                                  org.latestInvoice.remainingAmountVnd > 0) ||
                                (org.roomLimit !== null &&
                                  org.rooms > org.roomLimit)
                            )
                            .slice(0, 10)
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
                                  {org.latestInvoice &&
                                  org.latestInvoice.remainingAmountVnd > 0 ? (
                                    <>
                                      <StatusBadge
                                        tone={
                                          org.latestInvoice.isOverdue
                                            ? "danger"
                                            : "warning"
                                        }
                                      >
                                        {org.latestInvoice.isOverdue
                                          ? "OVERDUE"
                                          : org.latestInvoice.status}
                                      </StatusBadge>
                                      <small>
                                        {dashboardMoney(
                                          org.latestInvoice.remainingAmountVnd
                                        )}{" "}
                                        còn lại
                                      </small>
                                    </>
                                  ) : (
                                    <StatusBadge tone="success">
                                      SETTLED
                                    </StatusBadge>
                                  )}
                                </td>
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
                  <SectionHeader title="Platform health" />
                  <div className="health-list">
                    <div>
                      <span>CMS API / PostgreSQL</span>
                      <StatusBadge tone="success">CONNECTED</StatusBadge>
                    </div>
                    <div>
                      <span>Platform audit {dashboard.windows.recentHours}h</span>
                      <strong>{dashboardNumber(dashboard.platform.auditRecent)}</strong>
                    </div>
                    <div>
                      <span>System settings</span>
                      <strong>{dashboardNumber(dashboard.platform.settingCount)}</strong>
                    </div>
                    <div>
                      <span>Worker heartbeat</span>
                      <StatusBadge
                        tone={
                          dashboard.automation.staleWorkers > 0 ||
                          dashboard.automation.degradedWorkers > 0
                            ? "warning"
                            : "success"
                        }
                      >
                        {dashboard.automation.staleWorkers > 0
                          ? dashboard.automation.staleWorkers + " STALE"
                          : dashboard.automation.degradedWorkers > 0
                            ? dashboard.automation.degradedWorkers + " DEGRADED"
                            : "HEALTHY"}
                      </StatusBadge>
                    </div>
                    <div>
                      <span>Notification provider</span>
                      <StatusBadge
                        tone={
                          dashboard.automation.pausedProviders > 0
                            ? "warning"
                            : "success"
                        }
                      >
                        {dashboard.automation.pausedProviders > 0
                          ? dashboard.automation.pausedProviders + " PAUSED"
                          : "ACTIVE"}
                      </StatusBadge>
                    </div>
                    <div>
                      <span>Billing webhook stale</span>
                      <StatusBadge
                        tone={
                          dashboard.automation.webhookStaleProcessing > 0
                            ? "danger"
                            : "success"
                        }
                      >
                        {dashboard.automation.webhookStaleProcessing > 0
                          ? dashboard.automation.webhookStaleProcessing +
                            " STALE"
                          : "CLEAR"}
                      </StatusBadge>
                    </div>
                  </div>
                </article>
              </section>
            </>
          )}

          {!loading &&
            view === "settings" &&
            Array.from(new Set(settings.map((item) => item.group))).map((group) => (
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
                        {hasPermission("platform.settings.manage") ? (
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() =>
                              setModal({ kind: "setting", key: item.key })
                            }
                          >
                            Chỉnh
                          </button>
                        ) : (
                          <span className="cms-note">Read-only</span>
                        )}
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
                          {hasPermission("platform.plans.manage") ? (
                            <button
                              className="text-button"
                              type="button"
                              onClick={() =>
                                setModal({ kind: "plan", code: plan.code })
                              }
                            >
                              Chỉnh
                            </button>
                          ) : (
                            <span className="cms-note">Read-only</span>
                          )}
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
                        <th>Billing</th>
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
                              {org.cancelAtPeriodEnd ? (
                                <>
                                  <StatusBadge tone="warning">
                                    CANCEL_AT_PERIOD_END
                                  </StatusBadge>
                                  <small>
                                    effective{" "}
                                    {org.subscriptionStatus === "TRIALING"
                                      ? org.trialEndsAt
                                        ? new Date(
                                            org.trialEndsAt
                                          ).toLocaleString("vi-VN")
                                        : "—"
                                      : org.currentPeriodEnd
                                        ? new Date(
                                            org.currentPeriodEnd
                                          ).toLocaleString("vi-VN")
                                        : "—"}
                                  </small>
                                </>
                              ) : null}
                            </td>
                            <td>
                              {org.latestInvoice ? (
                                <>
                                  <StatusBadge
                                    tone={statusTone(
                                      org.latestInvoice.isOverdue &&
                                        org.latestInvoice.status !== "PAID"
                                        ? "OVERDUE"
                                        : org.latestInvoice.status
                                    )}
                                  >
                                    {org.latestInvoice.isOverdue &&
                                    org.latestInvoice.status !== "PAID"
                                      ? "OVERDUE"
                                      : org.latestInvoice.status}
                                  </StatusBadge>
                                  <strong>
                                    {money(org.latestInvoice.remainingAmountVnd)}{" "}
                                    còn lại
                                  </strong>
                                  <small>
                                    {money(org.latestInvoice.paidAmountVnd)} đã
                                    phân bổ / {money(org.latestInvoice.amountVnd)}
                                  </small>
                                  <small>
                                    {org.billingInterval ?? "—"} · kỳ{" "}
                                    {org.latestInvoice.periodStart
                                      ? new Date(
                                          org.latestInvoice.periodStart
                                        ).toLocaleDateString("vi-VN")
                                      : "—"}
                                    {" → "}
                                    {org.latestInvoice.periodEnd
                                      ? new Date(
                                          org.latestInvoice.periodEnd
                                        ).toLocaleDateString("vi-VN")
                                      : "—"}
                                  </small>
                                  <small>
                                    {org.latestInvoice.status === "PAID"
                                      ? "Paid " +
                                        (org.latestInvoice.paidAt
                                          ? new Date(
                                              org.latestInvoice.paidAt
                                            ).toLocaleString("vi-VN")
                                          : "")
                                      : "Due " +
                                        (org.latestInvoice.dueAt
                                          ? new Date(
                                              org.latestInvoice.dueAt
                                            ).toLocaleString("vi-VN")
                                          : "—")}
                                  </small>
                                </>
                              ) : (
                                <>
                                  <strong>No invoice</strong>
                                  <small>
                                    {org.billingInterval ?? "—"} ·{" "}
                                    {org.subscriptionStatus === "TRIALING"
                                      ? "trial ends " +
                                        (org.trialEndsAt
                                          ? new Date(
                                              org.trialEndsAt
                                            ).toLocaleDateString("vi-VN")
                                          : "—")
                                      : "period ends " +
                                        (org.currentPeriodEnd
                                          ? new Date(
                                              org.currentPeriodEnd
                                            ).toLocaleDateString("vi-VN")
                                          : "—")}
                                  </small>
                                </>
                              )}
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
                                hasPermission("platform.subscriptions.manage") ? (
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
                                  <span className="cms-note">Read-only</span>
                                )
                              ) : (
                                <div className="table-actions">
                                  {hasPermission(
                                    "platform.subscriptions.manage"
                                  ) &&
                                  subscriptionTargets(org.subscriptionStatus)
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
                                  {hasPermission("platform.billing.manage") &&
                                  org.latestInvoice &&
                                  (org.latestInvoice.status === "OPEN" ||
                                    org.latestInvoice.status ===
                                      "PARTIALLY_PAID") &&
                                  org.latestInvoice.remainingAmountVnd > 0 ? (
                                    <button
                                      className="text-button"
                                      type="button"
                                      onClick={() =>
                                        setModal({
                                          kind: "manualSubscriptionPayment",
                                          organization: org
                                        })
                                      }
                                    >
                                      Ghi nhận thanh toán
                                    </button>
                                  ) : null}
                                  {hasPermission(
                                    "platform.subscriptions.manage"
                                  ) &&
                                  (org.subscriptionStatus === "ACTIVE" ||
                                    org.subscriptionStatus === "TRIALING") ? (
                                    <button
                                      className={
                                        org.cancelAtPeriodEnd
                                          ? "text-button"
                                          : "text-button text-button--danger"
                                      }
                                      type="button"
                                      onClick={() =>
                                        setModal({
                                          kind: "subscriptionCancellation",
                                          organization: org,
                                          cancelAtPeriodEnd:
                                            !org.cancelAtPeriodEnd
                                        })
                                      }
                                    >
                                      {org.cancelAtPeriodEnd
                                        ? "Undo scheduled cancel"
                                        : "Cancel at period end"}
                                    </button>
                                  ) : null}
                                  {hasPermission(
                                    "platform.subscriptions.manage"
                                  ) &&
                                  org.subscriptionStatus !== "CANCELLED" ? (
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
                                  ) : null}
                                  {!hasPermission(
                                    "platform.subscriptions.manage"
                                  ) &&
                                  !hasPermission("platform.billing.manage") ? (
                                    <span className="cms-note">Read-only</span>
                                  ) : org.subscriptionStatus === "CANCELLED" ? (
                                    <span className="cms-note">Terminal</span>
                                  ) : null}
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

          {!loading && view === "billing" && (
            <>
              <section
                className="cms-metrics"
                aria-label="Billing webhook pipeline summary"
              >
                <MetricCard
                  label="Webhook received"
                  value={String(
                    billingReconciliation?.webhookInbox.summary.received ?? 0
                  )}
                  detail="Đã persist, đang chờ worker claim"
                  tone={
                    (billingReconciliation?.webhookInbox.summary.received ??
                      0) > 0
                      ? "warning"
                      : "success"
                  }
                />
                <MetricCard
                  label="Processing"
                  value={String(
                    billingReconciliation?.webhookInbox.summary.processing ?? 0
                  )}
                  detail={
                    String(
                      billingReconciliation?.webhookInbox.summary
                        .staleProcessing ?? 0
                    ) + " stale"
                  }
                  tone={
                    (billingReconciliation?.webhookInbox.summary
                      .staleProcessing ?? 0) > 0
                      ? "danger"
                      : "info"
                  }
                />
                <MetricCard
                  label="Webhook review"
                  value={String(
                    billingReconciliation?.webhookInbox.summary
                      .reviewRequired ?? 0
                  )}
                  detail="Payload/signature cần operator xem"
                  tone={
                    (billingReconciliation?.webhookInbox.summary
                      .reviewRequired ?? 0) > 0
                      ? "warning"
                      : "success"
                  }
                />
                <MetricCard
                  label="Webhook failed"
                  value={String(
                    billingReconciliation?.webhookInbox.summary.failed ?? 0
                  )}
                  detail="Terminal processing failures"
                  tone={
                    (billingReconciliation?.webhookInbox.summary.failed ?? 0) >
                    0
                      ? "danger"
                      : "success"
                  }
                />
                <MetricCard
                  label="Processed 24h"
                  value={String(
                    billingReconciliation?.webhookInbox.summary.processed24h ??
                      0
                  )}
                  detail="Raw event đã link financial processing"
                  tone="success"
                />
              </section>

              <section className="cms-grid">
              <article className="cms-panel">
                <SectionHeader
                  title="Provider payments cần review"
                  action={
                    <span className="cms-note">
                      Không auto-allocate khi match không an toàn.
                    </span>
                  }
                />
                {!billingReconciliation ||
                billingReconciliation.reviewPayments.length === 0 ? (
                  <div className="empty-state">
                    Không có provider payment cần reconciliation.
                  </div>
                ) : (
                  <div className="cms-table-wrap">
                    <table className="cms-table">
                      <thead>
                        <tr>
                          <th>Provider transaction</th>
                          <th>Reference</th>
                          <th>Amount</th>
                          <th>Assigned</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {billingReconciliation.reviewPayments.map((item) => {
                          const suggestedInvoice =
                            item.paymentReference === null
                              ? null
                              : reconciliationInvoiceByReference.get(
                                  item.paymentReference
                                ) ?? null;
                          const assignedOrganization =
                            item.payment.organizationId === null
                              ? null
                              : organizationById.get(
                                  item.payment.organizationId
                                ) ?? null;
                          return (
                            <tr key={item.payment.id}>
                              <td>
                                <strong>
                                  {item.payment.provider ?? "UNKNOWN_PROVIDER"}
                                </strong>
                                <small>
                                  {item.payment.providerTransactionId ?? "—"} ·{" "}
                                  {new Date(
                                    item.payment.occurredAt
                                  ).toLocaleString("vi-VN")}
                                </small>
                              </td>
                              <td>
                                <strong>
                                  {item.paymentReference ?? "No reference"}
                                </strong>
                                <small>
                                  {suggestedInvoice
                                    ? "Exact invoice reference found"
                                    : "No exact open invoice match"}
                                </small>
                              </td>
                              <td>
                                <strong>
                                  {money(
                                    item.payment.unallocatedAmountVnd
                                  )}{" "}
                                  chưa phân bổ
                                </strong>
                                <small>
                                  {money(item.payment.amountVnd)} transaction
                                </small>
                              </td>
                              <td>
                                {assignedOrganization?.name ?? "Unassigned"}
                              </td>
                              <td>
                                {hasPermission("platform.billing.manage") ? (
                                  <button
                                    className="text-button"
                                    type="button"
                                    disabled={
                                      (billingReconciliation?.invoices.length ??
                                        0) === 0
                                    }
                                    onClick={() =>
                                      setModal({
                                        kind: "allocateProviderPayment",
                                        payment: item
                                      })
                                    }
                                  >
                                    Allocate
                                  </button>
                                ) : (
                                  <span className="cms-note">Read-only</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>

              <article className="cms-panel">
                <SectionHeader
                  title="SaaS invoices còn số dư"
                  action={
                    <span className="cms-note">
                      {billingReconciliation?.invoices.length ?? 0} open balance
                    </span>
                  }
                />
                {!billingReconciliation ||
                billingReconciliation.invoices.length === 0 ? (
                  <div className="empty-state">
                    Không có SaaS invoice còn số dư.
                  </div>
                ) : (
                  <div className="cms-table-wrap">
                    <table className="cms-table">
                      <thead>
                        <tr>
                          <th>Organization</th>
                          <th>Reference</th>
                          <th>Status</th>
                          <th>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {billingReconciliation.invoices.map((invoice) => (
                          <tr key={invoice.id}>
                            <td>
                              <strong>
                                {organizationById.get(invoice.organizationId)
                                  ?.name ?? invoice.organizationId}
                              </strong>
                              <small>
                                {new Date(
                                  invoice.periodStart
                                ).toLocaleDateString("vi-VN")}
                                {" → "}
                                {new Date(
                                  invoice.periodEnd
                                ).toLocaleDateString("vi-VN")}
                              </small>
                            </td>
                            <td>{invoice.paymentReference}</td>
                            <td>
                              <StatusBadge
                                tone={
                                  invoice.isOverdue
                                    ? "danger"
                                    : statusTone(invoice.status)
                                }
                              >
                                {invoice.isOverdue
                                  ? "OVERDUE"
                                  : invoice.status}
                              </StatusBadge>
                            </td>
                            <td>
                              <strong>
                                {money(invoice.remainingAmountVnd)}
                              </strong>
                              <small>
                                {money(invoice.paidAmountVnd)} /{" "}
                                {money(invoice.amountVnd)} đã phân bổ
                              </small>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>

              <article className="cms-panel">
                <SectionHeader
                  title="Webhook inbox cần chú ý"
                  action={
                    <span className="cms-note">
                      Không hiển thị raw payload hoặc provider headers.
                    </span>
                  }
                />
                {!billingReconciliation ||
                billingReconciliation.webhookInbox.events.length === 0 ? (
                  <div className="empty-state">
                    Không có billing webhook đang chờ hoặc lỗi.
                  </div>
                ) : (
                  <div className="cms-table-wrap">
                    <table className="cms-table">
                      <thead>
                        <tr>
                          <th>Provider event</th>
                          <th>Processing</th>
                          <th>Signature</th>
                          <th>Attempts</th>
                          <th>Last error</th>
                          <th>Payment</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {billingReconciliation.webhookInbox.events.map(
                          (event) => (
                            <tr key={event.id}>
                              <td>
                                <strong>{event.provider}</strong>
                                <small>{event.providerEventId}</small>
                                <small>
                                  {new Date(event.receivedAt).toLocaleString(
                                    "vi-VN"
                                  )}
                                </small>
                              </td>
                              <td>
                                <StatusBadge
                                  tone={
                                    event.isStale
                                      ? "danger"
                                      : statusTone(event.processingStatus)
                                  }
                                >
                                  {event.isStale
                                    ? "STALE_PROCESSING"
                                    : event.processingStatus}
                                </StatusBadge>
                              </td>
                              <td>
                                <StatusBadge
                                  tone={
                                    event.signatureStatus === "VERIFIED"
                                      ? "success"
                                      : event.signatureStatus === "INVALID"
                                        ? "danger"
                                        : "warning"
                                  }
                                >
                                  {event.signatureStatus}
                                </StatusBadge>
                              </td>
                              <td>
                                <strong>{event.processingAttempts}</strong>
                                <small>
                                  {event.processingStartedAt
                                    ? "started " +
                                      new Date(
                                        event.processingStartedAt
                                      ).toLocaleString("vi-VN")
                                    : "not claimed"}
                                </small>
                              </td>
                              <td>
                                {event.lastErrorCode ?? "—"}
                                {event.lastErrorMessage ? (
                                  <small>{event.lastErrorMessage}</small>
                                ) : null}
                              </td>
                              <td>
                                {event.paymentId ? (
                                  <>
                                    <StatusBadge tone="success">
                                      LINKED
                                    </StatusBadge>
                                    <small>{event.paymentId}</small>
                                  </>
                                ) : (
                                  <span className="cms-note">—</span>
                                )}
                              </td>
                              <td>
                                {hasPermission("platform.billing.manage") &&
                                event.signatureStatus === "VERIFIED" &&
                                (event.processingStatus === "FAILED" ||
                                  event.processingStatus ===
                                    "REVIEW_REQUIRED") ? (
                                  <button
                                    className="text-button"
                                    type="button"
                                    onClick={() =>
                                      setModal({
                                        kind: "requeueBillingWebhook",
                                        event
                                      })
                                    }
                                  >
                                    Requeue
                                  </button>
                                ) : (
                                  <span className="cms-note">—</span>
                                )}
                              </td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            </section>
            </>
          )}

          {!loading && view === "entitlements" && (
            <section className="cms-panel">
              <SectionHeader
                title="Entitlement overrides"
                action={
                  hasPermission("platform.entitlements.manage") ? (
                    <button
                      className="primary-button"
                      type="button"
                      disabled={organizations.length === 0}
                      onClick={() => setModal({ kind: "entitlement" })}
                    >
                      Thêm override
                    </button>
                  ) : (
                    <span className="cms-note">Read-only</span>
                  )
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
                            {hasPermission(
                              "platform.entitlements.manage"
                            ) ? (
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
                            ) : (
                              <span className="cms-note">Read-only</span>
                            )}
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
                            {hasPermission("platform.jobs.manage") ? (
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
                            ) : (
                              <span className="cms-note">Read-only</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {jobsStatus?.connected && jobsStatus.workers.length > 0 ? (
                <div className="cms-table-wrap">
                  <table className="cms-table">
                    <thead>
                      <tr>
                        <th>Worker</th>
                        <th>Provider</th>
                        <th>Status</th>
                        <th>Last seen</th>
                        <th>Last error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobsStatus.workers.map((worker) => (
                        <tr key={worker.workerId}>
                          <td>
                            <strong>{worker.workerId}</strong>
                            <small>
                              started{" "}
                              {new Date(worker.startedAt).toLocaleString(
                                "vi-VN"
                              )}
                            </small>
                          </td>
                          <td>{worker.provider}</td>
                          <td>
                            <StatusBadge tone={statusTone(worker.status)}>
                              {worker.status}
                            </StatusBadge>
                          </td>
                          <td>
                            {new Date(worker.lastSeenAt).toLocaleString("vi-VN")}
                          </td>
                          <td>
                            {worker.lastErrorCode ?? "—"}
                            {worker.lastErrorMessage ? (
                              <small>{worker.lastErrorMessage}</small>
                            ) : null}
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
                            {(job.status === "FAILED" ||
                              job.status === "MANUAL_REVIEW") &&
                            hasPermission("platform.jobs.manage") ? (
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
                  Billing interval
                  <select name="billingInterval" defaultValue="MONTHLY">
                    <option value="MONTHLY">MONTHLY</option>
                    <option value="YEARLY">YEARLY</option>
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

            {modal.kind === "subscriptionCancellation" && (
              <>
                <h2>
                  {modal.cancelAtPeriodEnd
                    ? "Cancel subscription at period end"
                    : "Undo scheduled cancellation"}
                </h2>
                <p className="modal-warning">
                  {modal.organization.name} ·{" "}
                  {modal.organization.subscriptionStatus}.{" "}
                  {modal.cancelAtPeriodEnd
                    ? "Subscription vẫn hoạt động tới hết kỳ hiện tại; scheduler sẽ chuyển CANCELLED khi kỳ kết thúc và không tạo renewal invoice mới."
                    : "Subscription sẽ tiếp tục renew bình thường; scheduler có thể tạo lại renewal invoice khi nằm trong lead window."}
                </p>
                <p className="cms-note">
                  Effective at:{" "}
                  {modal.organization.subscriptionStatus === "TRIALING"
                    ? modal.organization.trialEndsAt
                      ? new Date(
                          modal.organization.trialEndsAt
                        ).toLocaleString("vi-VN")
                      : "—"
                    : modal.organization.currentPeriodEnd
                      ? new Date(
                          modal.organization.currentPeriodEnd
                        ).toLocaleString("vi-VN")
                      : "—"}
                  . Nếu future billing period đã có tiền được allocate, backend
                  sẽ từ chối schedule cancellation cho tới khi refund/credit
                  policy được xử lý.
                </p>
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

            {modal.kind === "manualSubscriptionPayment" &&
              (() => {
                const invoice = modal.organization.latestInvoice;
                if (!invoice) return null;

                return (
                  <>
                    <h2>Ghi nhận thanh toán</h2>
                    <p className="modal-warning">
                      Đây là thao tác tài chính thủ công cho{" "}
                      <strong>{modal.organization.name}</strong>. Invoice{" "}
                      {invoice.id} · tổng {money(invoice.amountVnd)} · đã phân bổ{" "}
                      {money(invoice.paidAmountVnd)} · còn lại{" "}
                      {money(invoice.remainingAmountVnd)}. Kỳ{" "}
                      {invoice.periodStart
                        ? new Date(invoice.periodStart).toLocaleDateString(
                            "vi-VN"
                          )
                        : "—"}
                      {" → "}
                      {invoice.periodEnd
                        ? new Date(invoice.periodEnd).toLocaleDateString(
                            "vi-VN"
                          )
                        : "—"}
                      .
                    </p>
                    <label>
                      Số tiền thực nhận (VND)
                      <input
                        name="paymentAmountVnd"
                        type="number"
                        min={1}
                        max={invoice.remainingAmountVnd}
                        step={1}
                        defaultValue={invoice.remainingAmountVnd}
                        required
                      />
                    </label>
                    <p className="cms-note">
                      Thanh toán một phần sẽ giữ invoice PARTIALLY_PAID. Khi số
                      dư về 0, invoice chuyển PAID; subscription chỉ được đưa về
                      ACTIVE khi kỳ đã đến hiệu lực. Chỉ dùng sau khi đã xác minh
                      tiền thực tế ngoài hệ thống. Thao tác được audit.
                    </p>
                  </>
                );
              })()}

            {modal.kind === "allocateProviderPayment" &&
              (() => {
                const suggestedInvoice =
                  modal.payment.paymentReference === null
                    ? null
                    : reconciliationInvoiceByReference.get(
                        modal.payment.paymentReference
                      ) ?? null;

                return (
                  <>
                    <h2>Allocate provider payment</h2>
                    <p className="modal-warning">
                      {modal.payment.payment.provider ?? "Provider"} ·{" "}
                      {modal.payment.payment.providerTransactionId ?? "—"} ·{" "}
                      {money(modal.payment.payment.unallocatedAmountVnd)} chưa
                      phân bổ. Allocation sẽ tạo financial history mới; không
                      sửa/xóa transaction gốc.
                    </p>
                    <label>
                      SaaS invoice
                      <select
                        name="reconciliationInvoiceId"
                        defaultValue={suggestedInvoice?.id}
                        required
                      >
                        {!suggestedInvoice ? (
                          <option value="">Chọn invoice…</option>
                        ) : null}
                        {(billingReconciliation?.invoices ?? []).map(
                          (invoice) => (
                            <option value={invoice.id} key={invoice.id}>
                              {organizationById.get(invoice.organizationId)
                                ?.name ?? invoice.organizationId}
                              {" · "}
                              {invoice.paymentReference}
                              {" · còn "}
                              {money(invoice.remainingAmountVnd)}
                            </option>
                          )
                        )}
                      </select>
                    </label>
                    <label>
                      Số tiền allocation (VND)
                      <input
                        name="reconciliationAmountVnd"
                        type="number"
                        min={1}
                        max={modal.payment.payment.unallocatedAmountVnd}
                        step={1}
                        defaultValue={
                          suggestedInvoice
                            ? Math.min(
                                modal.payment.payment.unallocatedAmountVnd,
                                suggestedInvoice.remainingAmountVnd
                              )
                            : modal.payment.payment.unallocatedAmountVnd
                        }
                        required
                      />
                    </label>
                    <p className="cms-note">
                      Chỉ allocate khi đã xác minh transaction thuộc đúng SaaS
                      invoice. Backend sẽ chặn cross-organization assignment,
                      vượt số dư payment hoặc vượt số dư invoice.
                    </p>
                  </>
                );
              })()}

            {modal.kind === "requeueBillingWebhook" && (
              <>
                <h2>Requeue billing webhook</h2>
                <p className="modal-warning">
                  {modal.event.provider} · {modal.event.providerEventId} ·{" "}
                  {modal.event.processingStatus}. Event sẽ quay về RECEIVED và
                  worker có thể claim lại. Processing attempts hiện tại{" "}
                  {modal.event.processingAttempts} được giữ nguyên để audit.
                </p>
                <p className="cms-note">
                  Chỉ requeue sau khi nguyên nhân lỗi/review đã được xử lý.
                  Backend sẽ từ chối event chưa verify signature, event đã link
                  payment hoặc trạng thái không phù hợp.
                </p>
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
                {saving
                  ? "Đang lưu…"
                  : modal.kind === "manualSubscriptionPayment"
                    ? "Ghi nhận thanh toán"
                    : modal.kind === "allocateProviderPayment"
                      ? "Allocate payment"
                      : modal.kind === "requeueBillingWebhook"
                        ? "Requeue webhook"
                        : modal.kind === "subscriptionCancellation"
                          ? modal.cancelAtPeriodEnd
                            ? "Schedule cancellation"
                            : "Undo cancellation"
                          : "Xác nhận thay đổi"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
