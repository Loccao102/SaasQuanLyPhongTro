import type { MembershipAccess } from "../identity/domain/access-control.js";

export interface AdminPrincipal {
  userId: string;
  userDisplayName: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  organizationStatus: string;
  membershipId: string;
  membership: MembershipAccess;
}

export type AdminRequest = {
  authenticatedUserId?: string;
  headers?: Record<string, string | string[] | undefined>;
  adminPrincipal?: AdminPrincipal;
};
