import {
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import { roleHasPermission } from "../../identity/domain/access-control.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";

type PropertySummaryRow = QueryResultRow & {
  id: string;
  code: string;
  name: string;
  property_type: string;
  address_text: string | null;
  administrative_area_name: string | null;
  operational_group_ids: string[];
  floor_count: number;
  room_count: number;
  occupied_room_count: number;
};

type PropertyDetailRow = PropertySummaryRow;

type FloorRoomRow = QueryResultRow & {
  floor_id: string | null;
  floor_code: string | null;
  floor_name: string | null;
  floor_sort_order: number | null;
  room_id: string;
  room_code: string;
  room_name: string;
  room_sort_order: number;
  lease_id: string | null;
  lease_code: string | null;
  lease_status: string | null;
};

type RoomDetailRow = QueryResultRow & {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  property_id: string;
  property_code: string;
  property_name: string;
  floor_id: string | null;
  floor_code: string | null;
  floor_name: string | null;
  operational_group_ids: string[];
  lease_id: string | null;
  lease_code: string | null;
  lease_status: string | null;
  lease_start_date: Date | null;
  lease_planned_end_date: Date | null;
  base_rent_vnd: string | null;
  deposit_required_vnd: string | null;
};

@Injectable()
export class AssetReadService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService
  ) {}

  async overview(principal: TenantPrincipal) {
    this.requirePropertyRead(principal);

    const result = await this.db.query<PropertySummaryRow>(
      `SELECT
         p.id::text,
         p.code,
         p.name,
         p.property_type,
         p.address_text,
         aa.name AS administrative_area_name,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids,
         count(DISTINCT f.id)::int AS floor_count,
         count(DISTINCT r.id)::int AS room_count,
         count(DISTINCT r.id) FILTER (
           WHERE l.id IS NOT NULL
         )::int AS occupied_room_count
       FROM properties p
       LEFT JOIN administrative_areas aa
         ON aa.id = p.administrative_area_id
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       LEFT JOIN floors f
         ON f.organization_id = p.organization_id
        AND f.property_id = p.id
        AND f.is_active = true
       LEFT JOIN rooms r
         ON r.organization_id = p.organization_id
        AND r.property_id = p.id
        AND r.is_active = true
       LEFT JOIN leases l
         ON l.organization_id = r.organization_id
        AND l.room_id = r.id
        AND l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
       WHERE p.organization_id = $1::uuid
         AND p.is_active = true
       GROUP BY
         p.id, p.code, p.name, p.property_type, p.address_text, aa.name
       ORDER BY p.name, p.id`,
      [principal.organizationId]
    );

    const properties = result.rows
      .filter((row) => this.canReadProperty(principal, row.id, row.operational_group_ids))
      .map((row) => this.mapProperty(row));

    return {
      organization: {
        id: principal.organizationId,
        name: principal.organizationName
      },
      principal: {
        role: principal.role
      },
      summary: {
        propertyCount: properties.length,
        floorCount: properties.reduce((sum, item) => sum + item.floors, 0),
        roomCount: properties.reduce((sum, item) => sum + item.rooms, 0),
        occupiedRoomCount: properties.reduce(
          (sum, item) => sum + item.occupiedRooms,
          0
        ),
        vacantRoomCount: properties.reduce(
          (sum, item) => sum + Math.max(0, item.rooms - item.occupiedRooms),
          0
        )
      },
      properties
    };
  }

  async property(principal: TenantPrincipal, propertyId: string) {
    this.requirePropertyRead(principal);

    const propertyResult = await this.db.query<PropertyDetailRow>(
      `SELECT
         p.id::text,
         p.code,
         p.name,
         p.property_type,
         p.address_text,
         aa.name AS administrative_area_name,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids,
         count(DISTINCT f.id)::int AS floor_count,
         count(DISTINCT r.id)::int AS room_count,
         count(DISTINCT r.id) FILTER (
           WHERE l.id IS NOT NULL
         )::int AS occupied_room_count
       FROM properties p
       LEFT JOIN administrative_areas aa
         ON aa.id = p.administrative_area_id
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       LEFT JOIN floors f
         ON f.organization_id = p.organization_id
        AND f.property_id = p.id
        AND f.is_active = true
       LEFT JOIN rooms r
         ON r.organization_id = p.organization_id
        AND r.property_id = p.id
        AND r.is_active = true
       LEFT JOIN leases l
         ON l.organization_id = r.organization_id
        AND l.room_id = r.id
        AND l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
       WHERE p.organization_id = $1::uuid
         AND p.id = $2::uuid
         AND p.is_active = true
       GROUP BY
         p.id, p.code, p.name, p.property_type, p.address_text, aa.name
       LIMIT 1`,
      [principal.organizationId, propertyId]
    );

    const property = propertyResult.rows[0];
    if (!property) {
      throw new NotFoundException("Property was not found.");
    }
    if (
      !this.canReadProperty(
        principal,
        property.id,
        property.operational_group_ids
      )
    ) {
      throw new ForbiddenException("Property scope denied.");
    }

    const roomResult = await this.db.query<FloorRoomRow>(
      `SELECT
         f.id::text AS floor_id,
         f.code AS floor_code,
         f.name AS floor_name,
         f.sort_order AS floor_sort_order,
         r.id::text AS room_id,
         r.code AS room_code,
         r.name AS room_name,
         r.sort_order AS room_sort_order,
         l.id::text AS lease_id,
         l.lease_code,
         l.status AS lease_status
       FROM rooms r
       LEFT JOIN floors f
         ON f.organization_id = r.organization_id
        AND f.property_id = r.property_id
        AND f.id = r.floor_id
       LEFT JOIN leases l
         ON l.organization_id = r.organization_id
        AND l.room_id = r.id
        AND l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
       WHERE r.organization_id = $1::uuid
         AND r.property_id = $2::uuid
         AND r.is_active = true
       ORDER BY
         f.sort_order NULLS LAST,
         f.name NULLS LAST,
         r.sort_order,
         r.code,
         r.id`,
      [principal.organizationId, propertyId]
    );

    const floorMap = new Map<
      string,
      {
        id: string | null;
        code: string;
        name: string;
        sortOrder: number;
        rooms: Array<{
          id: string;
          code: string;
          name: string;
          sortOrder: number;
          occupancy: "OCCUPIED" | "VACANT";
          lease: { id: string; code: string; status: string } | null;
        }>;
      }
    >();

    for (const row of roomResult.rows) {
      const key = row.floor_id ?? "__NO_FLOOR__";
      if (!floorMap.has(key)) {
        floorMap.set(key, {
          id: row.floor_id,
          code: row.floor_code ?? "NO_FLOOR",
          name: row.floor_name ?? "Chưa gán tầng",
          sortOrder: row.floor_sort_order ?? Number.MAX_SAFE_INTEGER,
          rooms: []
        });
      }
      floorMap.get(key)!.rooms.push({
        id: row.room_id,
        code: row.room_code,
        name: row.room_name,
        sortOrder: row.room_sort_order,
        occupancy: row.lease_id ? "OCCUPIED" : "VACANT",
        lease:
          row.lease_id && row.lease_code && row.lease_status
            ? {
                id: row.lease_id,
                code: row.lease_code,
                status: row.lease_status
              }
            : null
      });
    }

    return {
      organization: {
        id: principal.organizationId,
        name: principal.organizationName
      },
      property: this.mapProperty(property),
      floors: [...floorMap.values()]
    };
  }

  async room(principal: TenantPrincipal, roomId: string) {
    this.requirePropertyRead(principal);

    const result = await this.db.query<RoomDetailRow>(
      `SELECT
         r.id::text,
         r.code,
         r.name,
         r.sort_order,
         p.id::text AS property_id,
         p.code AS property_code,
         p.name AS property_name,
         f.id::text AS floor_id,
         f.code AS floor_code,
         f.name AS floor_name,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids,
         l.id::text AS lease_id,
         l.lease_code,
         l.status AS lease_status,
         l.start_date AS lease_start_date,
         l.planned_end_date AS lease_planned_end_date,
         l.base_rent_vnd::text,
         l.deposit_required_vnd::text
       FROM rooms r
       JOIN properties p
         ON p.organization_id = r.organization_id
        AND p.id = r.property_id
       LEFT JOIN floors f
         ON f.organization_id = r.organization_id
        AND f.property_id = r.property_id
        AND f.id = r.floor_id
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       LEFT JOIN leases l
         ON l.organization_id = r.organization_id
        AND l.room_id = r.id
        AND l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
       WHERE r.organization_id = $1::uuid
         AND r.id = $2::uuid
         AND r.is_active = true
         AND p.is_active = true
       GROUP BY
         r.id, r.code, r.name, r.sort_order,
         p.id, p.code, p.name,
         f.id, f.code, f.name,
         l.id, l.lease_code, l.status, l.start_date, l.planned_end_date,
         l.base_rent_vnd, l.deposit_required_vnd
       LIMIT 1`,
      [principal.organizationId, roomId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Room was not found.");
    }
    if (
      !this.canReadProperty(
        principal,
        row.property_id,
        row.operational_group_ids
      )
    ) {
      throw new ForbiddenException("Property scope denied.");
    }

    return {
      organization: {
        id: principal.organizationId,
        name: principal.organizationName
      },
      room: {
        id: row.id,
        code: row.code,
        name: row.name,
        sortOrder: row.sort_order,
        occupancy: row.lease_id ? "OCCUPIED" : "VACANT"
      },
      property: {
        id: row.property_id,
        code: row.property_code,
        name: row.property_name
      },
      floor: row.floor_id
        ? {
            id: row.floor_id,
            code: row.floor_code,
            name: row.floor_name
          }
        : null,
      currentLease:
        row.lease_id && row.lease_code && row.lease_status
          ? {
              id: row.lease_id,
              code: row.lease_code,
              status: row.lease_status,
              startDate: this.dateOnly(row.lease_start_date),
              plannedEndDate: this.dateOnly(row.lease_planned_end_date),
              baseRentVnd: Number(row.base_rent_vnd),
              depositRequiredVnd: Number(row.deposit_required_vnd)
            }
          : null
    };
  }

  private requirePropertyRead(principal: TenantPrincipal): void {
    if (!roleHasPermission(principal.role, "property.read")) {
      throw new ForbiddenException("Property read permission denied.");
    }
  }

  private canReadProperty(
    principal: TenantPrincipal,
    propertyId: string,
    operationalGroupIds: string[]
  ): boolean {
    return this.accessControl.can(principal.membership, "property.read", {
      organizationId: principal.organizationId,
      propertyId,
      operationalGroupIds
    });
  }

  private mapProperty(row: PropertySummaryRow) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.property_type,
      address: row.address_text,
      administrativeArea: row.administrative_area_name,
      floors: row.floor_count,
      rooms: row.room_count,
      occupiedRooms: row.occupied_room_count,
      vacantRooms: Math.max(0, row.room_count - row.occupied_room_count)
    };
  }

  private dateOnly(value: Date | null): string | null {
    return value ? value.toISOString().slice(0, 10) : null;
  }
}
