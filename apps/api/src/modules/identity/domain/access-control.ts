export const roles = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "STAFF",
  "ACCOUNTANT",
  "VIEWER"
] as const;

export type Role = (typeof roles)[number];

export const permissions = [
  "organization.read",
  "organization.manage",
  "membership.read",
  "membership.manage",
  "property.read",
  "property.manage",
  "lease.read",
  "lease.manage",
  "lease.terminate",
  "meter.read",
  "meter.write",
  "billing.read",
  "billing.manage",
  "payment.read",
  "payment.reconcile",
  "notification.read",
  "notification.send",
  "report.read"
] as const;

export type Permission = (typeof permissions)[number];
export type MembershipStatus = "INVITED" | "ACTIVE" | "SUSPENDED";

export type MembershipScope =
  | { type: "ORGANIZATION" }
  | { type: "OPERATIONAL_GROUP"; operationalGroupId: string }
  | { type: "PROPERTY"; propertyId: string };

export interface MembershipAccess {
  organizationId: string;
  role: Role;
  status: MembershipStatus;
  scopes: readonly MembershipScope[];
}

export interface ResourceContext {
  organizationId: string;
  propertyId?: string;
  operationalGroupIds?: readonly string[];
}

const allPermissions = new Set<Permission>(permissions);

const rolePermissions: Record<Role, ReadonlySet<Permission>> = {
  OWNER: allPermissions,
  ADMIN: allPermissions,
  MANAGER: new Set([
    "organization.read",
    "membership.read",
    "property.read",
    "property.manage",
    "lease.read",
    "lease.manage",
    "lease.terminate",
    "meter.read",
    "meter.write",
    "billing.read",
    "billing.manage",
    "payment.read",
    "notification.read",
    "notification.send",
    "report.read"
  ]),
  STAFF: new Set([
    "organization.read",
    "property.read",
    "meter.read",
    "meter.write"
  ]),
  ACCOUNTANT: new Set([
    "organization.read",
    "property.read",
    "lease.read",
    "billing.read",
    "billing.manage",
    "payment.read",
    "payment.reconcile",
    "notification.read",
    "report.read"
  ]),
  VIEWER: new Set([
    "organization.read",
    "property.read",
    "lease.read",
    "meter.read",
    "billing.read",
    "payment.read",
    "notification.read",
    "report.read"
  ])
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return rolePermissions[role].has(permission);
}

export function scopeAllows(
  membershipOrganizationId: string,
  scope: MembershipScope,
  resource: ResourceContext
): boolean {
  if (membershipOrganizationId !== resource.organizationId) {
    return false;
  }

  switch (scope.type) {
    case "ORGANIZATION":
      return true;
    case "PROPERTY":
      return resource.propertyId !== undefined && scope.propertyId === resource.propertyId;
    case "OPERATIONAL_GROUP":
      return resource.operationalGroupIds?.includes(scope.operationalGroupId) ?? false;
  }
}

export function isAuthorized(
  membership: MembershipAccess,
  permission: Permission,
  resource: ResourceContext
): boolean {
  if (membership.status !== "ACTIVE") {
    return false;
  }

  if (!roleHasPermission(membership.role, permission)) {
    return false;
  }

  return membership.scopes.some((scope) =>
    scopeAllows(membership.organizationId, scope, resource)
  );
}
