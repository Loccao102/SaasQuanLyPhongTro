export const platformRoles = [
  "PLATFORM_ADMIN",
  "SUPPORT_OPERATOR",
  "OPS_OPERATOR",
  "READ_ONLY_AUDITOR"
] as const;

export type PlatformRole = (typeof platformRoles)[number];

export const platformPermissions = [
  "platform.cms.read",
  "platform.settings.manage",
  "platform.plans.manage",
  "platform.entitlements.manage",
  "platform.organizations.inspect",
  "platform.jobs.read",
  "platform.jobs.manage",
  "platform.audit.read",
  "platform.logs.read"
] as const;

export type PlatformPermission = (typeof platformPermissions)[number];

const allPermissions = new Set<PlatformPermission>(platformPermissions);

const rolePermissions: Record<PlatformRole, ReadonlySet<PlatformPermission>> = {
  PLATFORM_ADMIN: allPermissions,
  SUPPORT_OPERATOR: new Set([
    "platform.cms.read",
    "platform.organizations.inspect",
    "platform.audit.read"
  ]),
  OPS_OPERATOR: new Set([
    "platform.cms.read",
    "platform.jobs.read",
    "platform.jobs.manage",
    "platform.audit.read",
    "platform.logs.read"
  ]),
  READ_ONLY_AUDITOR: new Set([
    "platform.cms.read",
    "platform.audit.read",
    "platform.logs.read"
  ])
};

export function isPlatformRole(value: string): value is PlatformRole {
  return (platformRoles as readonly string[]).includes(value);
}

export function platformRoleHasPermission(
  role: PlatformRole,
  permission: PlatformPermission
): boolean {
  return rolePermissions[role].has(permission);
}
