import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
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
      await this.syncOpenTerminationMeterReadiness(
        client,
        principal,
        input.roomId,
        "METER_CREATED"
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

  async updateMeter(
    principal: TenantPrincipal,
    meterId: string,
    input: {
      label?: string | null;
      isActive?: boolean;
    }
  ) {
    return this.db.withTransaction(async (client) => {
      const meter = await this.requireMeterWithClient(
        client,
        principal,
        meterId,
        "meter.write"
      );
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const nextLabel =
        input.label === undefined ? meter.label : input.label?.trim() || null;
      const nextActive =
        input.isActive === undefined ? meter.is_active : input.isActive;

      if (nextActive && !meter.is_active) {
        const conflict = await client.query(
          `SELECT id
           FROM meters
           WHERE organization_id = $1::uuid
             AND room_id = $2::uuid
             AND meter_type = $3
             AND is_active = true
             AND id <> $4::uuid
           LIMIT 1`,
          [
            principal.organizationId,
            meter.room_id,
            meter.meter_type,
            meterId
          ]
        );
        if ((conflict.rowCount ?? 0) > 0) {
          throw new ConflictException(
            "Room already has an active " +
              meter.meter_type.toLowerCase() +
              " meter."
          );
        }
      }

      const updated = await client.query<MeterRow>(
        `UPDATE meters m
         SET label = $3,
             is_active = $4,
             updated_at = now()
         FROM rooms r
         WHERE m.organization_id = $1::uuid
           AND m.id = $2::uuid
           AND r.organization_id = m.organization_id
           AND r.id = m.room_id
         RETURNING
           m.id::text,
           m.room_id::text,
           r.property_id::text,
           m.meter_type,
           m.unit,
           m.label,
           m.is_active,
           '{}'::text[] AS operational_group_ids`,
        [
          principal.organizationId,
          meterId,
          nextLabel,
          nextActive
        ]
      );
      const row = updated.rows[0];
      if (!row) throw new NotFoundException("Meter was not found.");

      await this.audit(
        client,
        principal,
        "METER_UPDATED",
        "METER",
        meterId,
        {
          roomId: row.room_id,
          meterType: row.meter_type,
          label: row.label,
          isActive: row.is_active
        }
      );
      await this.syncOpenTerminationMeterReadiness(
        client,
        principal,
        row.room_id,
        "METER_UPDATED"
      );

      return {
        id: row.id,
        roomId: row.room_id,
        meterType: row.meter_type,
        unit: row.unit,
        label: row.label,
        isActive: row.is_active
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

  async addReadingWithClient(
    client: PoolClient,
    principal: TenantPrincipal,
    meterId: string,
    input: {
      id: string;
      readingDate: string;
      readingValue: string | number;
      source?: MeterReadingSource;
      allowCorrection?: boolean;
    }
  ) {
    const readingDate = this.isoDate(input.readingDate, "readingDate");
    const readingValue = this.decimal3(input.readingValue);
    const source = input.source ?? "ADMIN";
    if (!["ADMIN", "STAFF", "IMPORT"].includes(source)) {
      throw new ConflictException("Unsupported meter reading source.");
    }

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
        throw new ConflictException({
          statusCode: 409,
          code: "METER_READING_ID_CONFLICT",
          message: "Meter reading id was already used with different data.",
          serverReading: this.mapReading(existingRow)
        });
      }
      return this.mapReading(existingRow);
    }

    const sameDate = await client.query<ReadingRow>(
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
       ORDER BY id
       LIMIT 1`,
      [principal.organizationId, meterId, readingDate]
    );
    const sameDateRow = sameDate.rows[0];
    if (sameDateRow && !input.allowCorrection) {
      throw new ConflictException({
        statusCode: 409,
        code: "METER_READING_DATE_CONFLICT",
        message: "A meter reading already exists for this date.",
        serverReading: this.mapReading(sameDateRow)
      });
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
      throw new ConflictException({
        statusCode: 409,
        code: "METER_READING_BELOW_PREVIOUS",
        message: "Meter reading cannot be lower than the previous reading.",
        previousReading: this.mapReading(previousRow)
      });
    }
    const nextRow = next.rows[0];
    if (
      nextRow &&
      valueMilli > this.toMilli(this.decimal3(nextRow.reading_value))
    ) {
      throw new ConflictException({
        statusCode: 409,
        code: "METER_READING_ABOVE_NEXT",
        message: "Meter reading cannot be higher than the next reading.",
        nextReading: this.mapReading(nextRow)
      });
    }

    if (sameDateRow && input.allowCorrection) {
      if (this.decimal3(sameDateRow.reading_value) === readingValue) {
        return this.mapReading(sameDateRow);
      }
      await client.query(
        `UPDATE meter_readings
         SET reading_value = $1::numeric,
             source = $2,
             created_by_user_id = $3
         WHERE organization_id = $4::uuid
           AND id = $5::uuid`,
        [
          readingValue,
          source,
          principal.userId,
          principal.organizationId,
          sameDateRow.id
        ]
      );
      await this.audit(
        client,
        principal,
        "METER_READING_UPDATED",
        "METER_READING",
        sameDateRow.id,
        {
          meterId,
          roomId: meter.room_id,
          meterType: meter.meter_type,
          readingDate,
          oldReadingValue: this.decimal3(sameDateRow.reading_value),
          newReadingValue: readingValue,
          source
        }
      );
      await this.syncOpenTerminationMeterReadiness(
        client,
        principal,
        meter.room_id,
        "METER_READING_RECORDED"
      );
      return {
        id: sameDateRow.id,
        readingDate,
        readingValue,
        source
      };
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
    await this.syncOpenTerminationMeterReadiness(
      client,
      principal,
      meter.room_id,
      "METER_READING_RECORDED"
    );

    return {
      id: input.id,
      readingDate,
      readingValue,
      source
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
      allowCorrection?: boolean;
    }
  ) {
    return this.db.withTransaction((client) =>
      this.addReadingWithClient(client, principal, meterId, input)
    );
  }

  async batchAddReadings(
    principal: TenantPrincipal,
    input: {
      readingDate: string;
      readings: Array<{
        id: string;
        meterId: string;
        readingValue: string | number;
        allowCorrection?: boolean;
      }>;
    }
  ) {
    const readingDate = this.isoDate(input.readingDate, "readingDate");
    return this.db.withTransaction(async (client) => {
      const results: Array<{
        id: string;
        readingDate: string;
        readingValue: string;
        source: MeterReadingSource;
      }> = [];
      for (const item of input.readings) {
        const result = await this.addReadingWithClient(
          client,
          principal,
          item.meterId,
          {
            id: item.id,
            readingDate,
            readingValue: item.readingValue,
            source: "ADMIN",
            allowCorrection: item.allowCorrection ?? true
          }
        );
        results.push(result);
      }
      return {
        readingDate,
        savedCount: results.length,
        readings: results
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

  private async requireProperty(
    principal: TenantPrincipal,
    propertyId: string,
    permission: "meter.read" | "meter.write"
  ) {
    if (!roleHasPermission(principal.role, permission)) {
      throw new ForbiddenException("Meter permission denied.");
    }
    const result = await this.db.query<{
      id: string;
      operational_group_ids: string[];
    }>(
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
       WHERE p.organization_id = $1::uuid
         AND p.id = $2::uuid
       GROUP BY p.id
       LIMIT 1`,
      [principal.organizationId, propertyId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Property was not found.");
    if (
      !this.accessControl.can(principal.membership, permission, {
        organizationId: principal.organizationId,
        propertyId: row.id,
        operationalGroupIds: row.operational_group_ids
      })
    ) {
      throw new ForbiddenException("Property scope denied.");
    }
    return row;
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

  private async syncOpenTerminationMeterReadiness(
    client: PoolClient,
    principal: TenantPrincipal,
    roomId: string,
    trigger: "METER_CREATED" | "METER_UPDATED" | "METER_READING_RECORDED"
  ): Promise<void> {
    await client.query(
      `SELECT id
       FROM leases
       WHERE organization_id = $1::uuid
         AND room_id = $2::uuid
         AND status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
       FOR UPDATE`,
      [principal.organizationId, roomId]
    );

    const updated = await client.query<QueryResultRow & {
      lease_id: string;
      meter_readiness: "PENDING" | "READY" | "NOT_REQUIRED";
    }>(
      `WITH target AS (
         SELECT
           t.id,
           t.lease_id,
           t.effective_date,
           t.meter_readiness
         FROM lease_terminations t
         JOIN leases l
           ON l.organization_id = t.organization_id
          AND l.id = t.lease_id
         WHERE t.organization_id = $1::uuid
           AND l.room_id = $2::uuid
           AND l.status = 'TERMINATION_SCHEDULED'
           AND t.status IN ('SCHEDULED', 'READY')
         FOR UPDATE OF t
       ),
       computed AS (
         SELECT
           target.id,
           target.lease_id,
           target.meter_readiness,
           CASE
             WHEN count(m.id) = 0 THEN 'NOT_REQUIRED'
             WHEN count(m.id) FILTER (WHERE mr.id IS NOT NULL) = count(m.id)
               THEN 'READY'
             ELSE 'PENDING'
           END AS next_readiness
         FROM target
         LEFT JOIN meters m
           ON m.organization_id = $1::uuid
          AND m.room_id = $2::uuid
          AND m.is_active = true
         LEFT JOIN meter_readings mr
           ON mr.organization_id = $1::uuid
          AND mr.meter_id = m.id
          AND mr.reading_date = target.effective_date
         GROUP BY
           target.id,
           target.lease_id,
           target.meter_readiness
       ),
       changed AS (
         UPDATE lease_terminations t
         SET meter_readiness = computed.next_readiness,
             status = CASE
               WHEN computed.next_readiness <> 'PENDING'
                AND t.financial_readiness <> 'PENDING'
                AND t.deposit_readiness <> 'PENDING'
               THEN 'READY'
               ELSE 'SCHEDULED'
             END,
             updated_at = now()
         FROM computed
         WHERE t.id = computed.id
           AND t.meter_readiness IS DISTINCT FROM computed.next_readiness
         RETURNING
           t.lease_id::text,
           t.meter_readiness
       )
       SELECT lease_id, meter_readiness
       FROM changed`,
      [principal.organizationId, roomId]
    );

    for (const row of updated.rows) {
      await this.audit(
        client,
        principal,
        "LEASE_TERMINATION_METER_READINESS_SYNCED",
        "LEASE",
        row.lease_id,
        {
          roomId,
          meterReadiness: row.meter_readiness,
          trigger,
          source: "METERING"
        }
      );
    }
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

  async generateExcelTemplate(
    principal: TenantPrincipal,
    propertyId: string,
    readingDateStr: string
  ): Promise<Buffer> {
    if (!roleHasPermission(principal.role, "meter.read")) {
      throw new ForbiddenException("Không có quyền xem chỉ số điện nước.");
    }
    await this.requireProperty(principal, propertyId, "meter.read");
    const readingDate = this.isoDate(readingDateStr, "readingDate");

    const queryRes = await this.db.query<{
      floor_number: number;
      room_code: string;
      room_name: string;
      meter_id: string;
      meter_type: string;
      meter_label: string | null;
      previous_value: string | null;
      previous_date: Date | string | null;
    }>(
      `SELECT
         COALESCE(fl.floor_number, 1) AS floor_number,
         rm.code AS room_code,
         rm.name AS room_name,
         m.id::text AS meter_id,
         m.meter_type,
         m.label AS meter_label,
         prev.reading_value::text AS previous_value,
         prev.reading_date AS previous_date
       FROM rooms rm
       LEFT JOIN floors fl
         ON fl.organization_id = rm.organization_id
        AND fl.id = rm.floor_id
       JOIN meters m
         ON m.organization_id = rm.organization_id
        AND m.room_id = rm.id
        AND m.is_active = true
       LEFT JOIN LATERAL (
         SELECT reading_value, reading_date
         FROM meter_readings
         WHERE organization_id = rm.organization_id
           AND meter_id = m.id
           AND reading_date < $3::date
         ORDER BY reading_date DESC, created_at DESC
         LIMIT 1
       ) prev ON true
       WHERE rm.organization_id = $1::uuid
         AND rm.property_id = $2::uuid
       ORDER BY COALESCE(fl.floor_number, 1) ASC, rm.code ASC, m.meter_type ASC`,
      [principal.organizationId, propertyId, readingDate]
    );

    const wb = XLSX.utils.book_new();
    const rows: (string | number)[][] = [
      ["BẢNG KÊ NHẬP CHỈ SỐ ĐIỆN NƯỚC (EXCEL)"],
      [`Ngày chốt chỉ số: ${readingDate}`],
      ["Hướng dẫn: Nhập chỉ số mới vào cột 'Chỉ số mới'. Chỉ số mới phải lớn hơn hoặc bằng chỉ số kỳ trước."],
      [],
      [
        "Tầng",
        "Mã phòng",
        "Tên phòng",
        "Loại đồng hồ",
        "Tên/Vị trí đồng hồ",
        "Chỉ số cũ",
        "Ngày chốt cũ",
        "Chỉ số mới",
        "Mã hệ thống (Không sửa)"
      ]
    ];

    for (const r of queryRes.rows) {
      const typeLabel = r.meter_type === "ELECTRICITY" ? "Điện (KWH)" : "Nước (m3)";
      const prevVal = r.previous_value ? Number(r.previous_value) : 0;
      const prevDate = r.previous_date
        ? new Date(r.previous_date).toISOString().slice(0, 10)
        : "";
      rows.push([
        r.floor_number,
        r.room_code,
        r.room_name,
        typeLabel,
        r.meter_label || "",
        prevVal,
        prevDate,
        "", // User enters new reading here
        r.meter_id
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 8 },  // Tầng
      { wch: 12 }, // Mã phòng
      { wch: 16 }, // Tên phòng
      { wch: 16 }, // Loại đồng hồ
      { wch: 20 }, // Tên đồng hồ
      { wch: 14 }, // Chỉ số cũ
      { wch: 14 }, // Ngày chốt cũ
      { wch: 20 }, // Chỉ số mới
      { wch: 38 }  // Mã hệ thống
    ];
    XLSX.utils.book_append_sheet(wb, ws, "ChiSoDienNuoc");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  async importFromExcel(
    principal: TenantPrincipal,
    propertyId: string,
    readingDateStr: string,
    fileBuffer: Buffer
  ): Promise<{
    totalRows: number;
    importedCount: number;
    warnings: string[];
    errors: string[];
  }> {
    if (!roleHasPermission(principal.role, "meter.write")) {
      throw new ForbiddenException("Không có quyền ghi chỉ số điện nước.");
    }
    await this.requireProperty(principal, propertyId, "meter.write");
    const readingDate = this.isoDate(readingDateStr, "readingDate");

    const wb = XLSX.read(fileBuffer, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException("File Excel không có sheet nào hợp lệ.");
    }
    const ws = wb.Sheets[sheetName]!;
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1 });

    let headerIndex = -1;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const row = rows[i];
      if (Array.isArray(row)) {
        const text = row.join(" ").toLowerCase();
        if (text.includes("mã hệ thống") || text.includes("chỉ số mới") || text.includes("mã đồng hồ")) {
          headerIndex = i;
          break;
        }
      }
    }

    if (headerIndex === -1) {
      throw new BadRequestException("Không tìm thấy dòng tiêu đề hợp lệ trong file Excel. Vui lòng dùng đúng file mẫu.");
    }

    const headers = rows[headerIndex]!.map((c) => String(c || "").trim().toLowerCase());
    const meterIdCol = headers.findIndex((h) => h.includes("mã hệ thống") || h.includes("mã đồng hồ"));
    const newReadingCol = headers.findIndex((h) => h.includes("chỉ số mới"));
    const roomCodeCol = headers.findIndex((h) => h.includes("mã phòng"));
    const prevReadingCol = headers.findIndex((h) => h.includes("chỉ số cũ"));

    if (meterIdCol === -1 || newReadingCol === -1) {
      throw new BadRequestException("File Excel thiếu cột 'Chỉ số mới' hoặc 'Mã hệ thống (Không sửa)'.");
    }

    const readingsToBatch: Array<{
      id: string;
      meterId: string;
      readingValue: string | number;
      allowCorrection: boolean;
    }> = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    let dataRowCount = 0;

    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row) || row.length === 0) continue;
      const rawMeterId = String(row[meterIdCol] || "").trim();
      const rawNewVal = row[newReadingCol];
      const roomCode = roomCodeCol !== -1 ? String(row[roomCodeCol] || "").trim() : `Dòng ${i + 1}`;
      const rawPrevVal = prevReadingCol !== -1 ? row[prevReadingCol] : null;

      if (!rawMeterId) continue;
      dataRowCount++;

      if (rawNewVal === undefined || rawNewVal === null || String(rawNewVal).trim() === "") {
        continue;
      }

      const numVal = Number(String(rawNewVal).replace(",", "."));
      if (isNaN(numVal) || numVal < 0) {
        errors.push(`Phòng ${roomCode}: Chỉ số mới '${rawNewVal}' không phải là số hợp lệ.`);
        continue;
      }

      if (rawPrevVal !== null && rawPrevVal !== undefined && String(rawPrevVal).trim() !== "") {
        const prevNum = Number(String(rawPrevVal).replace(",", "."));
        if (!isNaN(prevNum) && numVal < prevNum) {
          errors.push(`Phòng ${roomCode}: Chỉ số mới (${numVal}) nhỏ hơn chỉ số cũ (${prevNum}).`);
          continue;
        }
        if (!isNaN(prevNum) && prevNum > 0 && numVal - prevNum > prevNum * 2.5) {
          warnings.push(`Phòng ${roomCode}: Mức tiêu thụ (${(numVal - prevNum).toFixed(1)}) tăng hơn 2.5 lần so với kỳ trước.`);
        }
      }

      readingsToBatch.push({
        id: randomUUID(),
        meterId: rawMeterId,
        readingValue: numVal,
        allowCorrection: true
      });
    }

    if (errors.length > 0) {
      return {
        totalRows: dataRowCount,
        importedCount: 0,
        warnings,
        errors
      };
    }

    if (readingsToBatch.length === 0) {
      return {
        totalRows: dataRowCount,
        importedCount: 0,
        warnings: ["Không có chỉ số mới nào được điền trong file."],
        errors: []
      };
    }

    await this.batchAddReadings(principal, {
      readingDate,
      readings: readingsToBatch
    });

    return {
      totalRows: dataRowCount,
      importedCount: readingsToBatch.length,
      warnings,
      errors: []
    };
  }
}
