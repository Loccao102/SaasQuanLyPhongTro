export const tenantFeatureKeys = [
  "properties",
  "leases",
  "metering",
  "pricing",
  "billing",
  "payments",
  "credit_balance",
  "finances",
  "maintenance",
  "notifications",
  "reports",
  "team_management",
  "advanced_reports",
  "audit_log"
] as const;

export type TenantFeatureKey = (typeof tenantFeatureKeys)[number];

export const entitlementKeys = [
  "room_limit",
  "staff_limit",
  "automation_actions_monthly",
  ...tenantFeatureKeys
] as const;

export type EntitlementKey = (typeof entitlementKeys)[number];

export function isEntitlementKey(value: string): value is EntitlementKey {
  return (entitlementKeys as readonly string[]).includes(value);
}

export function isTenantFeatureKey(value: string): value is TenantFeatureKey {
  return (tenantFeatureKeys as readonly string[]).includes(value);
}

export type EntitlementValue = number | boolean;

export interface PlanEntitlements {
  roomLimit: number;
  staffLimit: number;
  automationActionsMonthly: number;
  properties: boolean;
  leases: boolean;
  metering: boolean;
  pricing: boolean;
  billing: boolean;
  payments: boolean;
  creditBalance: boolean;
  finances: boolean;
  maintenance: boolean;
  notifications: boolean;
  reports: boolean;
  teamManagement: boolean;
  advancedReports: boolean;
  auditLog: boolean;
}

export interface EntitlementOverride {
  key: EntitlementKey;
  value: EntitlementValue;
  expiresAt: string | null;
}

export interface EffectiveEntitlements extends PlanEntitlements {
  source: Readonly<Record<EntitlementKey, "PLAN" | "OVERRIDE">>;
}

export interface ResourceLimitDecision {
  current: number;
  requestedIncrease: number;
  next: number;
  limit: number;
  overLimit: boolean;
  allowed: boolean;
}

export class InvalidEntitlementOverrideError extends Error {
  constructor(key: EntitlementKey, message: string) {
    super(`Invalid override for ${key}: ${message}`);
    this.name = "InvalidEntitlementOverrideError";
  }
}

function overrideIsActive(
  override: EntitlementOverride,
  now: Date
): boolean {
  if (override.expiresAt === null) return true;

  const expiresAt = new Date(override.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new InvalidEntitlementOverrideError(
      override.key,
      "expiresAt must be an ISO date-time."
    );
  }

  return expiresAt.getTime() > now.getTime();
}

function assertNumberOverride(
  key: EntitlementKey,
  value: EntitlementValue
): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new InvalidEntitlementOverrideError(
      key,
      "value must be a non-negative integer."
    );
  }
}

function assertBooleanOverride(
  key: EntitlementKey,
  value: EntitlementValue
): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new InvalidEntitlementOverrideError(
      key,
      "value must be boolean."
    );
  }
}

export function validateEntitlementOverride(
  override: EntitlementOverride
): void {
  if (override.expiresAt !== null) {
    const expiresAt = new Date(override.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new InvalidEntitlementOverrideError(
        override.key,
        "expiresAt must be an ISO date-time."
      );
    }
  }

  switch (override.key) {
    case "room_limit":
    case "staff_limit":
    case "automation_actions_monthly":
      assertNumberOverride(override.key, override.value);
      return;
    default:
      assertBooleanOverride(override.key, override.value);
      return;
  }
}

function setFeature(
  values: PlanEntitlements,
  key: TenantFeatureKey,
  enabled: boolean
): void {
  switch (key) {
    case "properties":
      values.properties = enabled;
      return;
    case "leases":
      values.leases = enabled;
      return;
    case "metering":
      values.metering = enabled;
      return;
    case "pricing":
      values.pricing = enabled;
      return;
    case "billing":
      values.billing = enabled;
      return;
    case "payments":
      values.payments = enabled;
      return;
    case "credit_balance":
      values.creditBalance = enabled;
      return;
    case "finances":
      values.finances = enabled;
      return;
    case "maintenance":
      values.maintenance = enabled;
      return;
    case "notifications":
      values.notifications = enabled;
      return;
    case "reports":
      values.reports = enabled;
      return;
    case "team_management":
      values.teamManagement = enabled;
      return;
    case "advanced_reports":
      values.advancedReports = enabled;
      return;
    case "audit_log":
      values.auditLog = enabled;
      return;
  }
}

export function tenantFeatureEnabled(
  entitlements: PlanEntitlements,
  key: TenantFeatureKey
): boolean {
  switch (key) {
    case "properties":
      return entitlements.properties;
    case "leases":
      return entitlements.leases;
    case "metering":
      return entitlements.metering;
    case "pricing":
      return entitlements.pricing;
    case "billing":
      return entitlements.billing;
    case "payments":
      return entitlements.payments;
    case "credit_balance":
      return entitlements.creditBalance;
    case "finances":
      return entitlements.finances;
    case "maintenance":
      return entitlements.maintenance;
    case "notifications":
      return entitlements.notifications;
    case "reports":
      return entitlements.reports;
    case "team_management":
      return entitlements.teamManagement;
    case "advanced_reports":
      return entitlements.advancedReports;
    case "audit_log":
      return entitlements.auditLog;
  }
}

export function resolveEffectiveEntitlements(
  plan: PlanEntitlements,
  overrides: readonly EntitlementOverride[],
  now = new Date()
): EffectiveEntitlements {
  const values: PlanEntitlements = { ...plan };
  const source = Object.fromEntries(
    entitlementKeys.map((key) => [key, "PLAN" as const])
  ) as Record<EntitlementKey, "PLAN" | "OVERRIDE">;

  for (const override of overrides) {
    if (!overrideIsActive(override, now)) continue;

    switch (override.key) {
      case "room_limit":
        assertNumberOverride(override.key, override.value);
        values.roomLimit = override.value;
        break;
      case "staff_limit":
        assertNumberOverride(override.key, override.value);
        values.staffLimit = override.value;
        break;
      case "automation_actions_monthly":
        assertNumberOverride(override.key, override.value);
        values.automationActionsMonthly = override.value;
        break;
      default:
        assertBooleanOverride(override.key, override.value);
        setFeature(values, override.key, override.value);
        break;
    }

    source[override.key] = "OVERRIDE";
  }

  return {
    ...values,
    source
  };
}

export function evaluateResourceLimit(
  current: number,
  requestedIncrease: number,
  limit: number
): ResourceLimitDecision {
  if (
    !Number.isInteger(current) ||
    current < 0 ||
    !Number.isInteger(requestedIncrease) ||
    requestedIncrease < 0 ||
    !Number.isInteger(limit) ||
    limit < 0
  ) {
    throw new Error(
      "Resource usage, requested increase and limit must be non-negative integers."
    );
  }

  const next = current + requestedIncrease;
  return {
    current,
    requestedIncrease,
    next,
    limit,
    overLimit: current > limit,
    allowed: requestedIncrease === 0 || next <= limit
  };
}
