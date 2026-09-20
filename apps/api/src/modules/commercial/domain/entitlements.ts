export type EntitlementKey =
  | "room_limit"
  | "staff_limit"
  | "automation_actions_monthly"
  | "advanced_reports"
  | "audit_log";

export type EntitlementValue = number | boolean;

export interface PlanEntitlements {
  roomLimit: number;
  staffLimit: number;
  automationActionsMonthly: number;
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

export function resolveEffectiveEntitlements(
  plan: PlanEntitlements,
  overrides: readonly EntitlementOverride[],
  now = new Date()
): EffectiveEntitlements {
  const values: PlanEntitlements = { ...plan };
  const source: Record<EntitlementKey, "PLAN" | "OVERRIDE"> = {
    room_limit: "PLAN",
    staff_limit: "PLAN",
    automation_actions_monthly: "PLAN",
    advanced_reports: "PLAN",
    audit_log: "PLAN"
  };

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
      case "advanced_reports":
        assertBooleanOverride(override.key, override.value);
        values.advancedReports = override.value;
        break;
      case "audit_log":
        assertBooleanOverride(override.key, override.value);
        values.auditLog = override.value;
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
