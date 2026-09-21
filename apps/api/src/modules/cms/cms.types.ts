import type { PlatformRole } from "./domain/platform-access.js";

export interface PlatformPrincipal {
  userId: string;
  role: PlatformRole;
}

export interface CmsRequest {
  authenticatedUserId?: string;
  platformPrincipal?: PlatformPrincipal;
}

export interface UpdateSettingInput {
  value: unknown;
  expectedVersion?: number;
  reason?: string;
}

export interface UpdatePlanInput {
  monthlyPriceVnd?: number;
  roomLimit?: number;
  staffLimit?: number;
  automationQuota?: number;
  expectedVersion?: number;
  effectiveAt?: string;
  reason?: string;
}

export interface UpdateEntitlementOverrideInput {
  value: unknown;
  expiresAt?: string | null;
  reason?: string;
}

export interface RevokeEntitlementOverrideInput {
  reason?: string;
}

export interface ProvisionSubscriptionInput {
  planCode?: string;
  status?: "TRIALING" | "ACTIVE";
  trialEndsAt?: string | null;
  reason?: string;
}

export interface TransitionSubscriptionInput {
  to?: "TRIALING" | "ACTIVE" | "PAST_DUE" | "GRACE_PERIOD" | "SUSPENDED" | "CANCELLED";
  expectedVersion?: number;
  reason?: string;
}

export interface ChangeSubscriptionPlanInput {
  targetPlanCode?: string;
  expectedVersion?: number;
  reason?: string;
}
