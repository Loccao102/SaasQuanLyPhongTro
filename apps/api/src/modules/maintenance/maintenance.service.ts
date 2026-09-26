import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import { roleHasPermission } from "../identity/domain/access-control.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";
import {
  maintenanceTicketCategories,
  maintenanceTicketPriorities,
  maintenanceTicketStatuses,
  type CreateMaintenanceTicketInput,
  type MaintenanceFilterQuery,
  type MaintenanceTicket,
  type MaintenanceTicketCategory,
  type MaintenanceTicketPriority,
  type MaintenanceTicketStatus,
  type UpdateMaintenanceTicketInput
} from "./maintenance.types.js";

type TicketRow = QueryResultRow & {
  id: string;
  organization_id: string;
  property_id: string;
  property_name: string;
  property_code: string;
  room_id: string | null;
  room_code: string | null;
  room_name: string | null;
  lease_id: string | null;
  title: string;
  category: string;
  priority: string;
  status: string;
  description: string;
  resident_name: string;
  resident_phone: string | null;
  images: string[];
  reported_at: Date | string;
  resolved_at: Date | string | null;
  resolution_note: string | null;
  repair_cost_vnd: string;
  linked_expense_id: string | null;
  created_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService
  ) {}

  async list(
    principal: TenantPrincipal,
    query: MaintenanceFilterQuery
  ): Promise<MaintenanceTicket[]> {
    if (!roleHasPermission(principal.role, "property.read")) {
      throw new ForbiddenException("Không có quyền xem yêu cầu báo hỏng.");
    }

    const conditions: string[] = ["t.organization_id = $1::uuid"];
    const values: unknown[] = [principal.organizationId];
    let idx = 2;

    if (query.propertyId) {
      conditions.push(`t.property_id = $${idx++}::uuid`);
      values.push(query.propertyId);
    }
    if (query.roomId) {
      conditions.push(`t.room_id = $${idx++}::uuid`);
      values.push(query.roomId);
    }
    if (query.status && maintenanceTicketStatuses.includes(query.status)) {
      conditions.push(`t.status = $${idx++}`);
      values.push(query.status);
    }
    if (query.priority && maintenanceTicketPriorities.includes(query.priority)) {
      conditions.push(`t.priority = $${idx++}`);
      values.push(query.priority);
    }
    if (query.category && maintenanceTicketCategories.includes(query.category)) {
      conditions.push(`t.category = $${idx++}`);
      values.push(query.category);
    }

    const limit = Math.min(200, Math.max(1, query.limit ?? 100));

    const result = await this.db.query<TicketRow>(
      `SELECT
         t.id::text,
         t.organization_id::text,
         t.property_id::text,
         p.name AS property_name,
         p.code AS property_code,
         t.room_id::text,
         r.code AS room_code,
         r.name AS room_name,
         t.lease_id::text,
         t.title,
         t.category,
         t.priority,
         t.status,
         t.description,
         t.resident_name,
         t.resident_phone,
         COALESCE(t.images, '{}'::text[]) AS images,
         t.reported_at,
         t.resolved_at,
         t.resolution_note,
         t.repair_cost_vnd::text,
         t.linked_expense_id::text,
         t.created_by_user_id::text,
         t.created_at,
         t.updated_at
       FROM maintenance_tickets t
       JOIN properties p ON p.organization_id = t.organization_id AND p.id = t.property_id
       LEFT JOIN rooms r ON r.organization_id = t.organization_id AND r.id = t.room_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY
         CASE t.priority
           WHEN 'URGENT' THEN 1
           WHEN 'HIGH' THEN 2
           WHEN 'NORMAL' THEN 3
           WHEN 'LOW' THEN 4
           ELSE 5
         END ASC,
         t.reported_at DESC
       LIMIT ${limit}`,
      values
    );

    return result.rows.map((row) => this.mapTicket(row));
  }

  async getById(
    principal: TenantPrincipal,
    ticketId: string
  ): Promise<MaintenanceTicket> {
    if (!roleHasPermission(principal.role, "property.read")) {
      throw new ForbiddenException("Không có quyền xem yêu cầu báo hỏng.");
    }

    const result = await this.db.query<TicketRow>(
      `SELECT
         t.id::text,
         t.organization_id::text,
         t.property_id::text,
         p.name AS property_name,
         p.code AS property_code,
         t.room_id::text,
         r.code AS room_code,
         r.name AS room_name,
         t.lease_id::text,
         t.title,
         t.category,
         t.priority,
         t.status,
         t.description,
         t.resident_name,
         t.resident_phone,
         COALESCE(t.images, '{}'::text[]) AS images,
         t.reported_at,
         t.resolved_at,
         t.resolution_note,
         t.repair_cost_vnd::text,
         t.linked_expense_id::text,
         t.created_by_user_id::text,
         t.created_at,
         t.updated_at
       FROM maintenance_tickets t
       JOIN properties p ON p.organization_id = t.organization_id AND p.id = t.property_id
       LEFT JOIN rooms r ON r.organization_id = t.organization_id AND r.id = t.room_id
       WHERE t.organization_id = $1::uuid
         AND t.id = $2::uuid
       LIMIT 1`,
      [principal.organizationId, ticketId]
    );

    const ticket = result.rows[0];
    if (!ticket) {
      throw new NotFoundException("Yêu cầu sửa chữa không tồn tại.");
    }

    return this.mapTicket(ticket);
  }

  async create(
    principal: TenantPrincipal,
    input: CreateMaintenanceTicketInput
  ): Promise<MaintenanceTicket> {
    if (!roleHasPermission(principal.role, "property.manage")) {
      throw new ForbiddenException("Không có quyền tạo yêu cầu báo hỏng.");
    }

    const title = input.title?.trim();
    if (!title) {
      throw new BadRequestException("Tiêu đề báo hỏng không được để trống.");
    }

    const description = input.description?.trim();
    if (!description) {
      throw new BadRequestException("Mô tả chi tiết sự cố không được để trống.");
    }

    const residentName = input.residentName?.trim();
    if (!residentName) {
      throw new BadRequestException("Tên người báo không được để trống.");
    }

    const category = input.category && maintenanceTicketCategories.includes(input.category)
      ? input.category
      : "OTHER";
    const priority = input.priority && maintenanceTicketPriorities.includes(input.priority)
      ? input.priority
      : "NORMAL";

    const insertResult = await this.db.query<{ id: string }>(
      `INSERT INTO maintenance_tickets (
         organization_id,
         property_id,
         room_id,
         lease_id,
         title,
         category,
         priority,
         status,
         description,
         resident_name,
         resident_phone,
         images,
         created_by_user_id
       ) VALUES (
         $1::uuid,
         $2::uuid,
         $3::uuid,
         $4::uuid,
         $5,
         $6,
         $7,
         'OPEN',
         $8,
         $9,
         $10,
         $11::text[],
         $12::uuid
       ) RETURNING id::text`,
      [
        principal.organizationId,
        input.propertyId,
        input.roomId || null,
        input.leaseId || null,
        title,
        category,
        priority,
        description,
        residentName,
        input.residentPhone?.trim() || null,
        input.images ?? [],
        principal.userId
      ]
    );

    return this.getById(principal, insertResult.rows[0]!.id);
  }

  async update(
    principal: TenantPrincipal,
    ticketId: string,
    input: UpdateMaintenanceTicketInput
  ): Promise<MaintenanceTicket> {
    if (!roleHasPermission(principal.role, "property.manage")) {
      throw new ForbiddenException("Không có quyền cập nhật yêu cầu báo hỏng.");
    }

    const existing = await this.getById(principal, ticketId);

    const updates: string[] = ["updated_at = now()"];
    const values: unknown[] = [principal.organizationId, ticketId];
    let idx = 3;

    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw new BadRequestException("Tiêu đề không được để trống.");
      updates.push(`title = $${idx++}`);
      values.push(title);
    }

    if (input.description !== undefined) {
      const description = input.description.trim();
      if (!description) throw new BadRequestException("Mô tả không được để trống.");
      updates.push(`description = $${idx++}`);
      values.push(description);
    }

    if (input.residentName !== undefined) {
      const name = input.residentName.trim();
      if (!name) throw new BadRequestException("Tên người báo không được để trống.");
      updates.push(`resident_name = $${idx++}`);
      values.push(name);
    }

    if (input.residentPhone !== undefined) {
      updates.push(`resident_phone = $${idx++}`);
      values.push(input.residentPhone?.trim() || null);
    }

    if (input.category !== undefined) {
      if (!maintenanceTicketCategories.includes(input.category)) {
        throw new BadRequestException("Danh mục sự cố không hợp lệ.");
      }
      updates.push(`category = $${idx++}`);
      values.push(input.category);
    }

    if (input.priority !== undefined) {
      if (!maintenanceTicketPriorities.includes(input.priority)) {
        throw new BadRequestException("Mức độ ưu tiên không hợp lệ.");
      }
      updates.push(`priority = $${idx++}`);
      values.push(input.priority);
    }

    if (input.status !== undefined) {
      if (!maintenanceTicketStatuses.includes(input.status)) {
        throw new BadRequestException("Trạng thái sự cố không hợp lệ.");
      }
      updates.push(`status = $${idx++}`);
      values.push(input.status);

      if ((input.status === "RESOLVED" || input.status === "CLOSED") && !existing.resolvedAt) {
        updates.push("resolved_at = now()");
      } else if (input.status === "OPEN" || input.status === "IN_PROGRESS") {
        updates.push("resolved_at = NULL");
      }
    }

    if (input.resolutionNote !== undefined) {
      updates.push(`resolution_note = $${idx++}`);
      values.push(input.resolutionNote?.trim() || null);
    }

    if (input.repairCostVnd !== undefined) {
      const cost = Math.max(0, Math.floor(Number(input.repairCostVnd)));
      updates.push(`repair_cost_vnd = $${idx++}::bigint`);
      values.push(cost);
    }

    if (input.images !== undefined) {
      updates.push(`images = $${idx++}::text[]`);
      values.push(input.images);
    }

    // Auto sync to operating_expenses if requested and repairCostVnd > 0 and no existing linked_expense_id
    let newlyLinkedExpenseId: string | null = null;
    const finalRepairCost = input.repairCostVnd !== undefined ? Number(input.repairCostVnd) : existing.repairCostVnd;

    if (input.syncToOperatingExpense && finalRepairCost > 0 && !existing.linkedExpenseId) {
      const expenseInsert = await this.db.query<{ id: string }>(
        `INSERT INTO operating_expenses (
           organization_id,
           property_id,
           category,
           amount_vnd,
           occurred_at,
           paid_to,
           note,
           payment_method,
           created_by_user_id
         ) VALUES (
           $1::uuid,
           $2::uuid,
           'REPAIR_MAINTENANCE',
           $3::bigint,
           now(),
           $4,
           $5,
           'CASH',
           $6::uuid
         ) RETURNING id::text`,
        [
          principal.organizationId,
          existing.propertyId,
          finalRepairCost,
          "Thợ sửa chữa / Nhà cung cấp",
          `Chi phí xử lý sự cố [${existing.propertyCode}${existing.roomCode ? ` · ${existing.roomCode}` : ""}]: ${existing.title}`,
          principal.userId
        ]
      );
      newlyLinkedExpenseId = expenseInsert.rows[0]?.id ?? null;
      if (newlyLinkedExpenseId) {
        updates.push(`linked_expense_id = $${idx++}::uuid`);
        values.push(newlyLinkedExpenseId);
      }
    }

    await this.db.query(
      `UPDATE maintenance_tickets
       SET ${updates.join(", ")}
       WHERE organization_id = $1::uuid AND id = $2::uuid`,
      values
    );

    return this.getById(principal, ticketId);
  }

  async delete(
    principal: TenantPrincipal,
    ticketId: string
  ): Promise<{ success: boolean; id: string }> {
    if (!roleHasPermission(principal.role, "property.manage")) {
      throw new ForbiddenException("Không có quyền xoá yêu cầu báo hỏng.");
    }

    const result = await this.db.query(
      `DELETE FROM maintenance_tickets
       WHERE organization_id = $1::uuid AND id = $2::uuid`,
      [principal.organizationId, ticketId]
    );

    if ((result.rowCount ?? 0) === 0) {
      throw new NotFoundException("Yêu cầu sửa chữa không tồn tại.");
    }

    return { success: true, id: ticketId };
  }

  async createFromPublicInvoice(
    token: string,
    input: {
      title: string;
      category?: string;
      description: string;
      residentName?: string;
      residentPhone?: string;
      images?: string[];
    }
  ): Promise<{ id: string; title: string; status: string; message: string }> {
    const tokenHash = createHash("sha256").update(token.trim()).digest("hex");

    const invoiceResult = await this.db.query<{
      organization_id: string;
      property_id: string;
      room_id: string | null;
      lease_id: string | null;
      recipient_name: string | null;
      recipient_phone: string | null;
    }>(
      `SELECT
         i.organization_id::text,
         i.property_id::text,
         i.room_id::text,
         i.lease_id::text,
         i.recipient_name,
         i.recipient_phone
       FROM renter_invoice_public_links link
       JOIN renter_invoices i
         ON i.organization_id = link.organization_id
        AND i.id = link.invoice_id
       WHERE link.token_hash = $1
         AND link.status = 'ACTIVE'
         AND (link.expires_at IS NULL OR link.expires_at > now())
       LIMIT 1`,
      [tokenHash]
    );

    const inv = invoiceResult.rows[0];
    if (!inv) {
      throw new NotFoundException("Đường link hoá đơn không hợp lệ hoặc đã hết hạn.");
    }

    const title = input.title?.trim();
    if (!title) {
      throw new BadRequestException("Tiêu đề báo hỏng không được để trống.");
    }

    const description = input.description?.trim();
    if (!description) {
      throw new BadRequestException("Mô tả sự cố không được để trống.");
    }

    const residentName = (input.residentName?.trim() || inv.recipient_name || "Khách thuê").trim();
    const residentPhone = input.residentPhone?.trim() || inv.recipient_phone || null;

    const category = input.category && maintenanceTicketCategories.includes(input.category as any)
      ? input.category
      : "OTHER";

    const insertResult = await this.db.query<{ id: string }>(
      `INSERT INTO maintenance_tickets (
         organization_id,
         property_id,
         room_id,
         lease_id,
         title,
         category,
         priority,
         status,
         description,
         resident_name,
         resident_phone,
         images
       ) VALUES (
         $1::uuid,
         $2::uuid,
         $3::uuid,
         $4::uuid,
         $5,
         $6,
         'NORMAL',
         'OPEN',
         $7,
         $8,
         $9,
         $10::text[]
       ) RETURNING id::text`,
      [
        inv.organization_id,
        inv.property_id,
        inv.room_id,
        inv.lease_id,
        title,
        category,
        description,
        residentName,
        residentPhone,
        input.images ?? []
      ]
    );

    return {
      id: insertResult.rows[0]!.id,
      title,
      status: "OPEN",
      message: "Yêu cầu báo hỏng đã được ghi nhận. Chủ trọ / Ban quản lý sẽ xử lý sớm nhất có thể."
    };
  }

  private mapTicket(row: TicketRow): MaintenanceTicket {
    return {
      id: row.id,
      organizationId: row.organization_id,
      propertyId: row.property_id,
      propertyName: row.property_name,
      propertyCode: row.property_code,
      roomId: row.room_id,
      roomCode: row.room_code,
      roomName: row.room_name,
      leaseId: row.lease_id,
      title: row.title,
      category: row.category as MaintenanceTicketCategory,
      priority: row.priority as MaintenanceTicketPriority,
      status: row.status as MaintenanceTicketStatus,
      description: row.description,
      residentName: row.resident_name,
      residentPhone: row.resident_phone,
      images: Array.isArray(row.images) ? row.images : [],
      reportedAt: new Date(row.reported_at).toISOString(),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
      resolutionNote: row.resolution_note,
      repairCostVnd: Number(row.repair_cost_vnd),
      linkedExpenseId: row.linked_expense_id,
      createdByUserId: row.created_by_user_id,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }
}
