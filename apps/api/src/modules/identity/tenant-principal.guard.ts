import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";
import {
  assertTrustedBrowserOrigin,
  isUnsafeHttpMethod,
  readCsrfHeader,
  readSessionToken
} from "./auth/auth-http.js";
import { AuthenticationService } from "./auth/authentication.service.js";
import type {
  MembershipAccess,
  MembershipScope,
  MembershipStatus,
  Role
} from "./domain/access-control.js";
import { roles } from "./domain/access-control.js";
import type { TenantPrincipal, TenantRequest } from "./tenant-principal.js";

type MembershipRow = QueryResultRow & {
  id: string;
  organization_id: string;
  organization_name: string;
  user_id: string;
  role: string;
  membership_status: MembershipStatus;
  user_status: string;
  organization_status: string;
};

type ScopeRow = QueryResultRow & {
  scope_type: "ORGANIZATION" | "OPERATIONAL_GROUP" | "PROPERTY";
  operational_group_id: string | null;
  property_id: string | null;
};

@Injectable()
export class TenantPrincipalGuard implements CanActivate {
  constructor(
    private readonly db: DatabaseService,
    private readonly authentication: AuthenticationService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    let userId = request.authenticatedUserId;

    const sessionToken = readSessionToken(request);
    if (!userId && sessionToken) {
      const session = await this.authentication.authenticateSession(sessionToken);
      if (!session) {
        throw new UnauthorizedException(
          "Authentication session is invalid or expired."
        );
      }

      if (isUnsafeHttpMethod(request.method)) {
        assertTrustedBrowserOrigin(request);
        if (!this.authentication.verifyCsrf(session, readCsrfHeader(request))) {
          throw new UnauthorizedException("Valid CSRF token is required.");
        }
      }

      userId = session.userId;
      request.authenticatedUserId = session.userId;
      request.authSessionId = session.sessionId;
    }

    if (!userId && process.env.NODE_ENV !== "production") {
      userId = process.env.ADMIN_DEV_USER_ID;
    }

    const headerValue = request.headers?.["x-organization-id"];
    const headerOrganizationId = Array.isArray(headerValue)
      ? headerValue[0]
      : headerValue;
    const organizationId =
      headerOrganizationId?.trim() ||
      (process.env.NODE_ENV !== "production"
        ? process.env.ADMIN_DEV_ORGANIZATION_ID
        : undefined);

    if (!userId || !organizationId) {
      throw new UnauthorizedException(
        "Authenticated tenant user and selected organization are required."
      );
    }

    const membershipResult = await this.db.query<MembershipRow>(
      `SELECT
         om.id::text,
         om.organization_id::text,
         o.name AS organization_name,
         om.user_id::text,
         om.role,
         om.status AS membership_status,
         u.status AS user_status,
         o.status AS organization_status
       FROM organization_memberships om
       JOIN users u ON u.id = om.user_id
       JOIN organizations o ON o.id = om.organization_id
       WHERE om.user_id = $1::uuid
         AND om.organization_id = $2::uuid
       LIMIT 1`,
      [userId, organizationId]
    );

    const row = membershipResult.rows[0];
    if (
      !row ||
      row.membership_status !== "ACTIVE" ||
      row.user_status !== "ACTIVE" ||
      row.organization_status !== "ACTIVE" ||
      !roles.includes(row.role as Role)
    ) {
      throw new UnauthorizedException(
        "Tenant membership is not active for this organization."
      );
    }

    const scopeResult = await this.db.query<ScopeRow>(
      `SELECT
         scope_type,
         operational_group_id::text,
         property_id::text
       FROM membership_scopes
       WHERE organization_id = $1::uuid
         AND membership_id = $2::uuid
       ORDER BY scope_type, operational_group_id, property_id`,
      [row.organization_id, row.id]
    );

    const scopes = scopeResult.rows.flatMap((scope): MembershipScope[] => {
      if (scope.scope_type === "ORGANIZATION") {
        return [{ type: "ORGANIZATION" }];
      }
      if (
        scope.scope_type === "OPERATIONAL_GROUP" &&
        scope.operational_group_id
      ) {
        return [{
          type: "OPERATIONAL_GROUP",
          operationalGroupId: scope.operational_group_id
        }];
      }
      if (scope.scope_type === "PROPERTY" && scope.property_id) {
        return [{ type: "PROPERTY", propertyId: scope.property_id }];
      }
      return [];
    });

    const membership: MembershipAccess = {
      organizationId: row.organization_id,
      role: row.role as Role,
      status: row.membership_status,
      scopes
    };

    const principal: TenantPrincipal = {
      userId: row.user_id,
      membershipId: row.id,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      role: row.role as Role,
      membership
    };
    request.tenantPrincipal = principal;
    return true;
  }
}
