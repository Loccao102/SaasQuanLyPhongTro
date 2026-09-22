import { Injectable } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { MembershipAccess } from "../../identity/domain/access-control.js";
import type { Floor } from "../domain/property-model.js";

export interface FloorActor {
  userId: string;
  membership: MembershipAccess;
}

export interface CreateFloorInput {
  actor: FloorActor;
  organizationId: string;
  propertyId: string;
  floorId: string;
  code: string;
  name: string;
  sortOrder?: number;
}

type PropertyScopeRow = QueryResultRow & {
  id: string;
  operational_group_ids: string[];
};

type FloorRow = QueryResultRow & {
  id: string;
  organization_id: string;
  property_id: string;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

export class FloorAuthorizationError extends Error {
  constructor() {
    super("Principal is not authorized to manage floors for this property.");
    this.name = "FloorAuthorizationError";
  }
}

export class FloorPropertyNotFoundError extends Error {
  constructor() {
    super("Property was not found in the current organization.");
    this.name = "FloorPropertyNotFoundError";
  }
}

export class FloorInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FloorInputError";
  }
}

export class FloorIdentityConflictError extends Error {
  constructor() {
    super("Floor id was already used with different floor data.");
    this.name = "FloorIdentityConflictError";
  }
}

export class FloorCodeConflictError extends Error {
  constructor() {
    super("Floor code already exists in this property.");
    this.name = "FloorCodeConflictError";
  }
}

function mapFloor(row: FloorRow): Floor {
  return {
    id: row.id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    code: row.code,
    name: row.name,
    sortOrder: row.sort_order,
    isActive: row.is_active
  };
}

@Injectable()
export class FloorApplicationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async create(input: CreateFloorInput): Promise<Floor> {
    const code = input.code.trim();
    const name = input.name.trim();
    const sortOrder = input.sortOrder ?? 0;

    if (!code || !name) {
      throw new FloorInputError("Floor code and name are required.");
    }
    if (code.length > 64 || name.length > 200) {
      throw new FloorInputError("Floor code or name is too long.");
    }
    if (!Number.isInteger(sortOrder)) {
      throw new FloorInputError("Floor sortOrder must be an integer.");
    }

    return this.database.withTransaction(async (client) => {
      const property = await this.findPropertyScope(
        client,
        input.organizationId,
        input.propertyId
      );
      if (!property) {
        throw new FloorPropertyNotFoundError();
      }

      if (
        !this.accessControl.can(input.actor.membership, "property.manage", {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          operationalGroupIds: property.operational_group_ids
        })
      ) {
        throw new FloorAuthorizationError();
      }

      await this.commercialPolicy.lockOrganizationForMutation(
        client,
        input.organizationId
      );
      const policy = await this.commercialPolicy.loadPolicy(
        client,
        input.organizationId
      );

      const existing = await this.findFloor(
        client,
        input.organizationId,
        input.floorId
      );
      if (existing) {
        if (
          existing.property_id !== input.propertyId ||
          existing.code !== code ||
          existing.name !== name ||
          existing.sort_order !== sortOrder ||
          !existing.is_active
        ) {
          throw new FloorIdentityConflictError();
        }
        return mapFloor(existing);
      }

      this.commercialPolicy.assertWriteAllowed(policy);

      const codeConflict = await client.query(
        `SELECT id
         FROM floors
         WHERE organization_id = $1
           AND property_id = $2
           AND code = $3`,
        [input.organizationId, input.propertyId, code]
      );
      if ((codeConflict.rowCount ?? 0) > 0) {
        throw new FloorCodeConflictError();
      }

      const inserted = await client.query<FloorRow>(
        `INSERT INTO floors (
           id,
           organization_id,
           property_id,
           code,
           name,
           sort_order
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING
           id::text,
           organization_id::text,
           property_id::text,
           code,
           name,
           sort_order,
           is_active`,
        [
          input.floorId,
          input.organizationId,
          input.propertyId,
          code,
          name,
          sortOrder
        ]
      );

      await client.query(
        `INSERT INTO audit_events (
           organization_id,
           actor_user_id,
           action,
           resource_type,
           resource_id,
           metadata
         )
         VALUES ($1, $2, 'FLOOR_CREATED', 'FLOOR', $3, $4::jsonb)`,
        [
          input.organizationId,
          input.actor.userId,
          input.floorId,
          JSON.stringify({
            propertyId: input.propertyId,
            code,
            sortOrder,
            planVersionId: policy.planVersionId
          })
        ]
      );

      return mapFloor(inserted.rows[0]!);
    });
  }

  private async findPropertyScope(
    client: PoolClient,
    organizationId: string,
    propertyId: string
  ): Promise<PropertyScopeRow | undefined> {
    const result = await client.query<PropertyScopeRow>(
      `SELECT
         p.id::text,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids
       FROM properties p
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       WHERE p.organization_id = $1
         AND p.id = $2
         AND p.is_active = true
       GROUP BY p.id`,
      [organizationId, propertyId]
    );
    return result.rows[0];
  }

  private async findFloor(
    client: PoolClient,
    organizationId: string,
    floorId: string
  ): Promise<FloorRow | undefined> {
    const result = await client.query<FloorRow>(
      `SELECT
         id::text,
         organization_id::text,
         property_id::text,
         code,
         name,
         sort_order,
         is_active
       FROM floors
       WHERE organization_id = $1
         AND id = $2`,
      [organizationId, floorId]
    );
    return result.rows[0];
  }
}
