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

export type CmsOrganization = {
  id: string;
  slug: string;
  name: string;
  status: string;
  ownerName: string | null;
  rooms: number;
  staff: number;
  subscriptionStatus: string;
  planCode: string | null;
  roomLimit: number | null;
  staffLimit: number | null;
  automationQuota: number | null;
  roomLimitSource: "PLAN" | "OVERRIDE" | null;
  staffLimitSource: "PLAN" | "OVERRIDE" | null;
  automationQuotaSource: "PLAN" | "OVERRIDE" | null;
  automationUsed: number | null;
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
  jobs: () => request<IntegrationStatus>("/jobs"),
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
    )
};
