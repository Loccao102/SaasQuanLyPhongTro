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
  assertReceiptMatches,
  normalizeIdempotencyKey
} from "./idempotent-command.js";
import { PostgresLeaseRepository } from "../infrastructure/postgres-lease-repository.js";

export type LeasePartyRole = "CO_TENANT" | "OCCUPANT";
export type PreviousPrimaryDisposition =
  | "REMOVE"
  | "CO_TENANT"
  | "OCCUPANT";

type DraftRow = QueryResultRow & {
  lease_id: string;
  status: string;
  start_date: Date | string;
  version: number;
  property_id: string;
};

type ResidentRow = QueryResultRow & {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  is_active: boolean;
};

type PropertyRow = QueryResultRow & {
  id: string;
};

type GroupRow = QueryResultRow & {
  id: string;
};

export interface UpdateLeaseDraftInput {
  expectedVersion: number;
  leaseCode: string;
  startDate: string;
  plannedEndDate?: string | null;
  baseRentVnd: number;
  depositRequiredVnd: number;
  billingDay: number;
}

export interface AddLeaseDraftPartyInput {
  residentId: string;
  partyRole: LeasePartyRole;
  resident?: {
    fullName: string;
    phone?: string | null;
    email?: string | null;
  } | null;
}

export interface ReplaceLeaseDraftPrimaryTenantInput {
  expectedVersion: number;
  idempotencyKey: string;
  residentId: string;
  previousPrimaryDisposition: PreviousPrimaryDisposition;
  resident?: {
    fullName: string;
    phone?: string | null;
    email?: string | null;
  } | null;
}

@Injectable()
export class LeaseDraftManagementService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async searchResidents(
    principal: TenantPrincipal,
    propertyId: string,
    query: string
  ) {
    const normalized = query.trim();
    if (normalized.length < 2) {
      return { residents: [] };
    }

    const groups = await this.requirePropertyManage(
      this.db,
      principal,
      propertyId
    );
    const organizationScope = principal.membership.scopes.some(
      (scope) => scope.type === "ORGANIZATION"
    );

    const result = await this.db.query<ResidentRow>(
      `SELECT DISTINCT
         res.id::text,
         res.full_name,
         res.phone,
         res.email,
         res.is_active
       FROM residents res
       WHERE res.organization_id = $1::uuid
         AND res.is_active = true
         AND (
           lower(res.full_name) LIKE lower($2)
           OR COALESCE(res.phone, '') LIKE $2
           OR lower(COALESCE(res.email, '')) LIKE lower($2)
         )
         AND (
           $4::boolean = true
           OR EXISTS (
             SELECT 1
             FROM lease_residents lr
             JOIN leases l
               ON l.organization_id = lr.organization_id
              AND l.id = lr.lease_id
             JOIN rooms r
               ON r.organization_id = l.organization_id
              AND r.id = l.room_id
             WHERE lr.organization_id = res.organization_id
               AND lr.resident_id = res.id
               AND r.property_id = $3::uuid
           )
         )
       ORDER BY full_name, id
       LIMIT 20`,
      [
        principal.organizationId,
        "%" + normalized + "%",
        propertyId,
        organizationScope
      ]
    );

    return {
      propertyId,
      operationalGroupIds: groups,
      residents: result.rows.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        phone: row.phone,
        email: row.email
      }))
    };
  }

  async updateDraft(
    principal: TenantPrincipal,
    leaseId: string,
    input: UpdateLeaseDraftInput
  ) {
    const leaseCode = this.required(input.leaseCode, "leaseCode");
    const startDate = this.isoDate(input.startDate, "startDate");
    const plannedEndDate =
      input.plannedEndDate === undefined ||
      input.plannedEndDate === null ||
      input.plannedEndDate === ""
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
    if (
      !Number.isInteger(input.billingDay) ||
      input.billingDay < 1 ||
      input.billingDay > 31
    ) {
      throw new ConflictException("billingDay must be between 1 and 31.");
    }
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new ConflictException("expectedVersion must be a positive integer.");
    }

    return this.db.withTransaction(async (client) => {
      const context = await this.requireDraft(client, principal, leaseId);
      if (context.version !== input.expectedVersion) {
        throw new ConflictException(
          "Lease draft changed since it was loaded. Refresh and try again."
        );
      }

      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const codeConflict = await client.query(
        `SELECT id
         FROM leases
         WHERE organization_id = $1::uuid
           AND lease_code = $2
           AND id <> $3::uuid
         LIMIT 1`,
        [principal.organizationId, leaseCode, leaseId]
      );
      if ((codeConflict.rowCount ?? 0) > 0) {
        throw new ConflictException("Lease code already exists.");
      }

      const updated = await client.query<QueryResultRow & { version: number }>(
        `UPDATE leases
         SET lease_code = $3,
             start_date = $4,
             planned_end_date = $5,
             base_rent_vnd = $6,
             deposit_required_vnd = $7,
             billing_day = $8,
             version = version + 1,
             updated_by_user_id = $9,
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
           AND status = 'DRAFT'
           AND version = $10
         RETURNING version`,
        [
          principal.organizationId,
          leaseId,
          leaseCode,
          startDate,
          plannedEndDate,
          baseRentVnd,
          depositRequiredVnd,
          input.billingDay,
          principal.userId,
          input.expectedVersion
        ]
      );

      if (updated.rowCount !== 1) {
        throw new ConflictException(
          "Lease draft changed concurrently. Refresh and try again."
        );
      }

      await client.query(
        `UPDATE lease_residents
         SET joined_on = $3
         WHERE organization_id = $1::uuid
           AND lease_id = $2::uuid
           AND left_on IS NULL`,
        [principal.organizationId, leaseId, startDate]
      );

      await this.audit(client, principal, leaseId, "LEASE_DRAFT_UPDATED", {
        leaseCode,
        startDate,
        plannedEndDate,
        baseRentVnd,
        depositRequiredVnd,
        billingDay: input.billingDay,
        version: updated.rows[0]!.version
      });

      return { leaseId, status: "DRAFT" as const, version: updated.rows[0]!.version };
    });
  }

  async replacePrimaryTenant(
    principal: TenantPrincipal,
    leaseId: string,
    input: ReplaceLeaseDraftPrimaryTenantInput
  ) {
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1
    ) {
      throw new ConflictException(
        "expectedVersion must be a positive integer."
      );
    }
    if (
      input.previousPrimaryDisposition !== "REMOVE" &&
      input.previousPrimaryDisposition !== "CO_TENANT" &&
      input.previousPrimaryDisposition !== "OCCUPANT"
    ) {
      throw new ConflictException(
        "previousPrimaryDisposition must be REMOVE, CO_TENANT or OCCUPANT."
      );
    }

    const idempotencyKey = normalizeIdempotencyKey(
      input.idempotencyKey
    );

    return this.db.withTransaction(async (client) => {
      const context = await this.requireDraft(
        client,
        principal,
        leaseId
      );
      const repository = new PostgresLeaseRepository(client);
      const receipt = await repository.findCommandReceipt(
        principal.organizationId,
        idempotencyKey
      );

      if (receipt) {
        assertReceiptMatches(receipt, {
          commandType: "LEASE_PRIMARY_TENANT_REPLACE",
          leaseId
        });
        return receipt.response as {
          leaseId: string;
          previousPrimaryResidentId: string;
          primaryResidentId: string;
          previousPrimaryDisposition: PreviousPrimaryDisposition;
          version: number;
        };
      }

      if (context.version !== input.expectedVersion) {
        throw new ConflictException(
          "Lease draft changed since it was loaded. Refresh and try again."
        );
      }

      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const currentPrimary = await client.query<
        QueryResultRow & {
          resident_id: string;
        }
      >(
        `SELECT resident_id::text
         FROM lease_residents
         WHERE organization_id = $1::uuid
           AND lease_id = $2::uuid
           AND party_role = 'PRIMARY_TENANT'
           AND left_on IS NULL
         LIMIT 1`,
        [principal.organizationId, leaseId]
      );
      const previousPrimaryResidentId =
        currentPrimary.rows[0]?.resident_id;
      if (!previousPrimaryResidentId) {
        throw new ConflictException(
          "Lease draft does not have a current primary tenant."
        );
      }
      if (previousPrimaryResidentId === input.residentId) {
        throw new ConflictException(
          "Selected resident is already the primary tenant."
        );
      }

      const existingResident = await client.query<ResidentRow>(
        `SELECT id::text, full_name, phone, email, is_active
         FROM residents
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
         LIMIT 1`,
        [principal.organizationId, input.residentId]
      );

      let resident = existingResident.rows[0];
      if (!resident) {
        if (!input.resident) {
          throw new NotFoundException(
            "Resident was not found and resident profile was not supplied."
          );
        }
        const fullName = this.required(
          input.resident.fullName,
          "resident.fullName"
        );
        const phone = this.optionalText(input.resident.phone);
        const email = this.optionalText(input.resident.email);
        const inserted = await client.query<ResidentRow>(
          `INSERT INTO residents (
             id, organization_id, full_name, phone, email
           )
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id::text, full_name, phone, email, is_active`,
          [
            input.residentId,
            principal.organizationId,
            fullName,
            phone,
            email
          ]
        );
        resident = inserted.rows[0]!;
      } else {
        if (!resident.is_active) {
          throw new ConflictException("Resident is inactive.");
        }
        await this.assertExistingResidentVisible(
          client,
          principal,
          context.property_id,
          resident.id
        );
      }

      const targetParty = await client.query<
        QueryResultRow & { party_role: string }
      >(
        `SELECT party_role
         FROM lease_residents
         WHERE organization_id = $1::uuid
           AND lease_id = $2::uuid
           AND resident_id = $3::uuid
           AND left_on IS NULL
         LIMIT 1`,
        [principal.organizationId, leaseId, resident.id]
      );

      if (input.previousPrimaryDisposition === "REMOVE") {
        await client.query(
          `DELETE FROM lease_residents
           WHERE organization_id = $1::uuid
             AND lease_id = $2::uuid
             AND resident_id = $3::uuid
             AND party_role = 'PRIMARY_TENANT'
             AND left_on IS NULL`,
          [
            principal.organizationId,
            leaseId,
            previousPrimaryResidentId
          ]
        );
      } else {
        await client.query(
          `UPDATE lease_residents
           SET party_role = $4
           WHERE organization_id = $1::uuid
             AND lease_id = $2::uuid
             AND resident_id = $3::uuid
             AND party_role = 'PRIMARY_TENANT'
             AND left_on IS NULL`,
          [
            principal.organizationId,
            leaseId,
            previousPrimaryResidentId,
            input.previousPrimaryDisposition
          ]
        );
      }

      if (targetParty.rows[0]) {
        await client.query(
          `UPDATE lease_residents
           SET party_role = 'PRIMARY_TENANT',
               joined_on = $4,
               left_on = NULL
           WHERE organization_id = $1::uuid
             AND lease_id = $2::uuid
             AND resident_id = $3::uuid`,
          [
            principal.organizationId,
            leaseId,
            resident.id,
            this.dateOnly(context.start_date)
          ]
        );
      } else {
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
            leaseId,
            resident.id,
            this.dateOnly(context.start_date)
          ]
        );
      }

      const versionResult = await client.query<
        QueryResultRow & { version: number }
      >(
        `UPDATE leases
         SET version = version + 1,
             updated_by_user_id = $3,
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
           AND status = 'DRAFT'
           AND version = $4
         RETURNING version`,
        [
          principal.organizationId,
          leaseId,
          principal.userId,
          input.expectedVersion
        ]
      );

      if (versionResult.rowCount !== 1) {
        throw new ConflictException(
          "Lease draft changed concurrently. Refresh and try again."
        );
      }

      const response = {
        leaseId,
        previousPrimaryResidentId,
        primaryResidentId: resident.id,
        previousPrimaryDisposition:
          input.previousPrimaryDisposition,
        version: versionResult.rows[0]!.version
      };

      await this.audit(
        client,
        principal,
        leaseId,
        "LEASE_PRIMARY_TENANT_REPLACED",
        {
          previousPrimaryResidentId,
          primaryResidentId: resident.id,
          previousPrimaryDisposition:
            input.previousPrimaryDisposition,
          promotedExistingParty: Boolean(targetParty.rows[0]),
          version: response.version
        }
      );

      await repository.saveCommandReceipt({
        organizationId: principal.organizationId,
        idempotencyKey,
        commandType: "LEASE_PRIMARY_TENANT_REPLACE",
        leaseId,
        response
      });

      return response;
    });
  }

  async addParty(
    principal: TenantPrincipal,
    leaseId: string,
    input: AddLeaseDraftPartyInput
  ) {
    return this.db.withTransaction(async (client) => {
      const context = await this.requireDraft(client, principal, leaseId);
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const existing = await client.query<ResidentRow>(
        `SELECT id::text, full_name, phone, email, is_active
         FROM residents
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
         LIMIT 1`,
        [principal.organizationId, input.residentId]
      );

      let resident = existing.rows[0];
      if (!resident) {
        if (!input.resident) {
          throw new NotFoundException(
            "Resident was not found and resident profile was not supplied."
          );
        }
        const fullName = this.required(input.resident.fullName, "resident.fullName");
        const phone = this.optionalText(input.resident.phone);
        const email = this.optionalText(input.resident.email);
        const inserted = await client.query<ResidentRow>(
          `INSERT INTO residents (
             id, organization_id, full_name, phone, email
           )
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id::text, full_name, phone, email, is_active`,
          [
            input.residentId,
            principal.organizationId,
            fullName,
            phone,
            email
          ]
        );
        resident = inserted.rows[0]!;
      } else {
        if (!resident.is_active) {
          throw new ConflictException("Resident is inactive.");
        }
        await this.assertExistingResidentVisible(
          client,
          principal,
          context.property_id,
          resident.id
        );
      }

      const partyConflict = await client.query(
        `SELECT 1
         FROM lease_residents
         WHERE organization_id = $1::uuid
           AND lease_id = $2::uuid
           AND resident_id = $3::uuid
         LIMIT 1`,
        [principal.organizationId, leaseId, resident.id]
      );
      if ((partyConflict.rowCount ?? 0) > 0) {
        throw new ConflictException("Resident is already a party on this lease.");
      }

      await client.query(
        `INSERT INTO lease_residents (
           organization_id, lease_id, resident_id, party_role, joined_on
         )
         VALUES ($1, $2, $3, $4, $5)`,
        [
          principal.organizationId,
          leaseId,
          resident.id,
          input.partyRole,
          this.dateOnly(context.start_date)
        ]
      );

      const versionResult = await client.query<QueryResultRow & { version: number }>(
        `UPDATE leases
         SET version = version + 1,
             updated_by_user_id = $3,
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
           AND status = 'DRAFT'
         RETURNING version`,
        [principal.organizationId, leaseId, principal.userId]
      );

      await this.audit(client, principal, leaseId, "LEASE_PARTY_ADDED", {
        residentId: resident.id,
        partyRole: input.partyRole,
        version: versionResult.rows[0]?.version
      });

      return {
        residentId: resident.id,
        fullName: resident.full_name,
        phone: resident.phone,
        email: resident.email,
        role: input.partyRole,
        version: versionResult.rows[0]!.version
      };
    });
  }

  async removeParty(
    principal: TenantPrincipal,
    leaseId: string,
    residentId: string
  ) {
    return this.db.withTransaction(async (client) => {
      await this.requireDraft(client, principal, leaseId);
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const party = await client.query<QueryResultRow & { party_role: string }>(
        `SELECT party_role
         FROM lease_residents
         WHERE organization_id = $1::uuid
           AND lease_id = $2::uuid
           AND resident_id = $3::uuid
         LIMIT 1`,
        [principal.organizationId, leaseId, residentId]
      );
      const row = party.rows[0];
      if (!row) {
        throw new NotFoundException("Lease party was not found.");
      }
      if (row.party_role === "PRIMARY_TENANT") {
        throw new ConflictException(
          "Primary tenant cannot be removed from a draft. Replace it through a dedicated primary-tenant workflow."
        );
      }

      await client.query(
        `DELETE FROM lease_residents
         WHERE organization_id = $1::uuid
           AND lease_id = $2::uuid
           AND resident_id = $3::uuid`,
        [principal.organizationId, leaseId, residentId]
      );

      const versionResult = await client.query<QueryResultRow & { version: number }>(
        `UPDATE leases
         SET version = version + 1,
             updated_by_user_id = $3,
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND id = $2::uuid
           AND status = 'DRAFT'
         RETURNING version`,
        [principal.organizationId, leaseId, principal.userId]
      );

      await this.audit(client, principal, leaseId, "LEASE_PARTY_REMOVED", {
        residentId,
        partyRole: row.party_role,
        version: versionResult.rows[0]?.version
      });

      return {
        residentId,
        removed: true,
        version: versionResult.rows[0]!.version
      };
    });
  }

  private async requireDraft(
    client: PoolClient,
    principal: TenantPrincipal,
    leaseId: string
  ): Promise<DraftRow & { operational_group_ids: string[] }> {
    const result = await client.query<DraftRow>(
      `SELECT
         l.id::text AS lease_id,
         l.status,
         l.start_date,
         l.version,
         r.property_id::text
       FROM leases l
       JOIN rooms r
         ON r.organization_id = l.organization_id
        AND r.id = l.room_id
       WHERE l.organization_id = $1::uuid
         AND l.id = $2::uuid
       FOR UPDATE OF l`,
      [principal.organizationId, leaseId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Lease was not found.");
    }
    if (row.status !== "DRAFT") {
      throw new ConflictException("Only DRAFT leases can be edited.");
    }

    const groupResult = await client.query<GroupRow>(
      `SELECT operational_group_id::text AS id
       FROM property_operational_groups
       WHERE organization_id = $1::uuid
         AND property_id = $2::uuid
       ORDER BY operational_group_id`,
      [principal.organizationId, row.property_id]
    );
    const operationalGroupIds = groupResult.rows.map((item) => item.id);

    if (
      !this.accessControl.can(principal.membership, "lease.manage", {
        organizationId: principal.organizationId,
        propertyId: row.property_id,
        operationalGroupIds
      })
    ) {
      throw new ForbiddenException("Lease manage permission denied.");
    }

    return { ...row, operational_group_ids: operationalGroupIds };
  }

  private async requirePropertyManage(
    db: Pick<DatabaseService, "query">,
    principal: TenantPrincipal,
    propertyId: string
  ): Promise<string[]> {
    const property = await db.query<PropertyRow>(
      `SELECT id::text
       FROM properties
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
         AND is_active = true
       LIMIT 1`,
      [principal.organizationId, propertyId]
    );
    if (!property.rows[0]) {
      throw new NotFoundException("Property was not found.");
    }

    const groupResult = await db.query<GroupRow>(
      `SELECT operational_group_id::text AS id
       FROM property_operational_groups
       WHERE organization_id = $1::uuid
         AND property_id = $2::uuid
       ORDER BY operational_group_id`,
      [principal.organizationId, propertyId]
    );
    const operationalGroupIds = groupResult.rows.map((item) => item.id);

    if (
      !this.accessControl.can(principal.membership, "lease.manage", {
        organizationId: principal.organizationId,
        propertyId,
        operationalGroupIds
      })
    ) {
      throw new ForbiddenException("Lease manage permission denied.");
    }
    return operationalGroupIds;
  }

  private async assertExistingResidentVisible(
    client: PoolClient,
    principal: TenantPrincipal,
    propertyId: string,
    residentId: string
  ): Promise<void> {
    if (
      principal.membership.scopes.some((scope) => scope.type === "ORGANIZATION")
    ) {
      return;
    }
    const history = await client.query(
      `SELECT 1
       FROM lease_residents lr
       JOIN leases l
         ON l.organization_id = lr.organization_id
        AND l.id = lr.lease_id
       JOIN rooms r
         ON r.organization_id = l.organization_id
        AND r.id = l.room_id
       WHERE lr.organization_id = $1::uuid
         AND lr.resident_id = $2::uuid
         AND r.property_id = $3::uuid
       LIMIT 1`,
      [principal.organizationId, residentId, propertyId]
    );
    if ((history.rowCount ?? 0) === 0) {
      throw new ForbiddenException(
        "Resident is outside the current property scope."
      );
    }
  }

  private async audit(
    client: PoolClient,
    principal: TenantPrincipal,
    leaseId: string,
    action: string,
    metadata: Readonly<Record<string, unknown>>
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_events (
         organization_id, actor_user_id, action, resource_type, resource_id, metadata
       )
       VALUES ($1, $2, $3, 'LEASE', $4, $5::jsonb)`,
      [
        principal.organizationId,
        principal.userId,
        action,
        leaseId,
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
    return normalized ? normalized : null;
  }

  private money(value: number, field: string): number {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ConflictException(field + " must be a non-negative integer VND amount.");
    }
    return value;
  }

  private isoDate(value: string, field: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new ConflictException(field + " must use YYYY-MM-DD.");
    }
    const date = new Date(value + "T00:00:00.000Z");
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new ConflictException(field + " is not a valid calendar date.");
    }
    return value;
  }

  private dateOnly(value: Date | string): string {
    return value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value.slice(0, 10);
  }
}
