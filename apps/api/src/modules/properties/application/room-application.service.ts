import { Injectable } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import {
  CommercialPolicyService,
  type OrganizationCommercialPolicy
} from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { MembershipAccess } from "../../identity/domain/access-control.js";
import type { Room } from "../domain/property-model.js";

export interface PropertyActor {
  userId: string;
  membership: MembershipAccess;
}

export interface CreateRoomInput {
  actor: PropertyActor;
  organizationId: string;
  roomId: string;
  propertyId: string;
  floorId?: string | null;
  code: string;
  name: string;
  sortOrder?: number;
}

type PropertyRow = QueryResultRow & {
  id: string;
};

type RoomRow = QueryResultRow & {
  id: string;
  organization_id: string;
  property_id: string;
  floor_id: string | null;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

export class PropertyAuthorizationError extends Error {
  constructor() {
    super("Principal is not authorized to manage rooms for this property.");
    this.name = "PropertyAuthorizationError";
  }
}

export class PropertyNotFoundError extends Error {
  constructor() {
    super("Property was not found in the current organization.");
    this.name = "PropertyNotFoundError";
  }
}

export class FloorNotFoundError extends Error {
  constructor() {
    super("Floor was not found in the current property.");
    this.name = "FloorNotFoundError";
  }
}

export class RoomIdentityConflictError extends Error {
  constructor() {
    super("Room id was already used with different room data.");
    this.name = "RoomIdentityConflictError";
  }
}

export class RoomCodeConflictError extends Error {
  constructor() {
    super("Room code already exists in this property.");
    this.name = "RoomCodeConflictError";
  }
}

function mapRoom(row: RoomRow): Room {
  return {
    id: row.id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    floorId: row.floor_id,
    code: row.code,
    name: row.name,
    sortOrder: row.sort_order,
    isActive: row.is_active
  };
}

@Injectable()
export class RoomApplicationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async create(input: CreateRoomInput): Promise<Room> {
    const code = input.code.trim();
    const name = input.name.trim();
    const sortOrder = input.sortOrder ?? 0;
    const floorId = input.floorId ?? null;

    if (code.length === 0 || name.length === 0) {
      throw new Error("Room code and name are required.");
    }

    if (!Number.isInteger(sortOrder)) {
      throw new Error("sortOrder must be an integer.");
    }

    return this.database.withTransaction(async (client) => {
      await this.commercialPolicy.lockOrganizationForMutation(
        client,
        input.organizationId
      );
      const policy = await this.commercialPolicy.loadPolicy(
        client,
        input.organizationId
      );
      this.commercialPolicy.assertWriteAllowed(policy);

      const property = await this.findProperty(
        client,
        input.organizationId,
        input.propertyId
      );
      if (!property) {
        throw new PropertyNotFoundError();
      }

      const operationalGroupIds = await this.findOperationalGroupIds(
        client,
        input.organizationId,
        input.propertyId
      );

      if (
        !this.accessControl.can(input.actor.membership, "property.manage", {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          operationalGroupIds
        })
      ) {
        throw new PropertyAuthorizationError();
      }

      const existing = await this.findRoom(
        client,
        input.organizationId,
        input.roomId
      );

      if (existing) {
        if (
          existing.property_id !== input.propertyId ||
          existing.floor_id !== floorId ||
          existing.code !== code ||
          existing.name !== name ||
          existing.sort_order !== sortOrder ||
          !existing.is_active
        ) {
          throw new RoomIdentityConflictError();
        }

        return mapRoom(existing);
      }

      if (floorId !== null) {
        const floor = await client.query(
          `SELECT id
           FROM floors
           WHERE organization_id = $1
             AND property_id = $2
             AND id = $3
             AND is_active = true`,
          [input.organizationId, input.propertyId, floorId]
        );

        if (floor.rowCount !== 1) {
          throw new FloorNotFoundError();
        }
      }

      const codeConflict = await client.query(
        `SELECT id
         FROM rooms
         WHERE organization_id = $1
           AND property_id = $2
           AND code = $3`,
        [input.organizationId, input.propertyId, code]
      );
      if ((codeConflict.rowCount ?? 0) > 0) {
        throw new RoomCodeConflictError();
      }

      const usageResult = await client.query<QueryResultRow & { count: number }>(
        `SELECT count(*)::int AS count
         FROM rooms
         WHERE organization_id = $1
           AND is_active = true`,
        [input.organizationId]
      );
      const current = usageResult.rows[0]?.count ?? 0;
      this.assertRoomIncrease(policy, current);

      const inserted = await client.query<RoomRow>(
        `INSERT INTO rooms (
           id,
           organization_id,
           property_id,
           floor_id,
           code,
           name,
           sort_order
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING
           id::text,
           organization_id::text,
           property_id::text,
           floor_id::text,
           code,
           name,
           sort_order,
           is_active`,
        [
          input.roomId,
          input.organizationId,
          input.propertyId,
          floorId,
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
         VALUES ($1, $2, 'ROOM_CREATED', 'ROOM', $3, $4::jsonb)`,
        [
          input.organizationId,
          input.actor.userId,
          input.roomId,
          JSON.stringify({
            propertyId: input.propertyId,
            floorId,
            code,
            sortOrder,
            planVersionId: policy.planVersionId,
            roomLimit: policy.entitlements.roomLimit
          })
        ]
      );

      return mapRoom(inserted.rows[0]!);
    });
  }

  private assertRoomIncrease(
    policy: OrganizationCommercialPolicy,
    current: number
  ): void {
    this.commercialPolicy.assertResourceIncreaseAllowed(
      policy,
      "ROOM",
      current,
      1
    );
  }

  private async findProperty(
    client: PoolClient,
    organizationId: string,
    propertyId: string
  ): Promise<PropertyRow | undefined> {
    const result = await client.query<PropertyRow>(
      `SELECT id::text
       FROM properties
       WHERE organization_id = $1
         AND id = $2
         AND is_active = true`,
      [organizationId, propertyId]
    );
    return result.rows[0];
  }

  private async findOperationalGroupIds(
    client: PoolClient,
    organizationId: string,
    propertyId: string
  ): Promise<string[]> {
    const result = await client.query<QueryResultRow & { id: string }>(
      `SELECT operational_group_id::text AS id
       FROM property_operational_groups
       WHERE organization_id = $1
         AND property_id = $2
       ORDER BY operational_group_id`,
      [organizationId, propertyId]
    );
    return result.rows.map((row) => row.id);
  }

  private async findRoom(
    client: PoolClient,
    organizationId: string,
    roomId: string
  ): Promise<RoomRow | undefined> {
    const result = await client.query<RoomRow>(
      `SELECT
         id::text,
         organization_id::text,
         property_id::text,
         floor_id::text,
         code,
         name,
         sort_order,
         is_active
       FROM rooms
       WHERE organization_id = $1
         AND id = $2`,
      [organizationId, roomId]
    );
    return result.rows[0];
  }
}
