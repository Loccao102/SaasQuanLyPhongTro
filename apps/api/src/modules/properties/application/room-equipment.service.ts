import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import { roleHasPermission } from "../../identity/domain/access-control.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";

export const equipmentConditionStatuses = [
  "EXCELLENT",
  "GOOD",
  "FAIR",
  "DAMAGED",
  "NEEDS_REPAIR"
] as const;

export type EquipmentConditionStatus = (typeof equipmentConditionStatuses)[number];

export interface RoomEquipment {
  id: string;
  organizationId: string;
  propertyId: string;
  roomId: string;
  name: string;
  brand: string | null;
  modelOrSerial: string | null;
  quantity: number;
  conditionStatus: EquipmentConditionStatus;
  compensationValueVnd: number;
  note: string | null;
  installedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoomEquipmentInput {
  name: string;
  brand?: string | null;
  modelOrSerial?: string | null;
  quantity?: number;
  conditionStatus?: EquipmentConditionStatus;
  compensationValueVnd?: number;
  note?: string | null;
  installedAt?: string | null;
}

export interface UpdateRoomEquipmentInput {
  name?: string;
  brand?: string | null;
  modelOrSerial?: string | null;
  quantity?: number;
  conditionStatus?: EquipmentConditionStatus;
  compensationValueVnd?: number;
  note?: string | null;
  installedAt?: string | null;
}

type EquipmentRow = QueryResultRow & {
  id: string;
  organization_id: string;
  property_id: string;
  room_id: string;
  name: string;
  brand: string | null;
  model_or_serial: string | null;
  quantity: number;
  condition_status: string;
  compensation_value_vnd: string;
  note: string | null;
  installed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

@Injectable()
export class RoomEquipmentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService
  ) {}

  async listByRoom(principal: TenantPrincipal, roomId: string): Promise<RoomEquipment[]> {
    const room = await this.requireRoom(principal, roomId, "property.read");

    const result = await this.db.query<EquipmentRow>(
      `SELECT
         id::text,
         organization_id::text,
         property_id::text,
         room_id::text,
         name,
         brand,
         model_or_serial,
         quantity,
         condition_status,
         compensation_value_vnd::text,
         note,
         installed_at,
         created_at,
         updated_at
       FROM room_equipment
       WHERE organization_id = $1::uuid
         AND room_id = $2::uuid
       ORDER BY created_at ASC`,
      [principal.organizationId, room.id]
    );

    return result.rows.map((row) => this.mapEquipment(row));
  }

  async create(
    principal: TenantPrincipal,
    roomId: string,
    input: CreateRoomEquipmentInput
  ): Promise<RoomEquipment> {
    const room = await this.requireRoom(principal, roomId, "property.manage");

    const name = input.name?.trim();
    if (!name || name.length === 0) {
      throw new BadRequestException("Tên trang thiết bị không được để trống.");
    }

    const quantity = Math.max(1, Math.floor(Number(input.quantity ?? 1)));
    const compensationValueVnd = Math.max(0, Math.floor(Number(input.compensationValueVnd ?? 0)));
    const conditionStatus = input.conditionStatus && equipmentConditionStatuses.includes(input.conditionStatus)
      ? input.conditionStatus
      : "GOOD";

    const result = await this.db.query<EquipmentRow>(
      `INSERT INTO room_equipment (
         organization_id,
         property_id,
         room_id,
         name,
         brand,
         model_or_serial,
         quantity,
         condition_status,
         compensation_value_vnd,
         note,
         installed_at
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::bigint, $10, $11)
       RETURNING
         id::text,
         organization_id::text,
         property_id::text,
         room_id::text,
         name,
         brand,
         model_or_serial,
         quantity,
         condition_status,
         compensation_value_vnd::text,
         note,
         installed_at,
         created_at,
         updated_at`,
      [
        principal.organizationId,
        room.property_id,
        room.id,
        name,
        input.brand?.trim() || null,
        input.modelOrSerial?.trim() || null,
        quantity,
        conditionStatus,
        compensationValueVnd,
        input.note?.trim() || null,
        input.installedAt ? new Date(input.installedAt).toISOString().slice(0, 10) : null
      ]
    );

    return this.mapEquipment(result.rows[0]!);
  }

  async update(
    principal: TenantPrincipal,
    roomId: string,
    equipmentId: string,
    input: UpdateRoomEquipmentInput
  ): Promise<RoomEquipment> {
    const room = await this.requireRoom(principal, roomId, "property.manage");

    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM room_equipment WHERE organization_id = $1::uuid AND room_id = $2::uuid AND id = $3::uuid`,
      [principal.organizationId, room.id, equipmentId]
    );
    if (!existing.rows[0]) {
      throw new NotFoundException("Thiết bị không tồn tại.");
    }

    const updates: string[] = ["updated_at = now()"];
    const values: unknown[] = [principal.organizationId, room.id, equipmentId];
    let idx = 4;

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException("Tên thiết bị không được để trống.");
      updates.push(`name = $${idx++}`);
      values.push(name);
    }

    if (input.brand !== undefined) {
      updates.push(`brand = $${idx++}`);
      values.push(input.brand?.trim() || null);
    }

    if (input.modelOrSerial !== undefined) {
      updates.push(`model_or_serial = $${idx++}`);
      values.push(input.modelOrSerial?.trim() || null);
    }

    if (input.quantity !== undefined) {
      updates.push(`quantity = $${idx++}`);
      values.push(Math.max(1, Math.floor(Number(input.quantity))));
    }

    if (input.conditionStatus !== undefined) {
      if (!equipmentConditionStatuses.includes(input.conditionStatus)) {
        throw new BadRequestException("Trạng thái thiết bị không hợp lệ.");
      }
      updates.push(`condition_status = $${idx++}`);
      values.push(input.conditionStatus);
    }

    if (input.compensationValueVnd !== undefined) {
      updates.push(`compensation_value_vnd = $${idx++}::bigint`);
      values.push(Math.max(0, Math.floor(Number(input.compensationValueVnd))));
    }

    if (input.note !== undefined) {
      updates.push(`note = $${idx++}`);
      values.push(input.note?.trim() || null);
    }

    if (input.installedAt !== undefined) {
      updates.push(`installed_at = $${idx++}`);
      values.push(input.installedAt ? new Date(input.installedAt).toISOString().slice(0, 10) : null);
    }

    const result = await this.db.query<EquipmentRow>(
      `UPDATE room_equipment
       SET ${updates.join(", ")}
       WHERE organization_id = $1::uuid AND room_id = $2::uuid AND id = $3::uuid
       RETURNING
         id::text,
         organization_id::text,
         property_id::text,
         room_id::text,
         name,
         brand,
         model_or_serial,
         quantity,
         condition_status,
         compensation_value_vnd::text,
         note,
         installed_at,
         created_at,
         updated_at`,
      values
    );

    return this.mapEquipment(result.rows[0]!);
  }

  async delete(
    principal: TenantPrincipal,
    roomId: string,
    equipmentId: string
  ): Promise<{ success: boolean; id: string }> {
    const room = await this.requireRoom(principal, roomId, "property.manage");

    const result = await this.db.query(
      `DELETE FROM room_equipment
       WHERE organization_id = $1::uuid AND room_id = $2::uuid AND id = $3::uuid`,
      [principal.organizationId, room.id, equipmentId]
    );

    if ((result.rowCount ?? 0) === 0) {
      throw new NotFoundException("Thiết bị không tồn tại.");
    }

    return { success: true, id: equipmentId };
  }

  private async requireRoom(
    principal: TenantPrincipal,
    roomId: string,
    permission: "property.read" | "property.manage"
  ): Promise<{ id: string; property_id: string }> {
    if (!roleHasPermission(principal.role, permission)) {
      throw new ForbiddenException("Không có quyền thao tác trên phòng.");
    }

    const result = await this.db.query<{
      id: string;
      property_id: string;
      operational_group_ids: string[];
    }>(
      `SELECT
         r.id::text,
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
       GROUP BY r.id, r.property_id
       LIMIT 1`,
      [principal.organizationId, roomId]
    );

    const room = result.rows[0];
    if (!room) {
      throw new NotFoundException("Phòng không tồn tại.");
    }

    if (
      !this.accessControl.can(principal.membership, permission, {
        organizationId: principal.organizationId,
        propertyId: room.property_id,
        operationalGroupIds: room.operational_group_ids
      })
    ) {
      throw new ForbiddenException("Không có quyền truy cập vào phòng thuộc cơ sở này.");
    }

    return { id: room.id, property_id: room.property_id };
  }

  private mapEquipment(row: EquipmentRow): RoomEquipment {
    return {
      id: row.id,
      organizationId: row.organization_id,
      propertyId: row.property_id,
      roomId: row.room_id,
      name: row.name,
      brand: row.brand,
      modelOrSerial: row.model_or_serial,
      quantity: row.quantity,
      conditionStatus: row.condition_status as EquipmentConditionStatus,
      compensationValueVnd: Number(row.compensation_value_vnd),
      note: row.note,
      installedAt: row.installed_at ? new Date(row.installed_at).toISOString().slice(0, 10) : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }
}
