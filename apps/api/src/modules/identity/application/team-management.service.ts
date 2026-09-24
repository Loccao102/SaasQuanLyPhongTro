import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import type { TenantPrincipal } from "../tenant-principal.js";
import type {
  MembershipStatus,
  Role
} from "../domain/access-control.js";
import { roles } from "../domain/access-control.js";
import { AccessControlService } from "../access-control.service.js";
import { MembershipApplicationService } from "./membership-application.service.js";

type MemberRow = QueryResultRow & {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: Role;
  status: MembershipStatus;
  created_at: Date;
  updated_at: Date;
};

type ScopeRow = QueryResultRow & {
  membership_id: string;
  scope_type: "ORGANIZATION" | "OPERATIONAL_GROUP" | "PROPERTY";
  operational_group_id: string | null;
  operational_group_name: string | null;
  property_id: string | null;
  property_name: string | null;
};

type GroupRow = QueryResultRow & {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  property_ids: string[];
  created_at: Date;
  updated_at: Date;
};

type PropertyRow = QueryResultRow & {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type TeamScopeInput =
  | { type: "ORGANIZATION" }
  | { type: "OPERATIONAL_GROUP"; operationalGroupId: string }
  | { type: "PROPERTY"; propertyId: string };

@Injectable()
export class TeamManagementService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService,
    private readonly memberships: MembershipApplicationService
  ) {}

  async overview(principal: TenantPrincipal) {
    this.requireManage(principal);

    const [memberResult, scopeResult, groupResult, propertyResult] =
      await Promise.all([
        this.db.query<MemberRow>(
          `SELECT
             om.id::text,
             om.user_id::text,
             u.email,
             u.display_name,
             om.role,
             om.status,
             om.created_at,
             om.updated_at
           FROM organization_memberships om
           JOIN users u ON u.id = om.user_id
           WHERE om.organization_id = $1::uuid
           ORDER BY
             CASE om.role
               WHEN 'OWNER' THEN 0
               WHEN 'ADMIN' THEN 1
               WHEN 'MANAGER' THEN 2
               ELSE 3
             END,
             u.display_name,
             u.email`,
          [principal.organizationId]
        ),
        this.db.query<ScopeRow>(
          `SELECT
             ms.membership_id::text,
             ms.scope_type,
             ms.operational_group_id::text,
             og.name AS operational_group_name,
             ms.property_id::text,
             p.name AS property_name
           FROM membership_scopes ms
           LEFT JOIN operational_groups og
             ON og.organization_id = ms.organization_id
            AND og.id = ms.operational_group_id
           LEFT JOIN properties p
             ON p.organization_id = ms.organization_id
            AND p.id = ms.property_id
           WHERE ms.organization_id = $1::uuid
           ORDER BY ms.membership_id, ms.scope_type, og.name, p.name`,
          [principal.organizationId]
        ),
        this.db.query<GroupRow>(
          `SELECT
             og.id::text,
             og.code,
             og.name,
             og.is_active,
             COALESCE(
               array_agg(pog.property_id::text ORDER BY p.name, p.id)
                 FILTER (WHERE pog.property_id IS NOT NULL),
               '{}'::text[]
             ) AS property_ids,
             og.created_at,
             og.updated_at
           FROM operational_groups og
           LEFT JOIN property_operational_groups pog
             ON pog.organization_id = og.organization_id
            AND pog.operational_group_id = og.id
           LEFT JOIN properties p
             ON p.organization_id = pog.organization_id
            AND p.id = pog.property_id
           WHERE og.organization_id = $1::uuid
           GROUP BY og.id
           ORDER BY og.is_active DESC, og.name, og.code`,
          [principal.organizationId]
        ),
        this.db.query<PropertyRow>(
          `SELECT id::text, code, name, is_active
           FROM properties
           WHERE organization_id = $1::uuid
           ORDER BY is_active DESC, name, code`,
          [principal.organizationId]
        )
      ]);

    const scopesByMembership = new Map<
      string,
      Array<{
        type: "ORGANIZATION" | "OPERATIONAL_GROUP" | "PROPERTY";
        label: string;
        operationalGroupId?: string;
        propertyId?: string;
      }>
    >();
    for (const row of scopeResult.rows) {
      const current = scopesByMembership.get(row.membership_id) ?? [];
      current.push(this.mapScope(row));
      scopesByMembership.set(row.membership_id, current);
    }

    return {
      organization: {
        id: principal.organizationId,
        name: principal.organizationName
      },
      currentMembershipId: principal.membershipId,
      currentRole: principal.role,
      members: memberResult.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        status: row.status,
        scopes: scopesByMembership.get(row.id) ?? [],
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      })),
      groups: groupResult.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        isActive: row.is_active,
        propertyIds: row.property_ids,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      })),
      properties: propertyResult.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        isActive: row.is_active
      }))
    };
  }

  async invite(
    principal: TenantPrincipal,
    input: {
      email: string;
      displayName: string;
      role: Role;
      scopes: readonly TeamScopeInput[];
    }
  ) {
    this.requireManage(principal);
    const email = this.email(input.email);
    const displayName = this.required(input.displayName, "displayName");
    this.assertRole(principal, input.role);

    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );
      const scopes = await this.validateScopes(
        client,
        principal.organizationId,
        input.role,
        input.scopes
      );

      const userResult = await client.query<QueryResultRow & {
        id: string;
        status: string;
      }>(
        `SELECT id::text, status
         FROM users
         WHERE lower(email) = lower($1)
         LIMIT 1`,
        [email]
      );

      let userId: string;
      let reusedUser = false;
      if (userResult.rows[0]) {
        if (userResult.rows[0].status !== "ACTIVE") {
          throw new ConflictException("User account is suspended.");
        }
        userId = userResult.rows[0].id;
        reusedUser = true;
      } else {
        const createdUser = await client.query<QueryResultRow & { id: string }>(
          `INSERT INTO users (email, display_name)
           VALUES ($1, $2)
           RETURNING id::text`,
          [email, displayName]
        );
        userId = createdUser.rows[0]!.id;
      }

      const existingMembership = await client.query(
        `SELECT id
         FROM organization_memberships
         WHERE organization_id = $1::uuid
           AND user_id = $2::uuid
         LIMIT 1`,
        [principal.organizationId, userId]
      );
      if ((existingMembership.rowCount ?? 0) > 0) {
        throw new ConflictException(
          "User already has a membership in this organization."
        );
      }

      const membershipResult = await client.query<QueryResultRow & { id: string }>(
        `INSERT INTO organization_memberships (
           organization_id, user_id, role, status
         )
         VALUES ($1, $2, $3, 'INVITED')
         RETURNING id::text`,
        [principal.organizationId, userId, input.role]
      );
      const membershipId = membershipResult.rows[0]!.id;
      await this.replaceScopes(
        client,
        principal.organizationId,
        membershipId,
        scopes
      );

      await this.audit(client, principal, "MEMBERSHIP_INVITED", membershipId, {
        email,
        displayName,
        role: input.role,
        scopes,
        reusedUser
      });

      return {
        membershipId,
        userId,
        role: input.role,
        status: "INVITED" as const
      };
    });
  }

  async updateMember(
    principal: TenantPrincipal,
    membershipId: string,
    input: { role: Role; scopes: readonly TeamScopeInput[] }
  ) {
    this.requireManage(principal);
    this.assertRole(principal, input.role);

    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );
      const current = await this.memberForUpdate(
        client,
        principal.organizationId,
        membershipId
      );
      if (current.role === "OWNER" && principal.role !== "OWNER") {
        throw new ForbiddenException("Only an OWNER can modify another OWNER.");
      }
      const scopes = await this.validateScopes(
        client,
        principal.organizationId,
        input.role,
        input.scopes
      );

      if (current.role === "OWNER" && input.role !== "OWNER") {
        await this.assertNotLastActiveOwner(client, principal.organizationId, membershipId);
      }

      await client.query(
        `UPDATE organization_memberships
         SET role = $3,
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid`,
        [principal.organizationId, membershipId, input.role]
      );
      await this.replaceScopes(
        client,
        principal.organizationId,
        membershipId,
        scopes
      );
      await this.audit(client, principal, "MEMBERSHIP_ACCESS_UPDATED", membershipId, {
        beforeRole: current.role,
        afterRole: input.role,
        scopes
      });

      return { membershipId, role: input.role, scopes };
    });
  }

  async activate(principal: TenantPrincipal, membershipId: string) {
    this.requireManage(principal);
    const target = await this.db.query<QueryResultRow & { role: Role }>(
      `SELECT role
       FROM organization_memberships
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
       LIMIT 1`,
      [principal.organizationId, membershipId]
    );
    if (!target.rows[0]) {
      throw new NotFoundException("Membership was not found.");
    }
    if (target.rows[0].role === "OWNER" && principal.role !== "OWNER") {
      throw new ForbiddenException("Only an OWNER can activate another OWNER.");
    }
    return this.memberships.activate({
      actor: {
        userId: principal.userId,
        membership: principal.membership
      },
      organizationId: principal.organizationId,
      membershipId
    });
  }

  async suspend(principal: TenantPrincipal, membershipId: string) {
    this.requireManage(principal);
    if (membershipId === principal.membershipId) {
      throw new ConflictException("You cannot suspend your own membership.");
    }

    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );
      const current = await this.memberForUpdate(
        client,
        principal.organizationId,
        membershipId
      );
      if (current.status === "SUSPENDED") {
        return { membershipId, status: "SUSPENDED" as const };
      }
      if (current.role === "OWNER" && principal.role !== "OWNER") {
        throw new ForbiddenException("Only an OWNER can suspend another OWNER.");
      }
      if (current.role === "OWNER" && current.status === "ACTIVE") {
        await this.assertNotLastActiveOwner(client, principal.organizationId, membershipId);
      }

      await client.query(
        `UPDATE organization_memberships
         SET status = 'SUSPENDED',
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid`,
        [principal.organizationId, membershipId]
      );
      await this.audit(client, principal, "MEMBERSHIP_SUSPENDED", membershipId, {
        role: current.role,
        previousStatus: current.status
      });

      return { membershipId, status: "SUSPENDED" as const };
    });
  }

  async createGroup(
    principal: TenantPrincipal,
    input: { code: string; name: string; propertyIds: readonly string[] }
  ) {
    this.requireManage(principal);
    const code = this.required(input.code, "code");
    const name = this.required(input.name, "name");

    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );
      const propertyIds = await this.validateProperties(
        client,
        principal.organizationId,
        input.propertyIds
      );
      const conflict = await client.query(
        `SELECT id FROM operational_groups
         WHERE organization_id = $1::uuid AND code = $2
         LIMIT 1`,
        [principal.organizationId, code]
      );
      if ((conflict.rowCount ?? 0) > 0) {
        throw new ConflictException("Operational group code already exists.");
      }

      const created = await client.query<QueryResultRow & { id: string }>(
        `INSERT INTO operational_groups (organization_id, code, name)
         VALUES ($1, $2, $3)
         RETURNING id::text`,
        [principal.organizationId, code, name]
      );
      const groupId = created.rows[0]!.id;
      await this.replaceGroupProperties(
        client,
        principal.organizationId,
        groupId,
        propertyIds
      );
      await this.audit(client, principal, "OPERATIONAL_GROUP_CREATED", groupId, {
        code,
        name,
        propertyIds
      });
      return { id: groupId, code, name, propertyIds, isActive: true };
    });
  }

  async updateGroup(
    principal: TenantPrincipal,
    groupId: string,
    input: { code: string; name: string; propertyIds: readonly string[] }
  ) {
    this.requireManage(principal);
    const code = this.required(input.code, "code");
    const name = this.required(input.name, "name");

    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );
      const groupResult = await client.query<QueryResultRow & {
        code: string;
        name: string;
        is_active: boolean;
      }>(
        `SELECT code, name, is_active
         FROM operational_groups
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
         FOR UPDATE`,
        [principal.organizationId, groupId]
      );
      const current = groupResult.rows[0];
      if (!current) throw new NotFoundException("Operational group was not found.");
      if (!current.is_active) {
        throw new ConflictException("Inactive group cannot be edited.");
      }
      const propertyIds = await this.validateProperties(
        client,
        principal.organizationId,
        input.propertyIds
      );
      const conflict = await client.query(
        `SELECT id FROM operational_groups
         WHERE organization_id = $1::uuid
           AND code = $2
           AND id <> $3::uuid
         LIMIT 1`,
        [principal.organizationId, code, groupId]
      );
      if ((conflict.rowCount ?? 0) > 0) {
        throw new ConflictException("Operational group code already exists.");
      }

      await client.query(
        `UPDATE operational_groups
         SET code = $3, name = $4, updated_at = now()
         WHERE organization_id = $1::uuid AND id = $2::uuid`,
        [principal.organizationId, groupId, code, name]
      );
      await this.replaceGroupProperties(
        client,
        principal.organizationId,
        groupId,
        propertyIds
      );
      await this.audit(client, principal, "OPERATIONAL_GROUP_UPDATED", groupId, {
        before: { code: current.code, name: current.name },
        after: { code, name, propertyIds }
      });
      return { id: groupId, code, name, propertyIds, isActive: true };
    });
  }

  async deactivateGroup(principal: TenantPrincipal, groupId: string) {
    this.requireManage(principal);
    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );
      const current = await client.query<QueryResultRow & { is_active: boolean }>(
        `SELECT is_active
         FROM operational_groups
         WHERE organization_id = $1::uuid AND id = $2::uuid
         FOR UPDATE`,
        [principal.organizationId, groupId]
      );
      if (!current.rows[0]) {
        throw new NotFoundException("Operational group was not found.");
      }
      if (!current.rows[0].is_active) {
        return { id: groupId, isActive: false };
      }

      const activeScopes = await client.query(
        `SELECT 1
         FROM membership_scopes ms
         JOIN organization_memberships om
           ON om.organization_id = ms.organization_id
          AND om.id = ms.membership_id
         WHERE ms.organization_id = $1::uuid
           AND ms.scope_type = 'OPERATIONAL_GROUP'
           AND ms.operational_group_id = $2::uuid
           AND om.status IN ('ACTIVE', 'INVITED')
         LIMIT 1`,
        [principal.organizationId, groupId]
      );
      if ((activeScopes.rowCount ?? 0) > 0) {
        throw new ConflictException(
          "Move active members away from this group before deactivating it."
        );
      }

      await client.query(
        `UPDATE operational_groups
         SET is_active = false, updated_at = now()
         WHERE organization_id = $1::uuid AND id = $2::uuid`,
        [principal.organizationId, groupId]
      );
      await this.audit(client, principal, "OPERATIONAL_GROUP_DEACTIVATED", groupId, {});
      return { id: groupId, isActive: false };
    });
  }

  private requireManage(principal: TenantPrincipal) {
    if (
      !this.accessControl.can(principal.membership, "membership.manage", {
        organizationId: principal.organizationId
      })
    ) {
      throw new ForbiddenException("Membership manage permission denied.");
    }
  }

  private assertRole(principal: TenantPrincipal, role: Role) {
    if (!roles.includes(role)) {
      throw new ConflictException("Invalid membership role.");
    }
    if (role === "OWNER" && principal.role !== "OWNER") {
      throw new ForbiddenException("Only an OWNER can assign the OWNER role.");
    }
  }

  private async memberForUpdate(
    client: PoolClient,
    organizationId: string,
    membershipId: string
  ): Promise<MemberRow> {
    const result = await client.query<MemberRow>(
      `SELECT
         om.id::text,
         om.user_id::text,
         u.email,
         u.display_name,
         om.role,
         om.status,
         om.created_at,
         om.updated_at
       FROM organization_memberships om
       JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = $1::uuid
         AND om.id = $2::uuid
       FOR UPDATE OF om`,
      [organizationId, membershipId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Membership was not found.");
    return row;
  }

  private async assertNotLastActiveOwner(
    client: PoolClient,
    organizationId: string,
    excludingMembershipId: string
  ) {
    const result = await client.query<QueryResultRow & { count: number }>(
      `SELECT count(*)::int AS count
       FROM organization_memberships
       WHERE organization_id = $1::uuid
         AND role = 'OWNER'
         AND status = 'ACTIVE'
         AND id <> $2::uuid`,
      [organizationId, excludingMembershipId]
    );
    if ((result.rows[0]?.count ?? 0) < 1) {
      throw new ConflictException(
        "Organization must keep at least one active OWNER."
      );
    }
  }

  private async validateScopes(
    client: PoolClient,
    organizationId: string,
    role: Role,
    input: readonly TeamScopeInput[]
  ): Promise<TeamScopeInput[]> {
    if (input.length === 0) {
      throw new ConflictException("Membership requires at least one scope.");
    }
    const organizationScopes = input.filter((scope) => scope.type === "ORGANIZATION");
    if (organizationScopes.length > 0 && input.length !== 1) {
      throw new ConflictException(
        "ORGANIZATION scope cannot be combined with narrower scopes."
      );
    }
    if (role === "OWNER" && organizationScopes.length !== 1) {
      throw new ConflictException("OWNER must have ORGANIZATION scope.");
    }

    const unique = new Map<string, TeamScopeInput>();
    for (const scope of input) {
      if (scope.type === "ORGANIZATION") {
        unique.set("ORGANIZATION", scope);
      } else if (scope.type === "OPERATIONAL_GROUP") {
        unique.set("GROUP:" + scope.operationalGroupId, scope);
      } else {
        unique.set("PROPERTY:" + scope.propertyId, scope);
      }
    }
    const scopes = [...unique.values()];

    const groupIds = scopes.flatMap((scope) =>
      scope.type === "OPERATIONAL_GROUP" ? [scope.operationalGroupId] : []
    );
    if (groupIds.length > 0) {
      const result = await client.query<QueryResultRow & { id: string }>(
        `SELECT id::text
         FROM operational_groups
         WHERE organization_id = $1::uuid
           AND is_active = true
           AND id = ANY($2::uuid[])`,
        [organizationId, groupIds]
      );
      if (result.rowCount !== groupIds.length) {
        throw new ConflictException("One or more operational groups are invalid.");
      }
    }

    const propertyIds = scopes.flatMap((scope) =>
      scope.type === "PROPERTY" ? [scope.propertyId] : []
    );
    if (propertyIds.length > 0) {
      const result = await client.query<QueryResultRow & { id: string }>(
        `SELECT id::text
         FROM properties
         WHERE organization_id = $1::uuid
           AND is_active = true
           AND id = ANY($2::uuid[])`,
        [organizationId, propertyIds]
      );
      if (result.rowCount !== propertyIds.length) {
        throw new ConflictException("One or more properties are invalid.");
      }
    }

    return scopes;
  }

  private async replaceScopes(
    client: PoolClient,
    organizationId: string,
    membershipId: string,
    scopes: readonly TeamScopeInput[]
  ) {
    await client.query(
      `DELETE FROM membership_scopes
       WHERE organization_id = $1::uuid
         AND membership_id = $2::uuid`,
      [organizationId, membershipId]
    );
    for (const scope of scopes) {
      await client.query(
        `INSERT INTO membership_scopes (
           organization_id,
           membership_id,
           scope_type,
           operational_group_id,
           property_id
         )
         VALUES ($1, $2, $3, $4, $5)`,
        [
          organizationId,
          membershipId,
          scope.type,
          scope.type === "OPERATIONAL_GROUP" ? scope.operationalGroupId : null,
          scope.type === "PROPERTY" ? scope.propertyId : null
        ]
      );
    }
  }

  private async validateProperties(
    client: PoolClient,
    organizationId: string,
    input: readonly string[]
  ): Promise<string[]> {
    const propertyIds = [...new Set(input)];
    if (propertyIds.length === 0) return [];
    const result = await client.query<QueryResultRow & { id: string }>(
      `SELECT id::text
       FROM properties
       WHERE organization_id = $1::uuid
         AND is_active = true
         AND id = ANY($2::uuid[])`,
      [organizationId, propertyIds]
    );
    if (result.rowCount !== propertyIds.length) {
      throw new ConflictException("One or more properties are invalid.");
    }
    return propertyIds;
  }

  private async replaceGroupProperties(
    client: PoolClient,
    organizationId: string,
    groupId: string,
    propertyIds: readonly string[]
  ) {
    await client.query(
      `DELETE FROM property_operational_groups
       WHERE organization_id = $1::uuid
         AND operational_group_id = $2::uuid`,
      [organizationId, groupId]
    );
    for (const propertyId of propertyIds) {
      await client.query(
        `INSERT INTO property_operational_groups (
           organization_id, property_id, operational_group_id
         )
         VALUES ($1, $2, $3)`,
        [organizationId, propertyId, groupId]
      );
    }
  }

  private mapScope(row: ScopeRow) {
    if (row.scope_type === "ORGANIZATION") {
      return { type: "ORGANIZATION" as const, label: "Toàn tổ chức" };
    }
    if (row.scope_type === "OPERATIONAL_GROUP") {
      return {
        type: "OPERATIONAL_GROUP" as const,
        operationalGroupId: row.operational_group_id!,
        label: row.operational_group_name ?? "Nhóm vận hành"
      };
    }
    return {
      type: "PROPERTY" as const,
      propertyId: row.property_id!,
      label: row.property_name ?? "Cơ sở"
    };
  }

  private async audit(
    client: PoolClient,
    principal: TenantPrincipal,
    action: string,
    resourceId: string,
    metadata: Readonly<Record<string, unknown>>
  ) {
    await client.query(
      `INSERT INTO audit_events (
         organization_id, actor_user_id, action, resource_type, resource_id, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        principal.organizationId,
        principal.userId,
        action,
        action.startsWith("OPERATIONAL_GROUP") ? "OPERATIONAL_GROUP" : "MEMBERSHIP",
        resourceId,
        JSON.stringify(metadata)
      ]
    );
  }

  private email(value: string) {
    const normalized = value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new ConflictException("A valid email is required.");
    }
    return normalized;
  }

  private required(value: string, field: string) {
    const normalized = value.trim();
    if (!normalized) throw new ConflictException(field + " is required.");
    return normalized;
  }
}
