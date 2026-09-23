import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { CommercialPolicyService } from "../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import { roleHasPermission } from "../identity/domain/access-control.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";

export type MeterType = "ELECTRICITY" | "WATER";
export type MeterReadingSource = "ADMIN" | "STAFF" | "IMPORT";

export type ResolvedMeterUsage =
  | {
      status: "READY";
      meterId: string;
      meterType: MeterType;
      unit: "KWH" | "M3";
      quantity: string;
      previous: { id: string; readingDate: string; value: string };
      current: { id: string; readingDate: string; value: string };
    }
  | {
      status:
        | "MISSING_METER"
        | "MISSING_PREVIOUS_READING"
        | "MISSING_CURRENT_READING";
      meterType: MeterType;
      meterId?: string;
    };

type MeterRow = QueryResultRow & {
  id: string;
  room_id: string;
  property_id: string;
  meter_type: MeterType;
  unit: "KWH" | "M3";
  label: string | null;
  is_active: boolean;
  operational_group_ids: string[];
};

type ReadingRow = QueryResultRow & {
  id: string;
  meter_id: string;
  reading_date: Date | string;
  reading_value: string;
  source: MeterReadingSource;
};

@Injectable()
export class MeteringService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async listRoomMeters(principal: TenantPrincipal, roomId: string) {
    const scope = await this.requireRoom(principal, roomId, "meter.read");
    const meters = await this.db.query<MeterRow>(
      `SELECT
         m.id::text,
         m.room_id::text,
         r.property_id::text,
         m.meter_type,
         m.unit,
         m.label,
         m.is_active,
         $3::text[] AS operational_group_ids
       FROM meters m
       JOIN rooms r
         ON r.organization_id = m.organization_id
        AND r.id = m.room_id
       WHERE m.organization_id = $1::uuid
         AND m.room_id = $2::uuid
       ORDER BY m.meter_type, m.created_at, m.id`,
      [principal.organizationId, roomId, scope.operationalGroupIds]
    );

    return {
      roomId,
      meters: meters.rows.map((row) => ({
        id: row.id,
        meterType: row.meter_type,
        unit: row.unit,
        label: row.label,
        isActive: row.is_active
      }))
    };
  }

  async createMeter(
    principal: TenantPrincipal,
    input: {
      id: string;
      roomId: string;
      meterType: MeterType;
      label?: string | null;
    }
  ) {
    if (input.meterType !== "ELECTRICITY" && input.meterType !== "WATER") {
      throw new ConflictException("Unsupported meterType.");
    }
    const label = input.label?.trim() || null;
    const unit = input.meterType === "ELECTRICITY" ? "KWH" : "M3";

    return this.db.withTransaction(async (client) => {
      await this.requireRoomWithClient(
        client,
        principal,
        input.roomId,
        "meter.write"
      );
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const existing = await client.query<MeterRow>(
        `SELECT
           m.id::text,
           m.room_id::text,
           r.property_id::text,
           m.meter_type,
           m.unit,
           m.label,
           m.is_active,
           '{}'::text[] AS operational_group_ids
         FROM meters m
         JOIN rooms r
           ON r.organization_id = m.organization_id
          AND r.id = m.room_id
         WHERE m.organization_id = $1::uuid
           AND m.id = $2::uuid
         LIMIT 1`,
        [principal.organizationId, input.id]
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        if (
          existingRow.room_id !== input.roomId ||
          existingRow.meter_type !== input.meterType ||
          existingRow.label !== label ||
          !existingRow.is_active
        ) {
          throw new ConflictException(
            "Meter id was already used with different data."
          );
        }
        return {
          id: existingRow.id,
          roomId: existingRow.room_id,
          meterType: existingRow.meter_type,
          unit: existingRow.unit,
          label: existingRow.label,
          isActive: existingRow.is_active
        };
      }

      const active = await client.query(
        `SELECT id
         FROM meters
         WHERE organization_id = $1::uuid
           AND room_id = $2::uuid
           AND meter_type = $3
           AND is_active = true
         LIMIT 1`,
        [principal.organizationId, input.roomId, input.meterType]
      );
      if ((active.rowCount ?? 0) > 0) {
        throw new ConflictException(
          "Room already has an active " + input.meterType.toLowerCase() + " meter."
        );
      }

      await client.query(
        `INSERT INTO meters (
           id,
           organization_id,
           room_id,
           meter_type,
           unit,
           label,
           created_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.id,
          principal.organizationId,
          input.roomId,
          input.meterType,
          unit,
          label,
          principal.userId
        ]
      );

      await this.audit(
        client,
        principal,
        "METER_CREATED",
        "METER",
        input.id,
        {
          roomId: input.roomId,
          meterType: input.meterType,
          unit
        }
      );

      return {
        id: input.id,
        roomId: input.roomId,
        meterType: input.meterType,
        unit,
        label,
        isActive: true
      };
    });
  }

  async listReadings(principal: TenantPrincipal, meterId: string) {
    const meter = await this.requireMeter(principal, meterId, "meter.read");
    const readings = await this.db.query<ReadingRow>(
      `SELECT
         id::text,
         meter_id::text,
         reading_date,
         reading_value::text,
         source
       FROM meter_readings
       WHERE organization_id = $1::uuid
         AND meter_id = $2::uuid
       ORDER BY reading_date DESC, id DESC
       LIMIT 200`,
      [principal.organizationId, meterId]
    );

    return {
      meter: {
        id: meter.id,
        roomId: meter.room_id,
        meterType: meter.meter_type,
        unit: meter.unit,
        label: meter.label,
        isActive: meter.is_active
      },
      readings: readings.rows.map((row) => ({
        id: row.id,
        readingDate: this.dateOnly(row.reading_date),
        readingValue: this.decimal3(row.reading_value),
        source: row.source
      }))
    };
  }

  async addReading(
    principal: TenantPrincipal,
    meterId: string,
    input: {
      id: string;
      readingDate: string;
      readingValue: string | number;
      source?: MeterReadingSource;
    }
  ) {
    const readingDate = this.isoDate(input.readingDate, "readingDate");
    const readingValue = this.decimal3(input.readingValue);
    const source = input.source ?? "ADMIN";
    if (!["ADMIN", "STAFF", "IMPORT"].includes(source)) {
      throw new ConflictException("Unsupported meter reading source.");
    }

    return this.db.withTransaction(async (client) => {
      const meter = await this.requireMeterWithClient(
        client,
        principal,
        meterId,
        "meter.write"
      );
      if (!meter.is_active) {
        throw new ConflictException("Cannot add a reading to an inactive meter.");
      }
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const existing = await client.query<ReadingRow>(
        `SELECT
           id::text,
           meter_id::text,
           reading_date,
           reading_value::text,
           source
         FROM meter_readings
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
         LIMIT 1`,
        [principal.organizationId, input.id]
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        if (
          existingRow.meter_id !== meterId ||
          this.dateOnly(existingRow.reading_date) !== readingDate ||
          this.decimal3(existingRow.reading_value) !== readingValue ||
          existingRow.source !== source
        ) {
          throw new ConflictException(
            "Meter reading id was already used with different data."
          );
        }
        return this.mapReading(existingRow);
      }

      const sameDate = await client.query(
        `SELECT id
         FROM meter_readings
         WHERE organization_id = $1::uuid
           AND meter_id = $2::uuid
           AND reading_date = $3::date
         LIMIT 1`,
        [principal.organizationId, meterId, readingDate]
      );
      if ((sameDate.rowCount ?? 0) > 0) {
        throw new ConflictException(
          "A meter reading already exists for this date."
        );
      }

      const [previous, next] = await Promise.all([
        client.query<ReadingRow>(
          `SELECT
             id::text,
             meter_id::text,
             reading_date,
             reading_value::text,
             source
           FROM meter_readings
           WHERE organization_id = $1::uuid
             AND meter_id = $2::uuid
             AND reading_date < $3::date
           ORDER BY reading_date DESC, id DESC
           LIMIT 1`,
          [principal.organizationId, meterId, readingDate]
        ),
        client.query<ReadingRow>(
          `SELECT
             id::text,
             meter_id::text,
             reading_date,
             reading_value::text,
             source
           FROM meter_readings
           WHERE organization_id = $1::uuid
             AND meter_id = $2::uuid
             AND reading_date > $3::date
           ORDER BY reading_date ASC, id ASC
           LIMIT 1`,
          [principal.organizationId, meterId, readingDate]
        )
      ]);

      const valueMilli = this.toMilli(readingValue);
      const previousRow = previous.rows[0];
      if (
        previousRow &&
        valueMilli < this.toMilli(this.decimal3(previousRow.reading_value))
      ) {
        throw new ConflictException(
          "Meter reading cannot be lower than the previous reading."
        );
      }
      const nextRow = next.rows[0];
      if (
        nextRow &&
        valueMilli > this.toMilli(this.decimal3(nextRow.reading_value))
      ) {
        throw new ConflictException(
          "Meter reading cannot be higher than the next reading."
        );
      }

      await client.query(
        `INSERT INTO meter_readings (
           id,
           organization_id,
           meter_id,
           reading_date,
           reading_value,
           source,
           created_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5::numeric, $6, $7)`,
        [
          input.id,
          principal.organizationId,
          meterId,
          readingDate,
          readingValue,
          source,
          principal.userId
        ]
      );

      await this.audit(
        client,
        principal,
        "METER_READING_RECORDED",
        "METER_READING",
        input.id,
        {
          meterId,
          roomId: meter.room_id,
          meterType: meter.meter_type,
          readingDate,
          readingValue,
          source
        }
      );

      return {
        id: input.id,
        readingDate,
        readingValue,
        source
      };
    });
  }

  async resolveUsage(
    client: PoolClient,
    organizationId: string,
    roomId: string,
    meterType: MeterType,
    periodStart: string,
    periodEnd: string
  ): Promise<ResolvedMeterUsage> {
    const meterResult = await client.query<QueryResultRow & {
      id: string;
      unit: "KWH" | "M3";
    }>(
      `SELECT id::text, unit
       FROM meters
       WHERE organization_id = $1::uuid
         AND room_id = $2::uuid
         AND meter_type = $3
         AND is_active = true
       LIMIT 1`,
      [organizationId, roomId, meterType]
    );
    const meter = meterResult.rows[0];
    if (!meter) {
      return { status: "MISSING_METER", meterType };
    }

    const previous = await client.query<ReadingRow>(
      `SELECT
         id::text,
         meter_id::text,
         reading_date,
         reading_value::text,
         source
       FROM meter_readings
       WHERE organization_id = $1::uuid
         AND meter_id = $2::uuid
         AND reading_date <= $3::date
       ORDER BY reading_date DESC, id DESC
       LIMIT 1`,
      [organizationId, meter.id, periodStart]
    );
    const previousRow = previous.rows[0];
    if (!previousRow) {
      return {
        status: "MISSING_PREVIOUS_READING",
        meterType,
        meterId: meter.id
      };
    }

    const current = await client.query<ReadingRow>(
      `SELECT
         id::text,
         meter_id::text,
         reading_date,
         reading_value::text,
         source
       FROM meter_readings
       WHERE organization_id = $1::uuid
         AND meter_id = $2::uuid
         AND reading_date = $3::date
       ORDER BY id DESC
       LIMIT 1`,
      [organizationId, meter.id, periodEnd]
    );
    const currentRow = current.rows[0];
    if (!currentRow) {
      return {
        status: "MISSING_CURRENT_READING",
        meterType,
        meterId: meter.id
      };
    }

    const previousValue = this.decimal3(previousRow.reading_value);
    const currentValue = this.decimal3(currentRow.reading_value);
    const usageMilli = this.toMilli(currentValue) - this.toMilli(previousValue);
    if (usageMilli < 0n) {
      throw new ConflictException(
        "Meter usage became negative; readings require manual review."
      );
    }

    return {
      status: "READY",
      meterId: meter.id,
      meterType,
      unit: meter.unit,
      quantity: this.fromMilli(usageMilli),
      previous: {
        id: previousRow.id,
        readingDate: this.dateOnly(previousRow.reading_date),
        value: previousValue
      },
      current: {
        id: currentRow.id,
        readingDate: this.dateOnly(currentRow.reading_date),
        value: currentValue
      }
    };
  }

  private async requireRoom(
    principal: TenantPrincipal,
    roomId: string,
    permission: "meter.read" | "meter.write"
  ) {
    if (!roleHasPermission(principal.role, permission)) {
      throw new ForbiddenException("Meter permission denied.");
    }
    const result = await this.db.query<QueryResultRow & {
      property_id: string;
      operational_group_ids: string[];
    }>(
      `SELECT
         r.property_id::text,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids
       FROM rooms r
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = r.organization_id
        AND pog.property_id = r.property_id
       WHERE r.organization_id = $1::uuid
         AND r.id = $2::uuid
       GROUP BY r.id
       LIMIT 1`,
      [principal.organizationId, roomId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Room was not found.");
    if (
      !this.accessControl.can(principal.membership, permission, {
        organizationId: principal.organizationId,
        propertyId: row.property_id,
        operationalGroupIds: row.operational_group_ids
      })
    ) {
      throw new ForbiddenException("Meter scope denied for this room.");
    }
    return {
      propertyId: row.property_id,
      operationalGroupIds: row.operational_group_ids
    };
  }

  private async requireRoomWithClient(
    client: PoolClient,
    principal: TenantPrincipal,
    roomId: string,
    permission: "meter.write"
  ) {
    if (!roleHasPermission(principal.role, permission)) {
      throw new ForbiddenException("Meter permission denied.");
    }
    const result = await client.query<QueryResultRow & {
      property_id: string;
      operational_group_ids: string[];
    }>(
      `SELECT
         r.property_id::text,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids
       FROM rooms r
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = r.organization_id
        AND pog.property_id = r.property_id
       WHERE r.organization_id = $1::uuid
         AND r.id = $2::uuid
         AND r.is_active = true
       GROUP BY r.id
       LIMIT 1`,
      [principal.organizationId, roomId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Room was not found.");
    if (
      !this.accessControl.can(principal.membership, permission, {
        organizationId: principal.organizationId,
        propertyId: row.property_id,
        operationalGroupIds: row.operational_group_ids
      })
    ) {
      throw new ForbiddenException("Meter scope denied for this room.");
    }
  }

  private async requireMeter(
    principal: TenantPrincipal,
    meterId: string,
    permission: "meter.read" | "meter.write"
  ) {
    if (!roleHasPermission(principal.role, permission)) {
      throw new ForbiddenException("Meter permission denied.");
    }
    const result = await this.db.query<MeterRow>(
      `SELECT
         m.id::text,
         m.room_id::text,
         r.property_id::text,
         m.meter_type,
         m.unit,
         m.label,
         m.is_active,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids
       FROM meters m
       JOIN rooms r
         ON r.organization_id = m.organization_id
        AND r.id = m.room_id
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = r.organization_id
        AND pog.property_id = r.property_id
       WHERE m.organization_id = $1::uuid
         AND m.id = $2::uuid
       GROUP BY m.id, r.property_id
       LIMIT 1`,
      [principal.organizationId, meterId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Meter was not found.");
    if (
      !this.accessControl.can(principal.membership, permission, {
        organizationId: principal.organizationId,
        propertyId: row.property_id,
        operationalGroupIds: row.operational_group_ids
      })
    ) {
      throw new ForbiddenException("Meter scope denied.");
    }
    return row;
  }

  private async requireMeterWithClient(
    client: PoolClient,
    principal: TenantPrincipal,
    meterId: string,
    permission: "meter.write"
  ) {
    if (!roleHasPermission(principal.role, permission)) {
      throw new ForbiddenException("Meter permission denied.");
    }
    const result = await client.query<MeterRow>(
      `SELECT
         m.id::text,
         m.room_id::text,
         r.property_id::text,
         m.meter_type,
         m.unit,
         m.label,
         m.is_active,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids
       FROM meters m
       JOIN rooms r
         ON r.organization_id = m.organization_id
        AND r.id = m.room_id
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = r.organization_id
        AND pog.property_id = r.property_id
       WHERE m.organization_id = $1::uuid
         AND m.id = $2::uuid
       GROUP BY m.id, r.property_id
       LIMIT 1`,
      [principal.organizationId, meterId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Meter was not found.");
    if (
      !this.accessControl.can(principal.membership, permission, {
        organizationId: principal.organizationId,
        propertyId: row.property_id,
        operationalGroupIds: row.operational_group_ids
      })
    ) {
      throw new ForbiddenException("Meter scope denied.");
    }
    return row;
  }

  private mapReading(row: ReadingRow) {
    return {
      id: row.id,
      readingDate: this.dateOnly(row.reading_date),
      readingValue: this.decimal3(row.reading_value),
      source: row.source
    };
  }

  private decimal3(value: string | number) {
    const raw = typeof value === "number" ? String(value) : value.trim();
    const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(raw);
    if (!match) {
      throw new ConflictException(
        "readingValue must be a non-negative decimal with at most 3 decimals."
      );
    }
    return match[1] + "." + (match[2] ?? "").padEnd(3, "0");
  }

  private toMilli(value: string) {
    const [whole, fraction] = value.split(".");
    return BigInt(whole!) * 1000n + BigInt(fraction!);
  }

  private fromMilli(value: bigint) {
    const whole = value / 1000n;
    const fraction = (value % 1000n).toString().padStart(3, "0");
    return whole.toString() + "." + fraction;
  }

  private isoDate(value: string, field: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new ConflictException(field + " must use YYYY-MM-DD.");
    }
    const date = new Date(value + "T00:00:00.000Z");
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new ConflictException(field + " is not a valid calendar date.");
    }
    return value;
  }

  private dateOnly(value: Date | string) {
    return value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value.slice(0, 10);
  }

  private async audit(
    client: PoolClient,
    principal: TenantPrincipal,
    action: string,
    resourceType: string,
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
        resourceType,
        resourceId,
        JSON.stringify(metadata)
      ]
    );
  }
}
