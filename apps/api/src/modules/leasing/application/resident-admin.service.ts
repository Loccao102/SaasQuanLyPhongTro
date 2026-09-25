import {
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";

type ResidentRow = QueryResultRow & {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  identity_document_type: string | null;
  identity_document_number: string | null;
  date_of_birth: Date | string | null;
  notes: string | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type ResidentLeaseRow = QueryResultRow & {
  lease_id: string;
  lease_code: string;
  lease_status: string;
  start_date: Date | string;
  planned_end_date: Date | string | null;
  party_role: string;
  room_code: string;
  room_name: string;
  property_name: string;
};

export interface CreateResidentInput {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  identityDocumentType?: string | null;
  identityDocumentNumber?: string | null;
  dateOfBirth?: string | null;
  notes?: string | null;
}

export interface UpdateResidentInput {
  fullName?: string;
  phone?: string | null;
  email?: string | null;
  identityDocumentType?: string | null;
  identityDocumentNumber?: string | null;
  dateOfBirth?: string | null;
  notes?: string | null;
}

function mapResident(row: ResidentRow) {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone ?? null,
    email: row.email ?? null,
    identityDocumentType: row.identity_document_type ?? null,
    identityDocumentNumber: row.identity_document_number ?? null,
    dateOfBirth: row.date_of_birth
      ? String(row.date_of_birth).slice(0, 10)
      : null,
    notes: row.notes ?? null,
    isActive: row.is_active,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

@Injectable()
export class ResidentAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  // ── List / search ──────────────────────────────────────────────────────────

  async list(
    principal: TenantPrincipal,
    opts: {
      query?: string;
      isActive?: boolean;
      propertyId?: string;
      limit?: number;
      cursor?: string;
    }
  ) {
    const limit = Math.min(opts.limit ?? 50, 100);
    const params: unknown[] = [principal.organizationId];
    const conditions: string[] = ["res.organization_id = $1::uuid"];

    if (typeof opts.isActive === "boolean") {
      params.push(opts.isActive);
      conditions.push(`res.is_active = $${params.length}::boolean`);
    }

    if (opts.query && opts.query.trim().length >= 2) {
      const normalized = "%" + opts.query.trim() + "%";
      params.push(normalized);
      const idx = params.length;
      conditions.push(
        `(lower(res.full_name) LIKE lower($${idx}) OR COALESCE(res.phone,'') LIKE $${idx} OR lower(COALESCE(res.email,'')) LIKE lower($${idx}))`
      );
    }

    if (opts.cursor) {
      params.push(opts.cursor);
      conditions.push(`(res.full_name, res.id::text) > ($${params.length}, '00000000-0000-0000-0000-000000000000')`);
    }

    params.push(limit + 1);
    const limitIdx = params.length;

    const result = await this.db.query<ResidentRow>(
      `SELECT
         res.id::text,
         res.full_name,
         res.phone,
         res.email,
         res.identity_document_type,
         res.identity_document_number,
         res.date_of_birth,
         res.notes,
         res.is_active,
         res.created_at,
         res.updated_at
       FROM residents res
       WHERE ${conditions.join(" AND ")}
       ORDER BY res.full_name ASC, res.id ASC
       LIMIT $${limitIdx}`,
      params
    );

    const rows = result.rows;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();

    return {
      residents: rows.map(mapResident),
      hasMore,
      nextCursor: hasMore ? (rows[rows.length - 1]?.full_name ?? null) : null
    };
  }

  // ── Detail ─────────────────────────────────────────────────────────────────

  async detail(principal: TenantPrincipal, residentId: string) {
    const result = await this.db.query<ResidentRow>(
      `SELECT
         res.id::text,
         res.full_name,
         res.phone,
         res.email,
         res.identity_document_type,
         res.identity_document_number,
         res.date_of_birth,
         res.notes,
         res.is_active,
         res.created_at,
         res.updated_at
       FROM residents res
       WHERE res.organization_id = $1::uuid
         AND res.id = $2::uuid`,
      [principal.organizationId, residentId]
    );

    if (result.rowCount === 0) {
      throw new NotFoundException("Resident not found.");
    }

    const resident = result.rows[0]!;

    // Load lease history
    const leasesResult = await this.db.query<ResidentLeaseRow>(
      `SELECT
         l.id::text AS lease_id,
         l.lease_code,
         l.status AS lease_status,
         l.start_date,
         l.planned_end_date,
         lr.party_role,
         ro.room_code,
         ro.name AS room_name,
         p.name AS property_name
       FROM lease_residents lr
       JOIN leases l
         ON l.organization_id = lr.organization_id
        AND l.id = lr.lease_id
       JOIN rooms ro
         ON ro.organization_id = l.organization_id
        AND ro.id = l.room_id
       JOIN properties p
         ON p.organization_id = ro.organization_id
        AND p.id = ro.property_id
       WHERE lr.organization_id = $1::uuid
         AND lr.resident_id = $2::uuid
       ORDER BY l.start_date DESC, l.id DESC
       LIMIT 50`,
      [principal.organizationId, residentId]
    );

    return {
      resident: mapResident(resident),
      leases: leasesResult.rows.map((row) => ({
        leaseId: row.lease_id,
        leaseCode: row.lease_code,
        status: row.lease_status,
        startDate: String(row.start_date).slice(0, 10),
        plannedEndDate: row.planned_end_date
          ? String(row.planned_end_date).slice(0, 10)
          : null,
        partyRole: row.party_role,
        roomCode: row.room_code,
        roomName: row.room_name,
        propertyName: row.property_name
      }))
    };
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(principal: TenantPrincipal, input: CreateResidentInput) {
    const fullName = (input.fullName ?? "").trim();
    if (!fullName) {
      throw new ConflictException("fullName is required.");
    }

    const dateOfBirth =
      input.dateOfBirth && input.dateOfBirth.trim()
        ? input.dateOfBirth.trim()
        : null;

    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const result = await client.query<ResidentRow>(
        `INSERT INTO residents (
           organization_id,
           full_name,
           phone,
           email,
           identity_document_type,
           identity_document_number,
           date_of_birth,
           notes,
           is_active
         ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, true)
         RETURNING
           id::text,
           full_name,
           phone,
           email,
           identity_document_type,
           identity_document_number,
           date_of_birth,
           notes,
           is_active,
           created_at,
           updated_at`,
        [
          principal.organizationId,
          fullName,
          input.phone ?? null,
          input.email ?? null,
          input.identityDocumentType ?? null,
          input.identityDocumentNumber ?? null,
          dateOfBirth,
          input.notes ?? null
        ]
      );

      await client.query(
        `INSERT INTO audit_events (
           organization_id, actor_user_id, action, resource_type, resource_id, metadata
         ) VALUES ($1::uuid, $2::uuid, 'RESIDENT_CREATED', 'RESIDENT', $3::uuid, $4::jsonb)`,
        [
          principal.organizationId,
          principal.userId,
          result.rows[0]!.id,
          JSON.stringify({ fullName, phone: input.phone ?? null })
        ]
      );

      return { resident: mapResident(result.rows[0]!) };
    });
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  async update(
    principal: TenantPrincipal,
    residentId: string,
    input: UpdateResidentInput
  ) {
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM residents
       WHERE organization_id = $1::uuid AND id = $2::uuid`,
      [principal.organizationId, residentId]
    );
    if (existing.rowCount === 0) {
      throw new NotFoundException("Resident not found.");
    }

    const updates: string[] = [];
    const params: unknown[] = [principal.organizationId, residentId];

    if (input.fullName !== undefined) {
      const name = input.fullName.trim();
      if (!name) throw new ConflictException("fullName cannot be empty.");
      params.push(name);
      updates.push(`full_name = $${params.length}`);
    }
    if ("phone" in input) {
      params.push(input.phone ?? null);
      updates.push(`phone = $${params.length}`);
    }
    if ("email" in input) {
      params.push(input.email ?? null);
      updates.push(`email = $${params.length}`);
    }
    if ("identityDocumentType" in input) {
      params.push(input.identityDocumentType ?? null);
      updates.push(`identity_document_type = $${params.length}`);
    }
    if ("identityDocumentNumber" in input) {
      params.push(input.identityDocumentNumber ?? null);
      updates.push(`identity_document_number = $${params.length}`);
    }
    if ("dateOfBirth" in input) {
      params.push(
        input.dateOfBirth && input.dateOfBirth.trim()
          ? input.dateOfBirth.trim()
          : null
      );
      updates.push(`date_of_birth = $${params.length}`);
    }
    if ("notes" in input) {
      params.push(input.notes ?? null);
      updates.push(`notes = $${params.length}`);
    }

    if (updates.length === 0) {
      return this.detail(principal, residentId);
    }

    updates.push("updated_at = now()");

    const result = await this.db.query<ResidentRow>(
      `UPDATE residents
       SET ${updates.join(", ")}
       WHERE organization_id = $1::uuid AND id = $2::uuid
       RETURNING
         id::text,
         full_name,
         phone,
         email,
         identity_document_type,
         identity_document_number,
         date_of_birth,
         notes,
         is_active,
         created_at,
         updated_at`,
      params
    );

    await this.db.query(
      `INSERT INTO audit_events (
         organization_id, actor_user_id, action, resource_type, resource_id, metadata
       ) VALUES ($1::uuid, $2::uuid, 'RESIDENT_UPDATED', 'RESIDENT', $3::uuid, $4::jsonb)`,
      [
        principal.organizationId,
        principal.userId,
        residentId,
        JSON.stringify(input)
      ]
    );

    return { resident: mapResident(result.rows[0]!) };
  }

  // ── Deactivate ─────────────────────────────────────────────────────────────

  async deactivate(principal: TenantPrincipal, residentId: string) {
    // Check for active leases
    const activeLease = await this.db.query<{ id: string }>(
      `SELECT l.id
       FROM lease_residents lr
       JOIN leases l
         ON l.organization_id = lr.organization_id
        AND l.id = lr.lease_id
       WHERE lr.organization_id = $1::uuid
         AND lr.resident_id = $2::uuid
         AND l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED', 'DRAFT')
       LIMIT 1`,
      [principal.organizationId, residentId]
    );

    if ((activeLease.rowCount ?? 0) > 0) {
      throw new ConflictException(
        "Không thể vô hiệu hóa cư dân đang có hợp đồng hiệu lực hoặc bản nháp."
      );
    }

    const result = await this.db.query<ResidentRow>(
      `UPDATE residents
       SET is_active = false, updated_at = now()
       WHERE organization_id = $1::uuid AND id = $2::uuid
       RETURNING
         id::text,
         full_name,
         phone,
         email,
         identity_document_type,
         identity_document_number,
         date_of_birth,
         notes,
         is_active,
         created_at,
         updated_at`,
      [principal.organizationId, residentId]
    );

    if (result.rowCount === 0) {
      throw new NotFoundException("Resident not found.");
    }

    await this.db.query(
      `INSERT INTO audit_events (
         organization_id, actor_user_id, action, resource_type, resource_id, metadata
       ) VALUES ($1::uuid, $2::uuid, 'RESIDENT_DEACTIVATED', 'RESIDENT', $3::uuid, $4::jsonb)`,
      [
        principal.organizationId,
        principal.userId,
        residentId,
        JSON.stringify({ fullName: result.rows[0]!.full_name })
      ]
    );

    return { resident: mapResident(result.rows[0]!) };
  }
}
