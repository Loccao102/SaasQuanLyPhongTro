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
import { roleHasPermission } from "../../identity/domain/access-control.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";
import {
  assertReceiptMatches,
  normalizeIdempotencyKey
} from "./idempotent-command.js";
import { PostgresLeaseRepository } from "../infrastructure/postgres-lease-repository.js";
import { LeaseDepositService, type DepositSummaryDto } from "./lease-deposit.service.js";

type LeaseListRow = QueryResultRow & {
  id: string;
  lease_code: string;
  status: string;
  start_date: Date | string;
  planned_end_date: Date | string | null;
  base_rent_vnd: string;
  deposit_required_vnd: string;
  billing_day: number;
  room_id: string;
  room_code: string;
  room_name: string;
  property_id: string;
  property_code: string;
  property_name: string;
  operational_group_ids: string[];
  primary_resident_id: string | null;
  primary_resident_name: string | null;
  primary_resident_phone: string | null;
};

type LeaseDetailRow = LeaseListRow & {
  termination_effective_date: Date | string | null;
  termination_reason: string | null;
  version: number;
  created_at: Date | string;
};

type PartyRow = QueryResultRow & {
  resident_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  party_role: string;
  joined_on: Date | string;
  left_on: Date | string | null;
};

type TerminationRow = QueryResultRow & {
  id: string;
  status: string;
  effective_date: Date | string;
  reason: string;
  meter_readiness: string;
  financial_readiness: string;
  deposit_readiness: string;
  created_at: Date | string;
  completed_at: Date | string | null;
  cancelled_at: Date | string | null;
};

type AuditRow = QueryResultRow & {
  action: string;
  metadata: unknown;
  occurred_at: Date | string;
};

type RoomContextRow = QueryResultRow & {
  room_id: string;
  property_id: string;
  operational_group_ids: string[];
};

export interface CreateLeaseDraftInput {
  leaseId: string;
  residentId: string;
  idempotencyKey: string;
  roomId: string;
  leaseCode: string;
  startDate: string;
  plannedEndDate?: string | null;
  baseRentVnd: number;
  depositRequiredVnd: number;
  billingDay: number;
  primaryResident?: {
    fullName: string;
    phone?: string | null;
    email?: string | null;
  } | null;
}

@Injectable()
export class LeaseAdminService {
  private readonly depositService: LeaseDepositService;

  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService,
    depositService?: LeaseDepositService
  ) {
    this.depositService =
      depositService ??
      new LeaseDepositService(db, accessControl, commercialPolicy);
  }

  async list(principal: TenantPrincipal) {
    if (!roleHasPermission(principal.role, "lease.read")) {
      throw new ForbiddenException("Lease read permission denied.");
    }

    const result = await this.db.query<LeaseListRow>(
      `SELECT
         l.id::text,
         l.lease_code,
         l.status,
         l.start_date,
         l.planned_end_date,
         l.base_rent_vnd::text,
         l.deposit_required_vnd::text,
         l.billing_day,
         r.id::text AS room_id,
         r.code AS room_code,
         r.name AS room_name,
         p.id::text AS property_id,
         p.code AS property_code,
         p.name AS property_name,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids,
         primary_party.resident_id::text AS primary_resident_id,
         primary_party.full_name AS primary_resident_name,
         primary_party.phone AS primary_resident_phone
       FROM leases l
       JOIN rooms r
         ON r.organization_id = l.organization_id
        AND r.id = l.room_id
       JOIN properties p
         ON p.organization_id = r.organization_id
        AND p.id = r.property_id
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       LEFT JOIN LATERAL (
         SELECT lr.resident_id, res.full_name, res.phone
         FROM lease_residents lr
         JOIN residents res
           ON res.organization_id = lr.organization_id
          AND res.id = lr.resident_id
         WHERE lr.organization_id = l.organization_id
           AND lr.lease_id = l.id
           AND lr.party_role = 'PRIMARY_TENANT'
           AND lr.left_on IS NULL
         LIMIT 1
       ) primary_party ON true
       WHERE l.organization_id = $1::uuid
       GROUP BY
         l.id, l.lease_code, l.status, l.start_date, l.planned_end_date,
         l.base_rent_vnd, l.deposit_required_vnd, l.billing_day,
         r.id, r.code, r.name,
         p.id, p.code, p.name,
         primary_party.resident_id, primary_party.full_name, primary_party.phone
       ORDER BY
         CASE l.status
           WHEN 'TERMINATION_SCHEDULED' THEN 0
           WHEN 'ACTIVE' THEN 1
           WHEN 'DRAFT' THEN 2
           ELSE 3
         END,
         l.start_date DESC,
         l.id DESC`,
      [principal.organizationId]
    );

    const leases = result.rows
      .filter((row) =>
        this.accessControl.can(principal.membership, "lease.read", {
          organizationId: principal.organizationId,
          propertyId: row.property_id,
          operationalGroupIds: row.operational_group_ids
        })
      )
      .map((row) => this.mapLeaseSummary(row));

    return {
      organization: {
        id: principal.organizationId,
        name: principal.organizationName
      },
      summary: {
        active: leases.filter((item) => item.status === "ACTIVE").length,
        terminationScheduled: leases.filter(
          (item) => item.status === "TERMINATION_SCHEDULED"
        ).length,
        draft: leases.filter((item) => item.status === "DRAFT").length,
        terminated: leases.filter((item) => item.status === "TERMINATED").length
      },
      leases
    };
  }

  async detail(principal: TenantPrincipal, leaseId: string) {
    if (!roleHasPermission(principal.role, "lease.read")) {
      throw new ForbiddenException("Lease read permission denied.");
    }

    const result = await this.db.query<LeaseDetailRow>(
      `SELECT
         l.id::text,
         l.lease_code,
         l.status,
         l.start_date,
         l.planned_end_date,
         l.termination_effective_date,
         l.termination_reason,
         l.base_rent_vnd::text,
         l.deposit_required_vnd::text,
         l.billing_day,
         l.version,
         l.created_at,
         r.id::text AS room_id,
         r.code AS room_code,
         r.name AS room_name,
         p.id::text AS property_id,
         p.code AS property_code,
         p.name AS property_name,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids,
         primary_party.resident_id::text AS primary_resident_id,
         primary_party.full_name AS primary_resident_name,
         primary_party.phone AS primary_resident_phone
       FROM leases l
       JOIN rooms r
         ON r.organization_id = l.organization_id
        AND r.id = l.room_id
       JOIN properties p
         ON p.organization_id = r.organization_id
        AND p.id = r.property_id
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       LEFT JOIN LATERAL (
         SELECT lr.resident_id, res.full_name, res.phone
         FROM lease_residents lr
         JOIN residents res
           ON res.organization_id = lr.organization_id
          AND res.id = lr.resident_id
         WHERE lr.organization_id = l.organization_id
           AND lr.lease_id = l.id
           AND lr.party_role = 'PRIMARY_TENANT'
           AND lr.left_on IS NULL
         LIMIT 1
       ) primary_party ON true
       WHERE l.organization_id = $1::uuid
         AND l.id = $2::uuid
       GROUP BY
         l.id, l.lease_code, l.status, l.start_date, l.planned_end_date,
         l.termination_effective_date, l.termination_reason,
         l.base_rent_vnd, l.deposit_required_vnd, l.billing_day,
         l.version, l.created_at,
         r.id, r.code, r.name,
         p.id, p.code, p.name,
         primary_party.resident_id, primary_party.full_name, primary_party.phone
       LIMIT 1`,
      [principal.organizationId, leaseId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Lease was not found.");
    }

    const canRead = this.accessControl.can(principal.membership, "lease.read", {
      organizationId: principal.organizationId,
      propertyId: row.property_id,
      operationalGroupIds: row.operational_group_ids
    });
    if (!canRead) {
      throw new ForbiddenException("Lease scope denied.");
    }

    const [partyResult, terminationResult, auditResult, deposit] =
      await Promise.all([
        this.db.query<PartyRow>(
          `SELECT
             res.id::text AS resident_id,
             res.full_name,
             res.phone,
             res.email,
             lr.party_role,
             lr.joined_on,
             lr.left_on
           FROM lease_residents lr
           JOIN residents res
             ON res.organization_id = lr.organization_id
            AND res.id = lr.resident_id
           WHERE lr.organization_id = $1::uuid
             AND lr.lease_id = $2::uuid
           ORDER BY
             CASE lr.party_role WHEN 'PRIMARY_TENANT' THEN 0 WHEN 'CO_TENANT' THEN 1 ELSE 2 END,
             lr.joined_on,
             res.full_name`,
          [principal.organizationId, leaseId]
        ),
        this.db.query<TerminationRow>(
          `SELECT
             id::text,
             status,
             effective_date,
             reason,
             meter_readiness,
             financial_readiness,
             deposit_readiness,
             created_at,
             completed_at,
             cancelled_at
           FROM lease_terminations
           WHERE organization_id = $1::uuid
             AND lease_id = $2::uuid
           ORDER BY created_at DESC
           LIMIT 1`,
          [principal.organizationId, leaseId]
        ),
        this.db.query<AuditRow>(
          `SELECT action, metadata, occurred_at
           FROM audit_events
           WHERE organization_id = $1::uuid
             AND resource_type = 'LEASE'
             AND resource_id = $2::uuid
           ORDER BY occurred_at DESC, id DESC
           LIMIT 50`,
          [principal.organizationId, leaseId]
        ),
        this.depositService.getDepositSummary(
          this.db,
          principal.organizationId,
          leaseId,
          Number(row.deposit_required_vnd)
        )
      ]);

    return {
      organization: {
        id: principal.organizationId,
        name: principal.organizationName
      },
      lease: {
        ...this.mapLeaseSummary(row),
        terminationEffectiveDate: this.dateOnly(row.termination_effective_date),
        terminationReason: row.termination_reason,
        version: row.version,
        createdAt: this.isoTimestamp(row.created_at)
      },
      permissions: {
        manage: this.accessControl.can(principal.membership, "lease.manage", {
          organizationId: principal.organizationId,
          propertyId: row.property_id,
          operationalGroupIds: row.operational_group_ids
        }),
        terminate: this.accessControl.can(principal.membership, "lease.terminate", {
          organizationId: principal.organizationId,
          propertyId: row.property_id,
          operationalGroupIds: row.operational_group_ids
        })
      },
      parties: partyResult.rows.map((party) => ({
        residentId: party.resident_id,
        fullName: party.full_name,
        phone: party.phone,
        email: party.email,
        role: party.party_role,
        joinedOn: this.dateOnly(party.joined_on),
        leftOn: this.dateOnly(party.left_on)
      })),
      deposit,
      termination: terminationResult.rows[0]
        ? this.mapTermination(terminationResult.rows[0])
        : null,
      audit: auditResult.rows.map((item) => ({
        action: item.action,
        metadata: item.metadata,
        occurredAt: this.isoTimestamp(item.occurred_at)
      }))
    };
  }

  async createDraft(
    principal: TenantPrincipal,
    input: CreateLeaseDraftInput
  ) {
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const leaseCode = this.required(input.leaseCode, "leaseCode");
    const startDate = this.isoDate(input.startDate, "startDate");
    const plannedEndDate =
      input.plannedEndDate === undefined || input.plannedEndDate === null || input.plannedEndDate === ""
        ? null
        : this.isoDate(input.plannedEndDate, "plannedEndDate");
    if (plannedEndDate !== null && plannedEndDate < startDate) {
      throw new ConflictException(
        "plannedEndDate cannot be earlier than startDate."
      );
    }
    const baseRentVnd = this.money(input.baseRentVnd, "baseRentVnd");
    const depositRequiredVnd = this.money(
      input.depositRequiredVnd,
      "depositRequiredVnd"
    );
    if (!Number.isInteger(input.billingDay) || input.billingDay < 1 || input.billingDay > 31) {
      throw new ConflictException("billingDay must be between 1 and 31.");
    }
    return this.db.withTransaction(async (client) => {
      const room = await this.roomContext(
        client,
        principal.organizationId,
        input.roomId
      );
      if (!room) {
        throw new NotFoundException("Room was not found.");
      }
      if (
        !this.accessControl.can(principal.membership, "lease.manage", {
          organizationId: principal.organizationId,
          propertyId: room.property_id,
          operationalGroupIds: room.operational_group_ids
        })
      ) {
        throw new ForbiddenException("Lease manage permission denied.");
      }

      const repository = new PostgresLeaseRepository(client);
      const receipt = await repository.findCommandReceipt(
        principal.organizationId,
        idempotencyKey
      );
      if (receipt) {
        assertReceiptMatches(receipt, {
          commandType: "LEASE_DRAFT_CREATE",
          leaseId: input.leaseId
        });
        return receipt.response as {
          leaseId: string;
          residentId: string;
          status: "DRAFT";
        };
      }

      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const leaseIdConflict = await client.query(
        `SELECT id
         FROM leases
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
         LIMIT 1`,
        [principal.organizationId, input.leaseId]
      );
      if ((leaseIdConflict.rowCount ?? 0) > 0) {
        throw new ConflictException("Lease id already exists.");
      }

      const leaseCodeConflict = await client.query(
        `SELECT id
         FROM leases
         WHERE organization_id = $1::uuid
           AND lease_code = $2
         LIMIT 1`,
        [principal.organizationId, leaseCode]
      );
      if ((leaseCodeConflict.rowCount ?? 0) > 0) {
        throw new ConflictException("Lease code already exists.");
      }

      const residentResult = await client.query<QueryResultRow & {
        id: string;
        is_active: boolean;
      }>(
        `SELECT id::text, is_active
         FROM residents
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
         LIMIT 1`,
        [principal.organizationId, input.residentId]
      );
      const existingResident = residentResult.rows[0];
      let residentReused = false;

      if (existingResident) {
        if (!existingResident.is_active) {
          throw new ConflictException("Resident is inactive.");
        }
        if (
          !principal.membership.scopes.some(
            (scope) => scope.type === "ORGANIZATION"
          )
        ) {
          const residentHistory = await client.query(
            `SELECT 1
             FROM lease_residents lr
             JOIN leases history_lease
               ON history_lease.organization_id = lr.organization_id
              AND history_lease.id = lr.lease_id
             JOIN rooms history_room
               ON history_room.organization_id = history_lease.organization_id
              AND history_room.id = history_lease.room_id
             WHERE lr.organization_id = $1::uuid
               AND lr.resident_id = $2::uuid
               AND history_room.property_id = $3::uuid
             LIMIT 1`,
            [
              principal.organizationId,
              input.residentId,
              room.property_id
            ]
          );
          if ((residentHistory.rowCount ?? 0) === 0) {
            throw new ForbiddenException(
              "Resident is outside the current property scope."
            );
          }
        }
        residentReused = true;
      } else {
        if (!input.primaryResident) {
          throw new ConflictException(
            "primaryResident is required when creating a new resident."
          );
        }
        const fullName = this.required(
          input.primaryResident.fullName,
          "primaryResident.fullName"
        );
        const phone = this.optionalText(input.primaryResident.phone);
        const email = this.optionalText(input.primaryResident.email);

        await client.query(
          `INSERT INTO residents (
             id, organization_id, full_name, phone, email
           )
           VALUES ($1, $2, $3, $4, $5)`,
          [
            input.residentId,
            principal.organizationId,
            fullName,
            phone,
            email
          ]
        );
      }

      await client.query(
        `INSERT INTO leases (
           id,
           organization_id,
           room_id,
           lease_code,
           status,
           start_date,
           planned_end_date,
           base_rent_vnd,
           deposit_required_vnd,
           billing_day,
           created_by_user_id,
           updated_by_user_id
         )
         VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6, $7, $8, $9, $10, $10)`,
        [
          input.leaseId,
          principal.organizationId,
          input.roomId,
          leaseCode,
          startDate,
          plannedEndDate,
          baseRentVnd,
          depositRequiredVnd,
          input.billingDay,
          principal.userId
        ]
      );

      await client.query(
        `INSERT INTO lease_residents (
           organization_id,
           lease_id,
           resident_id,
           party_role,
           joined_on
         )
         VALUES ($1, $2, $3, 'PRIMARY_TENANT', $4)`,
        [
          principal.organizationId,
          input.leaseId,
          input.residentId,
          startDate
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
         VALUES ($1, $2, 'LEASE_DRAFT_CREATED', 'LEASE', $3, $4::jsonb)`,
        [
          principal.organizationId,
          principal.userId,
          input.leaseId,
          JSON.stringify({
            roomId: input.roomId,
            residentId: input.residentId,
            residentReused,
            leaseCode,
            startDate,
            plannedEndDate,
            baseRentVnd,
            depositRequiredVnd,
            billingDay: input.billingDay
          })
        ]
      );

      const response = {
        leaseId: input.leaseId,
        residentId: input.residentId,
        status: "DRAFT" as const
      };

      await repository.saveCommandReceipt({
        organizationId: principal.organizationId,
        idempotencyKey,
        commandType: "LEASE_DRAFT_CREATE",
        leaseId: input.leaseId,
        response
      });

      return response;
    });
  }

  private async roomContext(
    client: PoolClient,
    organizationId: string,
    roomId: string
  ): Promise<RoomContextRow | null> {
    const result = await client.query<RoomContextRow>(
      `SELECT
         r.id::text AS room_id,
         r.property_id::text,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids
       FROM rooms r
       JOIN properties p
         ON p.organization_id = r.organization_id
        AND p.id = r.property_id
        AND p.is_active = true
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = r.organization_id
        AND pog.property_id = r.property_id
       WHERE r.organization_id = $1::uuid
         AND r.id = $2::uuid
         AND r.is_active = true
       GROUP BY r.id, r.property_id
       LIMIT 1`,
      [organizationId, roomId]
    );
    return result.rows[0] ?? null;
  }

  private mapLeaseSummary(row: LeaseListRow) {
    return {
      id: row.id,
      code: row.lease_code,
      status: row.status,
      startDate: this.dateOnly(row.start_date),
      plannedEndDate: this.dateOnly(row.planned_end_date),
      baseRentVnd: Number(row.base_rent_vnd),
      depositRequiredVnd: Number(row.deposit_required_vnd),
      billingDay: row.billing_day,
      room: {
        id: row.room_id,
        code: row.room_code,
        name: row.room_name
      },
      property: {
        id: row.property_id,
        code: row.property_code,
        name: row.property_name
      },
      primaryResident: row.primary_resident_id
        ? {
            id: row.primary_resident_id,
            fullName: row.primary_resident_name ?? "—",
            phone: row.primary_resident_phone
          }
        : null
    };
  }

  private mapTermination(row: TerminationRow) {
    return {
      id: row.id,
      status: row.status,
      effectiveDate: this.dateOnly(row.effective_date),
      reason: row.reason,
      readiness: {
        meter: row.meter_readiness,
        financial: row.financial_readiness,
        deposit: row.deposit_readiness
      },
      createdAt: this.isoTimestamp(row.created_at),
      completedAt: row.completed_at ? this.isoTimestamp(row.completed_at) : null,
      cancelledAt: row.cancelled_at ? this.isoTimestamp(row.cancelled_at) : null
    };
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
    return normalized ? normalized : null;
  }

  private money(value: number, field: string): number {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ConflictException(field + " must be a non-negative integer VND amount.");
    }
    return value;
  }

  private isoDate(value: string, field: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      throw new ConflictException(field + " must use YYYY-MM-DD.");
    }
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (
      date.getUTCFullYear() !== Number(match[1]) ||
      date.getUTCMonth() !== Number(match[2]) - 1 ||
      date.getUTCDate() !== Number(match[3])
    ) {
      throw new ConflictException(field + " is not a valid calendar date.");
    }
    return value;
  }

  private dateOnly(value: Date | string | null): string | null {
    if (!value) return null;
    return value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value.slice(0, 10);
  }

  private isoTimestamp(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
