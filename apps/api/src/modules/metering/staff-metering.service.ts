import {
  ConflictException,
  ForbiddenException,
  Injectable
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import { roleHasPermission } from "../identity/domain/access-control.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";
import {
  MeteringService,
  type MeterType
} from "./metering.service.js";

type ChecklistRow = QueryResultRow & {
  property_id: string;
  property_code: string;
  property_name: string;
  operational_group_ids: string[];
  floor_id: string | null;
  floor_code: string | null;
  floor_name: string | null;
  floor_sort_order: number | null;
  room_id: string;
  room_code: string;
  room_name: string;
  room_sort_order: number;
  electricity_meter_id: string | null;
  electricity_previous_date: Date | string | null;
  electricity_previous_value: string | null;
  electricity_current_date: Date | string | null;
  electricity_current_value: string | null;
  electricity_baseline_usage: string | null;
  water_meter_id: string | null;
  water_previous_date: Date | string | null;
  water_previous_value: string | null;
  water_current_date: Date | string | null;
  water_current_value: string | null;
  water_baseline_usage: string | null;
};

type MeterChecklist = {
  id: string;
  meterType: MeterType;
  unit: "KWH" | "M3";
  previousReading: {
    readingDate: string;
    readingValue: string;
  } | null;
  currentReading: {
    readingDate: string;
    readingValue: string;
  } | null;
  baselineUsage: string | null;
};

@Injectable()
export class StaffMeteringService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly metering: MeteringService
  ) {}

  async checklist(principal: TenantPrincipal, rawReadingDate: string) {
    if (!roleHasPermission(principal.role, "meter.read")) {
      throw new ForbiddenException("Meter read permission denied.");
    }
    const readingDate = this.isoDate(rawReadingDate, "readingDate");

    const result = await this.db.query<ChecklistRow>(
      `WITH room_scope AS (
         SELECT
           p.id::text AS property_id,
           p.code AS property_code,
           p.name AS property_name,
           COALESCE(
             array_agg(DISTINCT pog.operational_group_id::text)
               FILTER (WHERE pog.operational_group_id IS NOT NULL),
             '{}'::text[]
           ) AS operational_group_ids,
           f.id::text AS floor_id,
           f.code AS floor_code,
           f.name AS floor_name,
           f.sort_order AS floor_sort_order,
           r.id::text AS room_id,
           r.code AS room_code,
           r.name AS room_name,
           r.sort_order AS room_sort_order
         FROM rooms r
         JOIN properties p
           ON p.organization_id = r.organization_id
          AND p.id = r.property_id
          AND p.is_active = true
         LEFT JOIN floors f
           ON f.organization_id = r.organization_id
          AND f.property_id = r.property_id
          AND f.id = r.floor_id
          AND f.is_active = true
         LEFT JOIN property_operational_groups pog
           ON pog.organization_id = p.organization_id
          AND pog.property_id = p.id
         WHERE r.organization_id = $1::uuid
           AND r.is_active = true
         GROUP BY
           p.id, p.code, p.name,
           f.id, f.code, f.name, f.sort_order,
           r.id, r.code, r.name, r.sort_order
       ),
       history_ranked AS (
         SELECT
           mr.meter_id,
           mr.reading_date,
           mr.reading_value,
           mr.id,
           row_number() OVER (
             PARTITION BY mr.meter_id
             ORDER BY mr.reading_date DESC, mr.id DESC
           ) AS rn
         FROM meter_readings mr
         WHERE mr.organization_id = $1::uuid
           AND mr.reading_date < $2::date
       ),
       history_recent AS (
         SELECT meter_id, reading_date, reading_value, id
         FROM history_ranked
         WHERE rn <= 4
       ),
       history_deltas AS (
         SELECT
           meter_id,
           reading_value - lag(reading_value) OVER (
             PARTITION BY meter_id
             ORDER BY reading_date, id
           ) AS delta
         FROM history_recent
       ),
       baseline AS (
         SELECT
           meter_id,
           avg(delta) FILTER (WHERE delta IS NOT NULL AND delta >= 0)::text
             AS baseline_usage
         FROM history_deltas
         GROUP BY meter_id
       )
       SELECT
         rs.*,
         em.id::text AS electricity_meter_id,
         ep.reading_date AS electricity_previous_date,
         ep.reading_value::text AS electricity_previous_value,
         ec.reading_date AS electricity_current_date,
         ec.reading_value::text AS electricity_current_value,
         eb.baseline_usage AS electricity_baseline_usage,
         wm.id::text AS water_meter_id,
         wp.reading_date AS water_previous_date,
         wp.reading_value::text AS water_previous_value,
         wc.reading_date AS water_current_date,
         wc.reading_value::text AS water_current_value,
         wb.baseline_usage AS water_baseline_usage
       FROM room_scope rs
       LEFT JOIN meters em
         ON em.organization_id = $1::uuid
        AND em.room_id = rs.room_id::uuid
        AND em.meter_type = 'ELECTRICITY'
        AND em.is_active = true
       LEFT JOIN LATERAL (
         SELECT reading_date, reading_value
         FROM meter_readings
         WHERE organization_id = $1::uuid
           AND meter_id = em.id
           AND reading_date < $2::date
         ORDER BY reading_date DESC, id DESC
         LIMIT 1
       ) ep ON true
       LEFT JOIN LATERAL (
         SELECT reading_date, reading_value
         FROM meter_readings
         WHERE organization_id = $1::uuid
           AND meter_id = em.id
           AND reading_date = $2::date
         ORDER BY id DESC
         LIMIT 1
       ) ec ON true
       LEFT JOIN baseline eb ON eb.meter_id = em.id
       LEFT JOIN meters wm
         ON wm.organization_id = $1::uuid
        AND wm.room_id = rs.room_id::uuid
        AND wm.meter_type = 'WATER'
        AND wm.is_active = true
       LEFT JOIN LATERAL (
         SELECT reading_date, reading_value
         FROM meter_readings
         WHERE organization_id = $1::uuid
           AND meter_id = wm.id
           AND reading_date < $2::date
         ORDER BY reading_date DESC, id DESC
         LIMIT 1
       ) wp ON true
       LEFT JOIN LATERAL (
         SELECT reading_date, reading_value
         FROM meter_readings
         WHERE organization_id = $1::uuid
           AND meter_id = wm.id
           AND reading_date = $2::date
         ORDER BY id DESC
         LIMIT 1
       ) wc ON true
       LEFT JOIN baseline wb ON wb.meter_id = wm.id
       ORDER BY
         rs.property_name,
         rs.property_code,
         rs.floor_sort_order NULLS LAST,
         rs.floor_name NULLS LAST,
         rs.room_sort_order,
         rs.room_code,
         rs.room_id`,
      [principal.organizationId, readingDate]
    );

    const properties = new Map<
      string,
      {
        id: string;
        code: string;
        name: string;
        writeAllowed: boolean;
        rooms: Array<{
          id: string;
          code: string;
          name: string;
          floor: { id: string; code: string | null; name: string | null } | null;
          electricity: MeterChecklist | null;
          water: MeterChecklist | null;
          complete: boolean;
          missingMeter: boolean;
        }>;
      }
    >();

    for (const row of result.rows) {
      const resource = {
        organizationId: principal.organizationId,
        propertyId: row.property_id,
        operationalGroupIds: row.operational_group_ids
      };
      if (!this.accessControl.can(principal.membership, "meter.read", resource)) {
        continue;
      }

      let property = properties.get(row.property_id);
      if (!property) {
        property = {
          id: row.property_id,
          code: row.property_code,
          name: row.property_name,
          writeAllowed:
            roleHasPermission(principal.role, "meter.write") &&
            this.accessControl.can(principal.membership, "meter.write", resource),
          rooms: []
        };
        properties.set(row.property_id, property);
      }

      const electricity = this.meterFromRow(row, "ELECTRICITY");
      const water = this.meterFromRow(row, "WATER");
      const missingMeter = electricity === null || water === null;
      const complete =
        !missingMeter &&
        electricity.currentReading !== null &&
        water.currentReading !== null;

      property.rooms.push({
        id: row.room_id,
        code: row.room_code,
        name: row.room_name,
        floor: row.floor_id
          ? {
              id: row.floor_id,
              code: row.floor_code,
              name: row.floor_name
            }
          : null,
        electricity,
        water,
        complete,
        missingMeter
      });
    }

    const mapped = [...properties.values()].map((property) => {
      const completedRoomCount = property.rooms.filter((room) => room.complete).length;
      const missingMeterRoomCount = property.rooms.filter(
        (room) => room.missingMeter
      ).length;
      return {
        ...property,
        roomCount: property.rooms.length,
        completedRoomCount,
        pendingRoomCount: property.rooms.length - completedRoomCount,
        missingMeterRoomCount
      };
    });

    return {
      organization: {
        id: principal.organizationId,
        name: principal.organizationName
      },
      principal: {
        role: principal.role
      },
      readingDate,
      properties: mapped,
      summary: {
        propertyCount: mapped.length,
        roomCount: mapped.reduce((sum, property) => sum + property.roomCount, 0),
        completedRoomCount: mapped.reduce(
          (sum, property) => sum + property.completedRoomCount,
          0
        ),
        pendingRoomCount: mapped.reduce(
          (sum, property) => sum + property.pendingRoomCount,
          0
        ),
        missingMeterRoomCount: mapped.reduce(
          (sum, property) => sum + property.missingMeterRoomCount,
          0
        )
      }
    };
  }

  async addStaffReading(
    principal: TenantPrincipal,
    meterId: string,
    input: {
      id: string;
      readingDate: string;
      readingValue: string | number;
    }
  ) {
    return this.metering.addReading(principal, meterId, {
      ...input,
      source: "STAFF"
    });
  }

  private meterFromRow(
    row: ChecklistRow,
    meterType: MeterType
  ): MeterChecklist | null {
    const electricity = meterType === "ELECTRICITY";
    const id = electricity ? row.electricity_meter_id : row.water_meter_id;
    if (!id) return null;

    const previousDate = electricity
      ? row.electricity_previous_date
      : row.water_previous_date;
    const previousValue = electricity
      ? row.electricity_previous_value
      : row.water_previous_value;
    const currentDate = electricity
      ? row.electricity_current_date
      : row.water_current_date;
    const currentValue = electricity
      ? row.electricity_current_value
      : row.water_current_value;
    const baselineUsage = electricity
      ? row.electricity_baseline_usage
      : row.water_baseline_usage;

    return {
      id,
      meterType,
      unit: electricity ? "KWH" : "M3",
      previousReading:
        previousDate && previousValue !== null
          ? {
              readingDate: this.dateOnly(previousDate),
              readingValue: this.decimal3(previousValue)
            }
          : null,
      currentReading:
        currentDate && currentValue !== null
          ? {
              readingDate: this.dateOnly(currentDate),
              readingValue: this.decimal3(currentValue)
            }
          : null,
      baselineUsage:
        baselineUsage === null ? null : this.decimal3(baselineUsage)
    };
  }

  private decimal3(value: string) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new ConflictException("Meter quantity must be non-negative.");
    }
    return numeric.toFixed(3);
  }

  private isoDate(value: string, field: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new ConflictException(field + " must use YYYY-MM-DD.");
    }
    const date = new Date(value + "T00:00:00.000Z");
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      throw new ConflictException(field + " is not a valid calendar date.");
    }
    return value;
  }

  private dateOnly(value: Date | string) {
    return value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value.slice(0, 10);
  }
}
