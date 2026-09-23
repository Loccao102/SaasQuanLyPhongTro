import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";
import {
  FloorNotFoundError,
  PropertyAuthorizationError,
  PropertyNotFoundError,
  RoomApplicationService,
  RoomCodeConflictError,
  RoomIdentityConflictError
} from "./room-application.service.js";

type PropertyRow = QueryResultRow & {
  id: string;
  code: string;
  name: string;
  property_type: string;
  address_text: string | null;
  is_active: boolean;
};

type FloorRow = QueryResultRow & {
  id: string;
  property_id: string;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

type RoomRow = QueryResultRow & {
  id: string;
  property_id: string;
  floor_id: string | null;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

export type PropertyType =
  | "BOARDING_HOUSE"
  | "MINI_APARTMENT"
  | "APARTMENT"
  | "OTHER";

export interface CreatePropertyCommand {
  id: string;
  code: string;
  name: string;
  propertyType: PropertyType;
  addressText?: string | null;
}

export interface UpdatePropertyCommand {
  code?: string;
  name?: string;
  propertyType?: PropertyType;
  addressText?: string | null;
}

export interface CreateFloorCommand {
  id: string;
  code: string;
  name: string;
  sortOrder?: number;
}

export interface UpdateFloorCommand {
  code?: string;
  name?: string;
  sortOrder?: number;
}

export interface CreateRoomCommand {
  id: string;
  floorId?: string | null;
  code: string;
  name: string;
  sortOrder?: number;
}

export interface UpdateRoomCommand {
  floorId?: string | null;
  code?: string;
  name?: string;
  sortOrder?: number;
}

@Injectable()
export class AssetCommandService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService,
    private readonly rooms: RoomApplicationService
  ) {}

  async createProperty(
    principal: TenantPrincipal,
    input: CreatePropertyCommand
  ) {
    this.requireOrganizationManage(principal);
    const code = this.required(input.code, "code");
    const name = this.required(input.name, "name");
    const addressText = this.optionalText(input.addressText);

    return this.db.withTransaction(async (client) => {
      const policy = await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const existing = await client.query<PropertyRow>(
        `SELECT id::text, code, name, property_type, address_text, is_active
         FROM properties
         WHERE organization_id = $1::uuid AND id = $2::uuid`,
        [principal.organizationId, input.id]
      );
      const row = existing.rows[0];
      if (row) {
        if (
          row.code !== code ||
          row.name !== name ||
          row.property_type !== input.propertyType ||
          row.address_text !== addressText ||
          !row.is_active
        ) {
          throw new ConflictException(
            "Property id was already used with different data."
          );
        }
        return this.mapProperty(row);
      }

      await this.assertPropertyCodeAvailable(
        client,
        principal.organizationId,
        code
      );

      const inserted = await client.query<PropertyRow>(
        `INSERT INTO properties (
           id, organization_id, code, name, property_type, address_text
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id::text, code, name, property_type, address_text, is_active`,
        [
          input.id,
          principal.organizationId,
          code,
          name,
          input.propertyType,
          addressText
        ]
      );

      await this.audit(client, principal, "PROPERTY_CREATED", "PROPERTY", input.id, {
        code,
        propertyType: input.propertyType,
        planVersionId: policy.planVersionId
      });

      return this.mapProperty(inserted.rows[0]!);
    });
  }

  async updateProperty(
    principal: TenantPrincipal,
    propertyId: string,
    input: UpdatePropertyCommand
  ) {
    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );
      const property = await this.requireProperty(
        client,
        principal,
        propertyId
      );

      const code =
        input.code === undefined ? property.code : this.required(input.code, "code");
      const name =
        input.name === undefined ? property.name : this.required(input.name, "name");
      const propertyType = input.propertyType ?? property.property_type;
      const addressText =
        input.addressText === undefined
          ? property.address_text
          : this.optionalText(input.addressText);

      if (code !== property.code) {
        await this.assertPropertyCodeAvailable(
          client,
          principal.organizationId,
          code,
          propertyId
        );
      }

      const result = await client.query<PropertyRow>(
        `UPDATE properties
         SET code = $3,
             name = $4,
             property_type = $5,
             address_text = $6,
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
           AND is_active = true
         RETURNING id::text, code, name, property_type, address_text, is_active`,
        [
          principal.organizationId,
          propertyId,
          code,
          name,
          propertyType,
          addressText
        ]
      );

      await this.audit(client, principal, "PROPERTY_UPDATED", "PROPERTY", propertyId, {
        code,
        name,
        propertyType,
        addressText
      });

      return this.mapProperty(result.rows[0]!);
    });
  }

  async createFloor(
    principal: TenantPrincipal,
    propertyId: string,
    input: CreateFloorCommand
  ) {
    const code = this.required(input.code, "code");
    const name = this.required(input.name, "name");
    const sortOrder = this.integer(input.sortOrder ?? 0, "sortOrder");

    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );
      await this.requireProperty(client, principal, propertyId);

      const existing = await client.query<FloorRow>(
        `SELECT id::text, property_id::text, code, name, sort_order, is_active
         FROM floors
         WHERE organization_id = $1::uuid AND id = $2::uuid`,
        [principal.organizationId, input.id]
      );
      const row = existing.rows[0];
      if (row) {
        if (
          row.property_id !== propertyId ||
          row.code !== code ||
          row.name !== name ||
          row.sort_order !== sortOrder ||
          !row.is_active
        ) {
          throw new ConflictException(
            "Floor id was already used with different data."
          );
        }
        return this.mapFloor(row);
      }

      await this.assertFloorCodeAvailable(
        client,
        principal.organizationId,
        propertyId,
        code
      );

      const inserted = await client.query<FloorRow>(
        `INSERT INTO floors (
           id, organization_id, property_id, code, name, sort_order
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id::text, property_id::text, code, name, sort_order, is_active`,
        [
          input.id,
          principal.organizationId,
          propertyId,
          code,
          name,
          sortOrder
        ]
      );

      await this.audit(client, principal, "FLOOR_CREATED", "FLOOR", input.id, {
        propertyId,
        code,
        sortOrder
      });

      return this.mapFloor(inserted.rows[0]!);
    });
  }

  async updateFloor(
    principal: TenantPrincipal,
    floorId: string,
    input: UpdateFloorCommand
  ) {
    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );
      const floor = await this.requireFloor(client, principal, floorId);
      const code =
        input.code === undefined ? floor.code : this.required(input.code, "code");
      const name =
        input.name === undefined ? floor.name : this.required(input.name, "name");
      const sortOrder =
        input.sortOrder === undefined
          ? floor.sort_order
          : this.integer(input.sortOrder, "sortOrder");

      if (code !== floor.code) {
        await this.assertFloorCodeAvailable(
          client,
          principal.organizationId,
          floor.property_id,
          code,
          floorId
        );
      }

      const result = await client.query<FloorRow>(
        `UPDATE floors
         SET code = $3, name = $4, sort_order = $5, updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
           AND is_active = true
         RETURNING id::text, property_id::text, code, name, sort_order, is_active`,
        [principal.organizationId, floorId, code, name, sortOrder]
      );

      await this.audit(client, principal, "FLOOR_UPDATED", "FLOOR", floorId, {
        propertyId: floor.property_id,
        code,
        name,
        sortOrder
      });

      return this.mapFloor(result.rows[0]!);
    });
  }

  async createRoom(
    principal: TenantPrincipal,
    propertyId: string,
    input: CreateRoomCommand
  ) {
    try {
      return await this.rooms.create({
        actor: {
          userId: principal.userId,
          membership: principal.membership
        },
        organizationId: principal.organizationId,
        roomId: input.id,
        propertyId,
        floorId: input.floorId ?? null,
        code: input.code,
        name: input.name,
        sortOrder: input.sortOrder
      });
    } catch (error) {
      if (error instanceof PropertyAuthorizationError) {
        throw new ForbiddenException(error.message);
      }
      if (
        error instanceof PropertyNotFoundError ||
        error instanceof FloorNotFoundError
      ) {
        throw new NotFoundException(error.message);
      }
      if (
        error instanceof RoomIdentityConflictError ||
        error instanceof RoomCodeConflictError
      ) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  async updateRoom(
    principal: TenantPrincipal,
    roomId: string,
    input: UpdateRoomCommand
  ) {
    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );
      const room = await this.requireRoom(client, principal, roomId);
      const code =
        input.code === undefined ? room.code : this.required(input.code, "code");
      const name =
        input.name === undefined ? room.name : this.required(input.name, "name");
      const sortOrder =
        input.sortOrder === undefined
          ? room.sort_order
          : this.integer(input.sortOrder, "sortOrder");
      const floorId =
        input.floorId === undefined ? room.floor_id : input.floorId;

      if (floorId !== null) {
        const floor = await client.query<QueryResultRow>(
          `SELECT id
           FROM floors
           WHERE organization_id = $1::uuid
             AND property_id = $2::uuid
             AND id = $3::uuid
             AND is_active = true`,
          [principal.organizationId, room.property_id, floorId]
        );
        if (floor.rowCount !== 1) {
          throw new NotFoundException("Floor was not found in this property.");
        }
      }

      if (code !== room.code) {
        await this.assertRoomCodeAvailable(
          client,
          principal.organizationId,
          room.property_id,
          code,
          roomId
        );
      }

      const result = await client.query<RoomRow>(
        `UPDATE rooms
         SET floor_id = $3,
             code = $4,
             name = $5,
             sort_order = $6,
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
           AND is_active = true
         RETURNING id::text, property_id::text, floor_id::text,
                   code, name, sort_order, is_active`,
        [
          principal.organizationId,
          roomId,
          floorId,
          code,
          name,
          sortOrder
        ]
      );

      await this.audit(client, principal, "ROOM_UPDATED", "ROOM", roomId, {
        propertyId: room.property_id,
        floorId,
        code,
        name,
        sortOrder
      });

      return this.mapRoom(result.rows[0]!);
    });
  }

  async deactivateRoom(principal: TenantPrincipal, roomId: string) {
    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );
      const room = await this.requireRoom(client, principal, roomId);

      const lease = await client.query(
        `SELECT id
         FROM leases
         WHERE organization_id = $1::uuid
           AND room_id = $2::uuid
           AND status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
         LIMIT 1`,
        [principal.organizationId, roomId]
      );
      if ((lease.rowCount ?? 0) > 0) {
        throw new ConflictException(
          "Room cannot be deactivated while it has a current lease."
        );
      }

      await client.query(
        `UPDATE rooms
         SET is_active = false, updated_at = now()
         WHERE organization_id = $1::uuid AND id = $2::uuid`,
        [principal.organizationId, roomId]
      );
      await this.audit(client, principal, "ROOM_DEACTIVATED", "ROOM", roomId, {
        propertyId: room.property_id
      });
      return { id: roomId, isActive: false };
    });
  }

  async deactivateFloor(principal: TenantPrincipal, floorId: string) {
    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );
      const floor = await this.requireFloor(client, principal, floorId);
      const rooms = await client.query(
        `SELECT id
         FROM rooms
         WHERE organization_id = $1::uuid
           AND floor_id = $2::uuid
           AND is_active = true
         LIMIT 1`,
        [principal.organizationId, floorId]
      );
      if ((rooms.rowCount ?? 0) > 0) {
        throw new ConflictException(
          "Floor cannot be deactivated while it contains active rooms."
        );
      }

      await client.query(
        `UPDATE floors
         SET is_active = false, updated_at = now()
         WHERE organization_id = $1::uuid AND id = $2::uuid`,
        [principal.organizationId, floorId]
      );
      await this.audit(client, principal, "FLOOR_DEACTIVATED", "FLOOR", floorId, {
        propertyId: floor.property_id
      });
      return { id: floorId, isActive: false };
    });
  }

  async deactivateProperty(principal: TenantPrincipal, propertyId: string) {
    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );
      await this.requireProperty(client, principal, propertyId);

      const child = await client.query(
        `SELECT 1
         FROM (
           SELECT id FROM rooms
           WHERE organization_id = $1::uuid
             AND property_id = $2::uuid
             AND is_active = true
           UNION ALL
           SELECT id FROM floors
           WHERE organization_id = $1::uuid
             AND property_id = $2::uuid
             AND is_active = true
         ) active_children
         LIMIT 1`,
        [principal.organizationId, propertyId]
      );
      if ((child.rowCount ?? 0) > 0) {
        throw new ConflictException(
          "Property cannot be deactivated while it has active floors or rooms."
        );
      }

      await client.query(
        `UPDATE properties
         SET is_active = false, updated_at = now()
         WHERE organization_id = $1::uuid AND id = $2::uuid`,
        [principal.organizationId, propertyId]
      );
      await this.audit(
        client,
        principal,
        "PROPERTY_DEACTIVATED",
        "PROPERTY",
        propertyId,
        {}
      );
      return { id: propertyId, isActive: false };
    });
  }

  private requireOrganizationManage(principal: TenantPrincipal): void {
    if (
      !this.accessControl.can(principal.membership, "property.manage", {
        organizationId: principal.organizationId
      })
    ) {
      throw new ForbiddenException(
        "Organization scope with property.manage is required to create a property."
      );
    }
  }

  private async requireProperty(
    client: PoolClient,
    principal: TenantPrincipal,
    propertyId: string
  ): Promise<PropertyRow> {
    const result = await client.query<PropertyRow>(
      `SELECT id::text, code, name, property_type, address_text, is_active
       FROM properties
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
         AND is_active = true`,
      [principal.organizationId, propertyId]
    );
    const property = result.rows[0];
    if (!property) {
      throw new NotFoundException("Property was not found.");
    }
    await this.requirePropertyPermission(client, principal, propertyId);
    return property;
  }

  private async requireFloor(
    client: PoolClient,
    principal: TenantPrincipal,
    floorId: string
  ): Promise<FloorRow> {
    const result = await client.query<FloorRow>(
      `SELECT id::text, property_id::text, code, name, sort_order, is_active
       FROM floors
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
         AND is_active = true`,
      [principal.organizationId, floorId]
    );
    const floor = result.rows[0];
    if (!floor) {
      throw new NotFoundException("Floor was not found.");
    }
    await this.requirePropertyPermission(client, principal, floor.property_id);
    return floor;
  }

  private async requireRoom(
    client: PoolClient,
    principal: TenantPrincipal,
    roomId: string
  ): Promise<RoomRow> {
    const result = await client.query<RoomRow>(
      `SELECT id::text, property_id::text, floor_id::text,
              code, name, sort_order, is_active
       FROM rooms
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
         AND is_active = true`,
      [principal.organizationId, roomId]
    );
    const room = result.rows[0];
    if (!room) {
      throw new NotFoundException("Room was not found.");
    }
    await this.requirePropertyPermission(client, principal, room.property_id);
    return room;
  }

  private async requirePropertyPermission(
    client: PoolClient,
    principal: TenantPrincipal,
    propertyId: string
  ): Promise<void> {
    const groups = await client.query<QueryResultRow & { id: string }>(
      `SELECT operational_group_id::text AS id
       FROM property_operational_groups
       WHERE organization_id = $1::uuid AND property_id = $2::uuid`,
      [principal.organizationId, propertyId]
    );
    if (
      !this.accessControl.can(principal.membership, "property.manage", {
        organizationId: principal.organizationId,
        propertyId,
        operationalGroupIds: groups.rows.map((row) => row.id)
      })
    ) {
      throw new ForbiddenException("Property manage permission denied.");
    }
  }

  private async assertPropertyCodeAvailable(
    client: PoolClient,
    organizationId: string,
    code: string,
    exceptId?: string
  ): Promise<void> {
    const result = await client.query(
      `SELECT id
       FROM properties
       WHERE organization_id = $1::uuid
         AND code = $2
         AND ($3::uuid IS NULL OR id <> $3::uuid)
       LIMIT 1`,
      [organizationId, code, exceptId ?? null]
    );
    if ((result.rowCount ?? 0) > 0) {
      throw new ConflictException("Property code already exists.");
    }
  }

  private async assertFloorCodeAvailable(
    client: PoolClient,
    organizationId: string,
    propertyId: string,
    code: string,
    exceptId?: string
  ): Promise<void> {
    const result = await client.query(
      `SELECT id
       FROM floors
       WHERE organization_id = $1::uuid
         AND property_id = $2::uuid
         AND code = $3
         AND ($4::uuid IS NULL OR id <> $4::uuid)
       LIMIT 1`,
      [organizationId, propertyId, code, exceptId ?? null]
    );
    if ((result.rowCount ?? 0) > 0) {
      throw new ConflictException("Floor code already exists in this property.");
    }
  }

  private async assertRoomCodeAvailable(
    client: PoolClient,
    organizationId: string,
    propertyId: string,
    code: string,
    exceptId?: string
  ): Promise<void> {
    const result = await client.query(
      `SELECT id
       FROM rooms
       WHERE organization_id = $1::uuid
         AND property_id = $2::uuid
         AND code = $3
         AND ($4::uuid IS NULL OR id <> $4::uuid)
       LIMIT 1`,
      [organizationId, propertyId, code, exceptId ?? null]
    );
    if ((result.rowCount ?? 0) > 0) {
      throw new ConflictException("Room code already exists in this property.");
    }
  }

  private async audit(
    client: PoolClient,
    principal: TenantPrincipal,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Readonly<Record<string, unknown>>
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_events (
         organization_id, actor_user_id, action, resource_type, resource_id, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        principal.organizationId,
        principal.userId,
        action,
        resourceType,
        resourceId,
        JSON.stringify(metadata)
      ]
    );
  }

  private required(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new ConflictException(field + " is required.");
    }
    return normalized;
  }

  private optionalText(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private integer(value: number, field: string): number {
    if (!Number.isInteger(value)) {
      throw new ConflictException(field + " must be an integer.");
    }
    return value;
  }

  private mapProperty(row: PropertyRow) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      propertyType: row.property_type,
      addressText: row.address_text,
      isActive: row.is_active
    };
  }

  private mapFloor(row: FloorRow) {
    return {
      id: row.id,
      propertyId: row.property_id,
      code: row.code,
      name: row.name,
      sortOrder: row.sort_order,
      isActive: row.is_active
    };
  }

  private mapRoom(row: RoomRow) {
    return {
      id: row.id,
      propertyId: row.property_id,
      floorId: row.floor_id,
      code: row.code,
      name: row.name,
      sortOrder: row.sort_order,
      isActive: row.is_active
    };
  }
}
