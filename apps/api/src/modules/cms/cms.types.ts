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
