import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";

export type ReservationStatus =
  | "ACTIVE"
  | "CONVERTED_TO_LEASE"
  | "CANCELLED_REFUNDED"
  | "CANCELLED_FORFEITED"
  | "EXPIRED";

export interface CreateReservationInput {
  propertyId: string;
  roomId: string;
  prospectiveTenantName: string;
  prospectiveTenantPhone: string;
  prospectiveTenantIdNumber?: string | null;
  depositAmountVnd: number;
  reservedFrom?: string;
  reservedUntil: string;
  expectedMoveInDate?: string | null;
  expectedMonthlyRentVnd?: number | null;
  notes?: string | null;
}

export interface ReservationRow {
  id: string;
  property_id: string;
  property_name: string;
  room_id: string;
  room_code: string;
  prospective_tenant_name: string;
  prospective_tenant_phone: string;
  prospective_tenant_id_number: string | null;
  deposit_amount_vnd: string;
  reserved_from: string;
  reserved_until: string;
  expected_move_in_date: string | null;
  expected_monthly_rent_vnd: string | null;
  status: ReservationStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class RoomReservationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService
  ) {}

  async list(
    principal: TenantPrincipal,
    filter?: { propertyId?: string; roomId?: string; status?: string }
  ) {
    const conditions = ["r.organization_id = $1::uuid"];
    const values: unknown[] = [principal.organizationId];

    if (filter?.propertyId) {
      values.push(filter.propertyId);
      conditions.push(`r.property_id = $${values.length}::uuid`);
    }

    if (filter?.roomId) {
      values.push(filter.roomId);
      conditions.push(`r.room_id = $${values.length}::uuid`);
    }

    if (filter?.status && filter.status !== "ALL") {
      values.push(filter.status);
      conditions.push(`r.status = $${values.length}`);
    }

    const result = await this.db.query<ReservationRow>(
      `SELECT
         r.id::text,
         r.property_id::text,
         p.name AS property_name,
         r.room_id::text,
         rm.room_code,
         r.prospective_tenant_name,
         r.prospective_tenant_phone,
         r.prospective_tenant_id_number,
         r.deposit_amount_vnd::text,
         r.reserved_from::text,
         r.reserved_until::text,
         r.expected_move_in_date::text,
         r.expected_monthly_rent_vnd::text,
         r.status,
         r.notes,
         r.created_at::text,
         r.updated_at::text
       FROM room_reservations r
       JOIN properties p
         ON p.organization_id = r.organization_id
        AND p.id = r.property_id
       JOIN rooms rm
         ON rm.organization_id = r.organization_id
        AND rm.id = r.room_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY r.created_at DESC`,
      values
    );

    return {
      reservations: result.rows.map((row) => ({
        id: row.id,
        propertyId: row.property_id,
        propertyName: row.property_name,
        roomId: row.room_id,
        roomCode: row.room_code,
        prospectiveTenantName: row.prospective_tenant_name,
        prospectiveTenantPhone: row.prospective_tenant_phone,
        prospectiveTenantIdNumber: row.prospective_tenant_id_number,
        depositAmountVnd: Number(row.deposit_amount_vnd),
        reservedFrom: row.reserved_from,
        reservedUntil: row.reserved_until,
        expectedMoveInDate: row.expected_move_in_date,
        expectedMonthlyRentVnd: row.expected_monthly_rent_vnd
          ? Number(row.expected_monthly_rent_vnd)
          : null,
        status: row.status,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    };
  }

  async create(principal: TenantPrincipal, input: CreateReservationInput) {
    if (!Number.isSafeInteger(input.depositAmountVnd) || input.depositAmountVnd <= 0) {
      throw new BadRequestException("depositAmountVnd must be a positive integer.");
    }

    const reservedFrom = input.reservedFrom?.trim() || new Date().toISOString().slice(0, 10);
    const reservedUntil = input.reservedUntil.trim();
    if (reservedUntil < reservedFrom) {
      throw new BadRequestException("reservedUntil must be on or after reservedFrom.");
    }

    return this.db.withTransaction(async (client) => {
      // 1. Verify room exists and belongs to organization
      const roomCheck = await client.query(
        `SELECT id, property_id FROM rooms
         WHERE organization_id = $1::uuid AND id = $2::uuid AND property_id = $3::uuid
         LIMIT 1`,
        [principal.organizationId, input.roomId, input.propertyId]
      );
      if (!roomCheck.rows[0]) {
        throw new NotFoundException("Phòng không tồn tại trong cơ sở đã chọn.");
      }

      // 2. Verify room does not already have an active reservation
      const activeRes = await client.query(
        `SELECT id FROM room_reservations
         WHERE organization_id = $1::uuid
           AND room_id = $2::uuid
           AND status = 'ACTIVE'
           AND reserved_until >= CURRENT_DATE
         LIMIT 1`,
        [principal.organizationId, input.roomId]
      );
      if ((activeRes.rowCount ?? 0) > 0) {
        throw new ConflictException("Phòng này hiện đã có người đặt cọc giữ chỗ.");
      }

      // 3. Verify room does not have an active lease
      const activeLease = await client.query(
        `SELECT id FROM leases
         WHERE organization_id = $1::uuid
           AND room_id = $2::uuid
           AND status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
         LIMIT 1`,
        [principal.organizationId, input.roomId]
      );
      if ((activeLease.rowCount ?? 0) > 0) {
        throw new ConflictException("Phòng này đang có hợp đồng thuê hoạt động.");
      }

      // 4. Insert reservation
      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO room_reservations (
           organization_id,
           property_id,
           room_id,
           prospective_tenant_name,
           prospective_tenant_phone,
           prospective_tenant_id_number,
           deposit_amount_vnd,
           reserved_from,
           reserved_until,
           expected_move_in_date,
           expected_monthly_rent_vnd,
           status,
           notes,
           created_by_user_id
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::date, $9::date, $10, $11, 'ACTIVE', $12, $13::uuid)
         RETURNING id::text`,
        [
          principal.organizationId,
          input.propertyId,
          input.roomId,
          input.prospectiveTenantName.trim(),
          input.prospectiveTenantPhone.trim(),
          input.prospectiveTenantIdNumber?.trim() || null,
          input.depositAmountVnd,
          reservedFrom,
          reservedUntil,
          input.expectedMoveInDate ? input.expectedMoveInDate.trim() : null,
          input.expectedMonthlyRentVnd ?? null,
          input.notes?.trim() || null,
          principal.userId
        ]
      );

      const reservationId = insertResult.rows[0]?.id;
      if (!reservationId) {
        throw new Error("Không thể tạo bản ghi đặt cọc giữ chỗ.");
      }

      // 5. Emit audit event
      await client.query(
        `INSERT INTO audit_events (
           organization_id, actor_user_id, action, resource_type, resource_id, metadata
         )
         VALUES ($1::uuid, $2::uuid, 'ROOM_RESERVATION_CREATED', 'ROOM_RESERVATION', $3::text, $4::jsonb)`,
        [
          principal.organizationId,
          principal.userId,
          reservationId,
          JSON.stringify({
            propertyId: input.propertyId,
            roomId: input.roomId,
            tenantName: input.prospectiveTenantName,
            depositAmountVnd: input.depositAmountVnd,
            reservedUntil
          })
        ]
      );

      return {
        id: reservationId,
        propertyId: input.propertyId,
        roomId: input.roomId,
        status: "ACTIVE" as const,
        depositAmountVnd: input.depositAmountVnd
      };
    });
  }

  async cancel(
    principal: TenantPrincipal,
    reservationId: string,
    input: { action: "REFUND" | "FORFEIT"; reason?: string }
  ) {
    const nextStatus: ReservationStatus =
      input.action === "REFUND" ? "CANCELLED_REFUNDED" : "CANCELLED_FORFEITED";

    return this.db.withTransaction(async (client) => {
      const existing = await client.query<{
        id: string;
        status: string;
        deposit_amount_vnd: string;
      }>(
        `SELECT id, status, deposit_amount_vnd::text FROM room_reservations
         WHERE organization_id = $1::uuid AND id = $2::uuid
         FOR UPDATE`,
        [principal.organizationId, reservationId]
      );

      const row = existing.rows[0];
      if (!row) {
        throw new NotFoundException("Không tìm thấy thông tin đặt cọc giữ chỗ.");
      }

      if (row.status !== "ACTIVE") {
        throw new ConflictException(
          `Chỉ có thể hủy phiếu đặt cọc đang ở trạng thái ACTIVE (hiện tại: ${row.status}).`
        );
      }

      await client.query(
        `UPDATE room_reservations
         SET status = $1, notes = COALESCE(notes, '') || $2, updated_at = now()
         WHERE organization_id = $3::uuid AND id = $4::uuid`,
        [
          nextStatus,
          input.reason ? ` [Lý do hủy: ${input.reason}]` : "",
          principal.organizationId,
          reservationId
        ]
      );

      await client.query(
        `INSERT INTO audit_events (
           organization_id, actor_user_id, action, resource_type, resource_id, metadata
         )
         VALUES ($1::uuid, $2::uuid, 'ROOM_RESERVATION_CANCELLED', 'ROOM_RESERVATION', $3::text, $4::jsonb)`,
        [
          principal.organizationId,
          principal.userId,
          reservationId,
          JSON.stringify({
            action: input.action,
            reason: input.reason ?? null,
            status: nextStatus
          })
        ]
      );

      return {
        id: reservationId,
        status: nextStatus,
        action: input.action
      };
    });
  }

  async convertToLease(principal: TenantPrincipal, reservationId: string) {
    return this.db.withTransaction(async (client) => {
      const existing = await client.query<{
        id: string;
        room_id: string;
        property_id: string;
        prospective_tenant_name: string;
        prospective_tenant_phone: string;
        deposit_amount_vnd: string;
        status: string;
      }>(
        `SELECT id, room_id, property_id, prospective_tenant_name, prospective_tenant_phone, deposit_amount_vnd::text, status
         FROM room_reservations
         WHERE organization_id = $1::uuid AND id = $2::uuid
         FOR UPDATE`,
        [principal.organizationId, reservationId]
      );

      const row = existing.rows[0];
      if (!row) {
        throw new NotFoundException("Không tìm thấy phiếu đặt cọc.");
      }

      if (row.status !== "ACTIVE") {
        throw new ConflictException(
          `Chỉ có thể chuyển đổi phiếu đặt cọc đang ACTIVE (hiện tại: ${row.status}).`
        );
      }

      await client.query(
        `UPDATE room_reservations
         SET status = 'CONVERTED_TO_LEASE', updated_at = now()
         WHERE organization_id = $1::uuid AND id = $2::uuid`,
        [principal.organizationId, reservationId]
      );

      await client.query(
        `INSERT INTO audit_events (
           organization_id, actor_user_id, action, resource_type, resource_id, metadata
         )
         VALUES ($1::uuid, $2::uuid, 'ROOM_RESERVATION_CONVERTED', 'ROOM_RESERVATION', $3::text, $4::jsonb)`,
        [
          principal.organizationId,
          principal.userId,
          reservationId,
          JSON.stringify({
            status: "CONVERTED_TO_LEASE",
            convertedDepositAmountVnd: Number(row.deposit_amount_vnd)
          })
        ]
      );

      return {
        id: reservationId,
        status: "CONVERTED_TO_LEASE" as const,
        roomId: row.room_id,
        propertyId: row.property_id,
        tenantName: row.prospective_tenant_name,
        tenantPhone: row.prospective_tenant_phone,
        depositVnd: Number(row.deposit_amount_vnd)
      };
    });
  }
}
