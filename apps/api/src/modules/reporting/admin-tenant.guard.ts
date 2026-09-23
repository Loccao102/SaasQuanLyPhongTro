import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";
import {
  roles,
  type MembershipScope,
  type MembershipStatus,
  type Role
} from "../identity/domain/access-control.js";
import type {
  AdminPrincipal,
  AdminRequest
} from "./admin-dashboard.types.js";

type MembershipRow = QueryResultRow & {
  membership_id: string;
  organization_id: string;
  user_id: string;
  role: string;
  membership_status: MembershipStatus;
  user_status: string;
  user_display_name: string;
  organization_name: string;
  organization_slug: string;
  organization_status: string;
};

type ScopeRow = QueryResultRow & {
  scope_type: "ORGANIZATION" | "OPERATIONAL_GROUP" | "PROPERTY";
  operational_group_id: string | null;
  property_id: string | null;
};

@Injectable()
export class AdminTenantGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();

    let userId = request.authenticatedUserId?.trim();
    if (!userId && process.env.NODE_ENV !== "production") {
      userId = process.env.ADMIN_DEV_USER_ID?.trim();
    }

    const rawOrganizationId =
      request.headers?.["x-organization-id"];
    let organizationId = Array.isArray(rawOrganizationId)
      ? rawOrganizationId[0]?.trim()
      : rawOrganizationId?.trim();

    if (!organizationId && process.env.NODE_ENV !== "production") {
      organizationId =
        process.env.ADMIN_DEV_ORGANIZATION_ID?.trim();
    }

    if (!userId || !organizationId) {
      throw new UnauthorizedException(
        "No authenticated tenant principal/workspace is available."
      );
    }

    const membershipResult = await this.db.query<MembershipRow>(
      `SELECT
         m.id::text AS membership_id,
         m.organization_id::text,
         m.user_id::text,
         m.role,
         m.status AS membership_status,
         u.status AS user_status,
         u.display_name AS user_display_name,
         o.name AS organization_name,
         o.slug AS organization_slug,
         o.status AS organization_status
       FROM organization_memberships m
       JOIN users u ON u.id = m.user_id
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1
         AND m.organization_id = $2`,
      [userId, organizationId]
    );

    const row = membershipResult.rows[0];
    if (
      !row ||
      row.membership_status !== "ACTIVE" ||
      row.user_status !== "ACTIVE" ||
      !roles.includes(row.role as Role)
    ) {
      throw new UnauthorizedException(
        "Tenant membership access is not active."
      );
    }

    const scopeResult = await this.db.query<ScopeRow>(
      `SELECT
         scope_type,
         operational_group_id::text,
         property_id::text
       FROM membership_scopes
       WHERE organization_id = $1
         AND membership_id = $2
       ORDER BY scope_type, operational_group_id, property_id`,
      [organizationId, row.membership_id]
    );

    const scopes: MembershipScope[] = scopeResult.rows.flatMap(
      (scope): MembershipScope[] => {
        if (scope.scope_type === "ORGANIZATION") {
          return [{ type: "ORGANIZATION" }];
        }
        if (
          scope.scope_type === "PROPERTY" &&
          scope.property_id
        ) {
          return [
            {
              type: "PROPERTY",
              propertyId: scope.property_id
            }
          ];
        }
        if (
          scope.scope_type === "OPERATIONAL_GROUP" &&
          scope.operational_group_id
        ) {
          return [
            {
              type: "OPERATIONAL_GROUP",
              operationalGroupId: scope.operational_group_id
            }
          ];
        }
        return [];
      }
    );

    if (scopes.length === 0) {
      throw new UnauthorizedException(
        "Tenant membership has no active resource scope."
      );
    }

    const principal: AdminPrincipal = {
      userId: row.user_id,
      userDisplayName: row.user_display_name,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      organizationSlug: row.organization_slug,
      organizationStatus: row.organization_status,
      membershipId: row.membership_id,
      membership: {
        organizationId: row.organization_id,
        role: row.role as Role,
        status: row.membership_status,
        scopes
      }
    };

    request.adminPrincipal = principal;
    return true;
  }
}
