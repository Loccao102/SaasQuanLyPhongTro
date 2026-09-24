import type { MembershipAccess, Role } from "./domain/access-control.js";

export interface TenantPrincipal {
  userId: string;
  membershipId: string;
  organizationId: string;
  organizationName: string;
  role: Role;
  membership: MembershipAccess;
}

export interface TenantRequest {
  authenticatedUserId?: string;
  authSessionId?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  tenantPrincipal?: TenantPrincipal;
}
