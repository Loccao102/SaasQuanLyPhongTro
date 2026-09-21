import { Injectable } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import { CommercialPolicyService } from "./commercial-policy.service.js";

type PeriodRow = QueryResultRow & {
  period_start: string;
  period_end: string;
  reserved_actions: number;
  consumed_actions: number;
};

type ReservationRow = QueryResultRow & {
  id: string;
  organization_id: string;
  period_start: string;
  period_end: string;
  idempotency_key: string;
  source_type: string;
  source_id: string | null;
  requested_actions: number;
  consumed_actions: number;
  released_actions: number;
  status: "OPEN" | "COMPLETED" | "RELEASED";
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
};

type ConsumptionRow = QueryResultRow & {
  id: string;
  organization_id: string;
  reservation_id: string;
  consumption_key: string;
  quantity: number;
  created_at: Date;
};

export interface AutomationQuotaReservation {
  id: string;
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  idempotencyKey: string;
  sourceType: string;
  sourceId: string | null;
  requestedActions: number;
  consumedActions: number;
  releasedActions: number;
  remainingActions: number;
  status: "OPEN" | "COMPLETED" | "RELEASED";
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationQuotaConsumption {
  id: string;
  organizationId: string;
  reservationId: string;
  consumptionKey: string;
  quantity: number;
  createdAt: string;
}

export class AutomationQuotaExceededError extends Error {
  constructor(
    public readonly committed: number,
    public readonly requested: number,
    public readonly limit: number
  ) {
    super(
      `Automation quota exceeded: committed=${committed}, requested=${requested}, limit=${limit}.`
    );
    this.name = "AutomationQuotaExceededError";
  }
}

export class AutomationQuotaReservationNotFoundError extends Error {
  constructor() {
    super("Automation quota reservation was not found.");
    this.name = "AutomationQuotaReservationNotFoundError";
  }
}

export class AutomationQuotaIdempotencyConflictError extends Error {
  constructor() {
    super("Automation quota idempotency key was reused with different input.");
    this.name = "AutomationQuotaIdempotencyConflictError";
  }
}

export class AutomationQuotaConsumptionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationQuotaConsumptionConflictError";
  }
}

function normalizeKey(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length < 3 || normalized.length > 200) {
    throw new Error(`${name} must be between 3 and 200 characters.`);
  }
  return normalized;
}

@Injectable()
export class AutomationQuotaService {
  constructor(
    private readonly database: DatabaseService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async reserve(input: {
    organizationId: string;
    idempotencyKey: string;
    sourceType: string;
    sourceId?: string | null;
    requestedActions: number;
    metadata?: unknown;
  }): Promise<AutomationQuotaReservation> {
    const idempotencyKey = normalizeKey(input.idempotencyKey, "idempotencyKey");
    const sourceType = input.sourceType.trim();
    const sourceId = input.sourceId?.trim() || null;

    if (sourceType.length === 0) {
      throw new Error("sourceType is required.");
    }
    this.assertPositiveInteger(input.requestedActions, "requestedActions");

    return this.database.withTransaction(async (client) => {
      await this.commercialPolicy.lockOrganizationForMutation(
        client,
        input.organizationId
      );

      const existing = await this.findReservationByKey(
        client,
        input.organizationId,
        idempotencyKey
      );
      if (existing) {
        if (
          existing.requested_actions !== input.requestedActions ||
          existing.source_type !== sourceType ||
          existing.source_id !== sourceId
        ) {
          throw new AutomationQuotaIdempotencyConflictError();
        }
        return this.mapReservation(existing);
      }

      const policy = await this.commercialPolicy.loadPolicy(
        client,
        input.organizationId
      );
      this.commercialPolicy.assertWriteAllowed(policy);

      const window = await this.currentPeriod(client);
      await client.query(
        `INSERT INTO automation_quota_periods (
           organization_id, period_start, period_end
         )
         VALUES ($1, $2::date, $3::date)
         ON CONFLICT (organization_id, period_start) DO NOTHING`,
        [input.organizationId, window.periodStart, window.periodEnd]
      );

      const periodResult = await client.query<PeriodRow>(
        `SELECT
           period_start::text,
           period_end::text,
           reserved_actions,
           consumed_actions
         FROM automation_quota_periods
         WHERE organization_id = $1
           AND period_start = $2::date
         FOR UPDATE`,
        [input.organizationId, window.periodStart]
      );
      const period = periodResult.rows[0]!;
      const committed = period.reserved_actions + period.consumed_actions;
      const limit = policy.entitlements.automationActionsMonthly;

      if (committed + input.requestedActions > limit) {
        throw new AutomationQuotaExceededError(
          committed,
          input.requestedActions,
          limit
        );
      }

      const inserted = await client.query<ReservationRow>(
        `INSERT INTO automation_quota_reservations (
           organization_id,
           period_start,
           idempotency_key,
           source_type,
           source_id,
           requested_actions,
           metadata
         )
         VALUES ($1, $2::date, $3, $4, $5, $6, $7::jsonb)
         RETURNING
           id::text,
           organization_id::text,
           period_start::text,
           $8::text AS period_end,
           idempotency_key,
           source_type,
           source_id,
           requested_actions,
           consumed_actions,
           released_actions,
           status,
           metadata,
           created_at,
           updated_at`,
        [
          input.organizationId,
          window.periodStart,
          idempotencyKey,
          sourceType,
          sourceId,
          input.requestedActions,
          JSON.stringify(input.metadata ?? {}),
          window.periodEnd
        ]
      );

      await client.query(
        `UPDATE automation_quota_periods
         SET reserved_actions = reserved_actions + $3,
             updated_at = now()
         WHERE organization_id = $1
           AND period_start = $2::date`,
        [input.organizationId, window.periodStart, input.requestedActions]
      );

      return this.mapReservation(inserted.rows[0]!);
    });
  }

  async consume(input: {
    organizationId: string;
    reservationId: string;
    consumptionKey: string;
    quantity: number;
  }): Promise<{
    reservation: AutomationQuotaReservation;
    consumption: AutomationQuotaConsumption;
  }> {
    const consumptionKey = normalizeKey(input.consumptionKey, "consumptionKey");
    this.assertPositiveInteger(input.quantity, "quantity");

    return this.database.withTransaction(async (client) => {
      await this.commercialPolicy.lockOrganizationForMutation(
        client,
        input.organizationId
      );

      const reservation = await this.findReservationForUpdate(
        client,
        input.organizationId,
        input.reservationId
      );
      if (!reservation) {
        throw new AutomationQuotaReservationNotFoundError();
      }

      const existingConsumption = await client.query<ConsumptionRow>(
        `SELECT
           id::text,
           organization_id::text,
           reservation_id::text,
           consumption_key,
           quantity,
           created_at
         FROM automation_quota_consumptions
         WHERE organization_id = $1
           AND reservation_id = $2
           AND consumption_key = $3`,
        [input.organizationId, input.reservationId, consumptionKey]
      );
      const existing = existingConsumption.rows[0];
      if (existing) {
        if (existing.quantity !== input.quantity) {
          throw new AutomationQuotaIdempotencyConflictError();
        }
        return {
          reservation: this.mapReservation(reservation),
          consumption: this.mapConsumption(existing)
        };
      }

      const policy = await this.commercialPolicy.loadPolicy(
        client,
        input.organizationId
      );
      this.commercialPolicy.assertWriteAllowed(policy);

      if (reservation.status !== "OPEN") {
        throw new AutomationQuotaConsumptionConflictError(
          "Quota reservation is not open."
        );
      }

      const remaining =
        reservation.requested_actions -
        reservation.consumed_actions -
        reservation.released_actions;
      if (input.quantity > remaining) {
        throw new AutomationQuotaConsumptionConflictError(
          "Consumption exceeds remaining reserved actions."
        );
      }

      const consumptionResult = await client.query<ConsumptionRow>(
        `INSERT INTO automation_quota_consumptions (
           organization_id,
           reservation_id,
           consumption_key,
           quantity
         )
         VALUES ($1, $2, $3, $4)
         RETURNING
           id::text,
           organization_id::text,
           reservation_id::text,
           consumption_key,
           quantity,
           created_at`,
        [
          input.organizationId,
          input.reservationId,
          consumptionKey,
          input.quantity
        ]
      );

      const nextConsumed = reservation.consumed_actions + input.quantity;
      const accounted = nextConsumed + reservation.released_actions;
      const nextStatus =
        accounted === reservation.requested_actions ? "COMPLETED" : "OPEN";

      await client.query(
        `UPDATE automation_quota_reservations
         SET consumed_actions = $3,
             status = $4,
             updated_at = now()
         WHERE organization_id = $1
           AND id = $2`,
        [
          input.organizationId,
          input.reservationId,
          nextConsumed,
          nextStatus
        ]
      );

      await client.query(
        `UPDATE automation_quota_periods
         SET reserved_actions = reserved_actions - $3,
             consumed_actions = consumed_actions + $3,
             updated_at = now()
         WHERE organization_id = $1
           AND period_start = $2::date`,
        [input.organizationId, reservation.period_start, input.quantity]
      );

      const updated = await this.findReservationForUpdate(
        client,
        input.organizationId,
        input.reservationId
      );

      return {
        reservation: this.mapReservation(updated!),
        consumption: this.mapConsumption(consumptionResult.rows[0]!)
      };
    });
  }

  async release(input: {
    organizationId: string;
    reservationId: string;
  }): Promise<AutomationQuotaReservation> {
    return this.database.withTransaction(async (client) => {
      await this.commercialPolicy.lockOrganizationForMutation(
        client,
        input.organizationId
      );

      const reservation = await this.findReservationForUpdate(
        client,
        input.organizationId,
        input.reservationId
      );
      if (!reservation) {
        throw new AutomationQuotaReservationNotFoundError();
      }

      if (reservation.status !== "OPEN") {
        return this.mapReservation(reservation);
      }

      const remaining =
        reservation.requested_actions -
        reservation.consumed_actions -
        reservation.released_actions;

      await client.query(
        `UPDATE automation_quota_reservations
         SET released_actions = released_actions + $3,
             status = 'RELEASED',
             updated_at = now()
         WHERE organization_id = $1
           AND id = $2`,
        [input.organizationId, input.reservationId, remaining]
      );

      if (remaining > 0) {
        await client.query(
          `UPDATE automation_quota_periods
           SET reserved_actions = reserved_actions - $3,
               updated_at = now()
           WHERE organization_id = $1
             AND period_start = $2::date`,
          [input.organizationId, reservation.period_start, remaining]
        );
      }

      const updated = await this.findReservationForUpdate(
        client,
        input.organizationId,
        input.reservationId
      );
      return this.mapReservation(updated!);
    });
  }

  private async currentPeriod(
    client: PoolClient
  ): Promise<{ periodStart: string; periodEnd: string }> {
    const setting = await client.query<QueryResultRow & { timezone: string }>(
      `SELECT value #>> '{}' AS timezone
       FROM system_settings
       WHERE key = 'automation_quota_timezone'`
    );
    const timezone = setting.rows[0]?.timezone;
    if (!timezone) {
      throw new Error("automation_quota_timezone system setting is required.");
    }

    const result = await client.query<
      QueryResultRow & { period_start: string; period_end: string }
    >(
      `SELECT
         date_trunc('month', timezone($1, now()))::date::text AS period_start,
         (
           date_trunc('month', timezone($1, now())) + interval '1 month'
         )::date::text AS period_end`,
      [timezone]
    );

    return {
      periodStart: result.rows[0]!.period_start,
      periodEnd: result.rows[0]!.period_end
    };
  }

  private async findReservationByKey(
    client: PoolClient,
    organizationId: string,
    idempotencyKey: string
  ): Promise<ReservationRow | undefined> {
    const result = await client.query<ReservationRow>(
      `SELECT
         r.id::text,
         r.organization_id::text,
         r.period_start::text,
         p.period_end::text,
         r.idempotency_key,
         r.source_type,
         r.source_id,
         r.requested_actions,
         r.consumed_actions,
         r.released_actions,
         r.status,
         r.metadata,
         r.created_at,
         r.updated_at
       FROM automation_quota_reservations r
       JOIN automation_quota_periods p
         ON p.organization_id = r.organization_id
        AND p.period_start = r.period_start
       WHERE r.organization_id = $1
         AND r.idempotency_key = $2
       FOR UPDATE OF r`,
      [organizationId, idempotencyKey]
    );
    return result.rows[0];
  }

  private async findReservationForUpdate(
    client: PoolClient,
    organizationId: string,
    reservationId: string
  ): Promise<ReservationRow | undefined> {
    const result = await client.query<ReservationRow>(
      `SELECT
         r.id::text,
         r.organization_id::text,
         r.period_start::text,
         p.period_end::text,
         r.idempotency_key,
         r.source_type,
         r.source_id,
         r.requested_actions,
         r.consumed_actions,
         r.released_actions,
         r.status,
         r.metadata,
         r.created_at,
         r.updated_at
       FROM automation_quota_reservations r
       JOIN automation_quota_periods p
         ON p.organization_id = r.organization_id
        AND p.period_start = r.period_start
       WHERE r.organization_id = $1
         AND r.id = $2
       FOR UPDATE OF r`,
      [organizationId, reservationId]
    );
    return result.rows[0];
  }

  private mapReservation(row: ReservationRow): AutomationQuotaReservation {
    return {
      id: row.id,
      organizationId: row.organization_id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      idempotencyKey: row.idempotency_key,
      sourceType: row.source_type,
      sourceId: row.source_id,
      requestedActions: row.requested_actions,
      consumedActions: row.consumed_actions,
      releasedActions: row.released_actions,
      remainingActions:
        row.requested_actions - row.consumed_actions - row.released_actions,
      status: row.status,
      metadata: row.metadata,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  }

  private mapConsumption(row: ConsumptionRow): AutomationQuotaConsumption {
    return {
      id: row.id,
      organizationId: row.organization_id,
      reservationId: row.reservation_id,
      consumptionKey: row.consumption_key,
      quantity: row.quantity,
      createdAt: row.created_at.toISOString()
    };
  }

  private assertPositiveInteger(value: number, name: string): void {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive integer.`);
    }
  }
}
