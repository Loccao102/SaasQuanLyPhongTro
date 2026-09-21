export type CmsDashboard = {
  organizationCount: number;
  activeRoomCount: number;
  settingCount: number;
  activePlanCount: number;
  platformAudit24h: number;
};

export type CmsSetting = {
  key: string;
  group: string;
  label: string;
  description: string;
  type: "BOOLEAN" | "INTEGER" | "STRING" | "JSON";
  value: unknown;
  version: number;
  updatedAt: string;
};

export type CmsPlan = {
  id: string;
  code: string;
  name: string;
  status: string;
  version: number;
  monthlyPriceVnd: number;
  yearlyPriceVnd: number | null;
  roomLimit: number;
  staffLimit: number;
  automationQuota: number;
  effectiveFrom: string;
};

export type CmsSubscriptionStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "GRACE_PERIOD"
  | "SUSPENDED"
  | "CANCELLED";

export type CmsSubscription = {
  id: string;
  organizationId: string;
  planId: string;
  planVersionId: string;
  planCode: string;
  status: CmsSubscriptionStatus;
  version: number;
  billingInterval: "MONTHLY" | "YEARLY";
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  pastDueAt: string | null;
  cancelAtPeriodEnd: boolean;
};

export type CmsOrganization = {
  id: string;
  slug: string;
  name: string;
  status: string;
  ownerName: string | null;
  rooms: number;
  staff: number;
  subscriptionStatus: string;
  subscriptionVersion: number | null;
  planCode: string | null;
  roomLimit: number | null;
  staffLimit: number | null;
  automationQuota: number | null;
  roomLimitSource: "PLAN" | "OVERRIDE" | null;
  staffLimitSource: "PLAN" | "OVERRIDE" | null;
  automationQuotaSource: "PLAN" | "OVERRIDE" | null;
  automationUsed: number;
  automationReserved: number;
};

export type CmsAuditEvent = {
  id: string;
  at: string;
  actor: string;
  action: string;
  targetType: string;
  target: string;
  organizationId: string | null;
  before: unknown;
  after: unknown;
  reason: string;
};

export type CmsEntitlementOverride = {
  id: string;
  organizationId: string;
  organizationName: string;
  key:
    | "room_limit"
    | "staff_limit"
    | "automation_actions_monthly"
    | "advanced_reports"
    | "audit_log";
  value: number | boolean;
  expiresAt: string | null;
  reason: string;
  createdAt: string;
  createdBy: string;
};

export type CmsNotificationJob = {
  id: string;
  organizationId: string;
  organizationName: string;
  campaignId: string;
  campaignStatus: string;
  recipientKey: string;
  recipientDisplayName: string | null;
  provider: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  verificationState: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CmsNotificationProvider = {
  provider: string;
  status: "ACTIVE" | "PAUSED";
  reason: string | null;
  controlUpdatedAt: string | null;
  workerCount: number;
  healthyWorkers: number;
  degradedWorkers: number;
  lastSeenAt: string | null;
};

export type CmsNotificationWorker = {
  workerId: string;
  provider: string;
  status: "STARTING" | "HEALTHY" | "DEGRADED" | "STOPPING";
  startedAt: string;
  lastSeenAt: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  metadata: unknown;
};

export type CmsJobsStatus = {
  connected: boolean;
  reason: string;
  entries: CmsNotificationJob[];
  providers: CmsNotificationProvider[];
  workers: CmsNotificationWorker[];
};

export type IntegrationStatus = {
  connected: boolean;
  reason: string;
  entries: unknown[];
};

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");

  const response = await fetch(apiBase + "/cms" + path, {
    ...init,
    headers,
    credentials: "include"
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || "CMS API request failed with status " + String(response.status)
    );
  }

  return response.json() as Promise<T>;
}

export const cmsApi = {
  dashboard: () => request<CmsDashboard>("/dashboard"),
  settings: () => request<CmsSetting[]>("/settings"),
  plans: () => request<CmsPlan[]>("/plans"),
  organizations: () => request<CmsOrganization[]>("/organizations"),
  entitlementOverrides: () =>
    request<CmsEntitlementOverride[]>("/entitlement-overrides"),
  audit: () => request<CmsAuditEvent[]>("/audit"),
  jobs: () => request<CmsJobsStatus>("/jobs"),
  logs: () => request<IntegrationStatus>("/logs"),

  updateSetting: (
    key: string,
    input: { value: unknown; expectedVersion: number; reason: string }
  ) =>
    request<CmsSetting>("/settings/" + encodeURIComponent(key), {
      method: "PATCH",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input)
    }),

  provisionSubscription: (
    organizationId: string,
    input: {
      planCode: string;
      status: "TRIALING" | "ACTIVE";
      billingInterval: "MONTHLY" | "YEARLY";
      trialEndsAt?: string | null;
      reason: string;
    }
  ) =>
    request<CmsSubscription>(
      "/organizations/" +
        encodeURIComponent(organizationId) +
        "/subscription",
      {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(input)
      }
    ),

  changeSubscriptionPlan: (
    organizationId: string,
    input: {
      targetPlanCode: string;
      expectedVersion: number;
      reason: string;
    }
  ) =>
    request<CmsSubscription>(
      "/organizations/" +
        encodeURIComponent(organizationId) +
        "/subscription/change-plan",
      {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(input)
      }
    ),

  transitionSubscription: (
    organizationId: string,
    input: {
      to: CmsSubscriptionStatus;
      expectedVersion: number;
      reason: string;
    }
  ) =>
    request<CmsSubscription>(
      "/organizations/" +
        encodeURIComponent(organizationId) +
        "/subscription/transition",
      {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(input)
      }
    ),

  updatePlan: (
    code: string,
    input: {
      monthlyPriceVnd: number;
      roomLimit: number;
      staffLimit: number;
      automationQuota: number;
      expectedVersion: number;
      reason: string;
    }
  ) =>
    request<CmsPlan>("/plans/" + encodeURIComponent(code), {
      method: "PATCH",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input)
    }),

  setEntitlementOverride: (
    organizationId: string,
    key: CmsEntitlementOverride["key"],
    input: { value: number | boolean; expiresAt: string | null; reason: string }
  ) =>
    request<CmsEntitlementOverride>(
      "/organizations/" +
        encodeURIComponent(organizationId) +
        "/entitlement-overrides/" +
        encodeURIComponent(key),
      {
        method: "PATCH",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(input)
      }
    ),

  revokeEntitlementOverride: (
    organizationId: string,
    key: CmsEntitlementOverride["key"],
    reason: string
  ) =>
    request<{ organizationId: string; key: string; revoked: true }>(
      "/organizations/" +
        encodeURIComponent(organizationId) +
        "/entitlement-overrides/" +
        encodeURIComponent(key) +
        "/revoke",
      {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ reason })
      }
    ),

  retryNotificationJob: (jobId: string, reason: string) =>
    request<CmsNotificationJob>("/jobs/" + encodeURIComponent(jobId) + "/retry", {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ reason })
    }),

  updateNotificationProviderControl: (
    provider: string,
    status: "ACTIVE" | "PAUSED",
    reason: string
  ) =>
    request<CmsNotificationProvider>(
      "/jobs/providers/" + encodeURIComponent(provider) + "/control",
      {
        method: "PATCH",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ status, reason })
      }
    )
};
