import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";
import { RenterPublicInvoiceService } from "./renter-public-invoice.service.js";

export type ReminderTier =
  | "UPCOMING"
  | "DUE_TODAY"
  | "OVERDUE_STAGE_1"
  | "OVERDUE_STAGE_2"
  | "OVERDUE_STAGE_3"
  | "MANUAL";

export interface ReminderCandidateRow extends QueryResultRow {
  invoice_id: string;
  organization_id: string;
  invoice_number: string;
  remaining_vnd: string;
  due_date: string;
  room_code: string;
  property_name: string;
  resident_name: string | null;
  phone: string | null;
  lease_id: string;
}

export interface ReminderResult {
  invoiceId: string;
  invoiceNumber: string;
  roomCode: string;
  recipientPhone: string;
  recipientName: string | null;
  tier: ReminderTier;
  remainingVnd: number;
  dueDate: string;
  messageText: string;
}

export function computeReminderTier(
  dueDateStr: string,
  todayStr: string
): ReminderTier | null {
  const due = new Date(dueDateStr);
  const today = new Date(todayStr);

  const utcDue = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
  const utcToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((utcDue - utcToday) / 86400000);

  if (diffDays === 2) return "UPCOMING";
  if (diffDays === 0) return "DUE_TODAY";
  if (diffDays === -1) return "OVERDUE_STAGE_1";
  if (diffDays === -3) return "OVERDUE_STAGE_2";
  if (diffDays === -7) return "OVERDUE_STAGE_3";

  return null;
}

export function buildReminderMessage(input: {
  roomCode: string;
  remainingVnd: number;
  dueDate: string;
  publicUrl: string;
  tier: ReminderTier;
  residentName?: string | null;
}): string {
  const money = new Intl.NumberFormat("vi-VN").format(input.remainingVnd);
  const greeting = input.residentName
    ? `Kính gửi Anh/Chị ${input.residentName},`
    : `Kính gửi Anh/Chị thuê phòng ${input.roomCode},`;

  let header = "";
  if (input.tier === "UPCOMING") {
    header = `Nhắc nhở: Hóa đơn tiền phòng ${input.roomCode} sẽ đến hạn trong 2 ngày tới (${input.dueDate}).`;
  } else if (input.tier === "DUE_TODAY") {
    header = `Thông báo: Hôm nay (${input.dueDate}) là hạn thanh toán tiền phòng ${input.roomCode}.`;
  } else if (input.tier === "OVERDUE_STAGE_1") {
    header = `CẢNH BÁO QUÁ HẠN: Hóa đơn phòng ${input.roomCode} đã quá hạn thanh toán 1 ngày (hạn: ${input.dueDate}).`;
  } else if (input.tier === "OVERDUE_STAGE_2") {
    header = `CẢNH BÁO QUÁ HẠN: Hóa đơn phòng ${input.roomCode} đã quá hạn 3 ngày. Vui lòng thanh toán sớm để tránh gián đoạn dịch vụ.`;
  } else if (input.tier === "OVERDUE_STAGE_3") {
    header = `THÔNG BÁO QUÁ HẠN NGHIÊM TRỌNG: Hóa đơn phòng ${input.roomCode} đã quá hạn 7 ngày. Vui lòng liên hệ ban quản lý ngay.`;
  } else {
    header = `Nhắc nhở thanh toán hóa đơn tiền phòng ${input.roomCode}.`;
  }

  return [
    greeting,
    header,
    `- Số tiền cần thanh toán: ${money} đ`,
    `- Hạn thanh toán: ${input.dueDate}`,
    `Quý khách vui lòng bấm vào liên kết sau để xem chi tiết và quét mã VietQR:`,
    input.publicUrl,
    `Trân trọng cảm ơn!`
  ].join("\n");
}

@Injectable()
export class RenterBillingReminderService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly publicInvoices: RenterPublicInvoiceService
  ) {}

  private publicInvoiceBaseUrl(): string {
    const raw =
      process.env.PUBLIC_INVOICE_BASE_URL ?? "http://localhost:3002";
    return raw.replace(/\/$/, "");
  }

  async sweepDueReminders(limit: number = 100): Promise<{
    scanned: number;
    reminded: number;
    skipped: number;
    reminders: ReminderResult[];
  }> {
    const todayStr = new Date().toISOString().slice(0, 10);
    const baseUrl = this.publicInvoiceBaseUrl();

    // Query active unpaid/partially paid issued invoices with resident contact
    const candidateQuery = await this.db.query<ReminderCandidateRow>(
      `SELECT
         i.id::text AS invoice_id,
         i.organization_id::text,
         i.invoice_number,
         i.remaining_vnd::text,
         i.due_date::text,
         i.room_code_snapshot AS room_code,
         p.name AS property_name,
         res.full_name AS resident_name,
         res.phone,
         i.lease_id::text
       FROM renter_invoices i
       JOIN properties p
         ON p.organization_id = i.organization_id
        AND p.id = i.property_id
       LEFT JOIN lease_residents lr
         ON lr.organization_id = i.organization_id
        AND lr.lease_id = i.lease_id
        AND lr.party_role = 'PRIMARY_TENANT'
        AND lr.left_on IS NULL
       LEFT JOIN residents res
         ON res.organization_id = lr.organization_id
        AND res.id = lr.resident_id
       WHERE i.status = 'ISSUED'
         AND i.collection_status IN ('UNPAID', 'PARTIALLY_PAID')
         AND i.remaining_vnd > 0
         AND res.phone IS NOT NULL
         AND length(trim(res.phone)) >= 9
       ORDER BY i.due_date ASC, i.id ASC
       LIMIT $1`,
      [Math.min(limit, 500)]
    );

    let remindedCount = 0;
    let skippedCount = 0;
    const reminders: ReminderResult[] = [];

    for (const row of candidateQuery.rows) {
      const tier = computeReminderTier(row.due_date, todayStr);
      if (!tier) {
        skippedCount++;
        continue;
      }

      // Check if already reminded today for this tier
      const existing = await this.db.query(
        `SELECT 1 FROM renter_invoice_reminders
         WHERE organization_id = $1::uuid
           AND invoice_id = $2::uuid
           AND reminder_tier = $3
           AND created_at::date = CURRENT_DATE
         LIMIT 1`,
        [row.organization_id, row.invoice_id, tier]
      );

      if ((existing.rowCount ?? 0) > 0) {
        skippedCount++;
        continue;
      }

      // Get or issue public invoice token
      const publicLinkResult = await this.db.query<{ token_hash: string }>(
        `SELECT token_hash FROM renter_invoice_public_links
         WHERE organization_id = $1::uuid
           AND invoice_id = $2::uuid
           AND status = 'ACTIVE'
           AND (expires_at IS NULL OR expires_at > now())
         LIMIT 1`,
        [row.organization_id, row.invoice_id]
      );

      let publicUrl = `${baseUrl}/i/${row.invoice_id}`;
      if (publicLinkResult.rows[0]) {
        publicUrl = `${baseUrl}/i/${publicLinkResult.rows[0].token_hash.slice(0, 32)}`;
      }

      const messageText = buildReminderMessage({
        roomCode: row.room_code,
        remainingVnd: Number(row.remaining_vnd),
        dueDate: row.due_date,
        publicUrl,
        tier,
        residentName: row.resident_name
      });

      // Record reminder in renter_invoice_reminders
      await this.db.query(
        `INSERT INTO renter_invoice_reminders (
           organization_id,
           invoice_id,
           reminder_tier,
           recipient_phone,
           recipient_name,
           remaining_vnd,
           due_date,
           channel,
           status,
           message_text
         )
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::date, 'ZALO', 'QUEUED', $8)
         ON CONFLICT (organization_id, invoice_id, reminder_tier, (created_at::date))
         DO NOTHING`,
        [
          row.organization_id,
          row.invoice_id,
          tier,
          row.phone!.trim(),
          row.resident_name,
          row.remaining_vnd,
          row.due_date,
          messageText
        ]
      );

      remindedCount++;
      reminders.push({
        invoiceId: row.invoice_id,
        invoiceNumber: row.invoice_number,
        roomCode: row.room_code,
        recipientPhone: row.phone!.trim(),
        recipientName: row.resident_name,
        tier,
        remainingVnd: Number(row.remaining_vnd),
        dueDate: row.due_date,
        messageText
      });
    }

    return {
      scanned: candidateQuery.rows.length,
      reminded: remindedCount,
      skipped: skippedCount,
      reminders
    };
  }

  async manualTriggerReminder(
    principal: TenantPrincipal,
    invoiceId: string
  ): Promise<ReminderResult> {
    const invoiceQuery = await this.db.query<ReminderCandidateRow>(
      `SELECT
         i.id::text AS invoice_id,
         i.organization_id::text,
         i.invoice_number,
         i.remaining_vnd::text,
         i.due_date::text,
         i.room_code_snapshot AS room_code,
         p.name AS property_name,
         res.full_name AS resident_name,
         res.phone,
         i.lease_id::text
       FROM renter_invoices i
       JOIN properties p
         ON p.organization_id = i.organization_id
        AND p.id = i.property_id
       LEFT JOIN lease_residents lr
         ON lr.organization_id = i.organization_id
        AND lr.lease_id = i.lease_id
        AND lr.party_role = 'PRIMARY_TENANT'
        AND lr.left_on IS NULL
       LEFT JOIN residents res
         ON res.organization_id = lr.organization_id
        AND res.id = lr.resident_id
       WHERE i.organization_id = $1::uuid
         AND i.id = $2::uuid
       LIMIT 1`,
      [principal.organizationId, invoiceId]
    );

    const row = invoiceQuery.rows[0];
    if (!row) {
      throw new NotFoundException("Không tìm thấy hóa đơn cần gửi nhắc nợ.");
    }

    if (!row.phone || row.phone.trim().length < 9) {
      throw new ConflictException("Khách thuê phòng này chưa có số điện thoại hợp lệ để gửi nhắc nợ.");
    }

    const link = await this.publicInvoices.issueAccess(principal, invoiceId);
    const baseUrl = this.publicInvoiceBaseUrl();
    const publicUrl = `${baseUrl}/i/${encodeURIComponent(link.token)}`;

    const messageText = buildReminderMessage({
      roomCode: row.room_code,
      remainingVnd: Number(row.remaining_vnd),
      dueDate: row.due_date,
      publicUrl,
      tier: "MANUAL",
      residentName: row.resident_name
    });

    await this.db.query(
      `INSERT INTO renter_invoice_reminders (
         organization_id,
         invoice_id,
         reminder_tier,
         recipient_phone,
         recipient_name,
         remaining_vnd,
         due_date,
         channel,
         status,
         message_text
       )
       VALUES ($1::uuid, $2::uuid, 'MANUAL', $3, $4, $5, $6::date, 'ZALO', 'QUEUED', $7)`,
      [
        principal.organizationId,
        invoiceId,
        row.phone.trim(),
        row.resident_name,
        row.remaining_vnd,
        row.due_date,
        messageText
      ]
    );

    return {
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      roomCode: row.room_code,
      recipientPhone: row.phone.trim(),
      recipientName: row.resident_name,
      tier: "MANUAL",
      remainingVnd: Number(row.remaining_vnd),
      dueDate: row.due_date,
      messageText
    };
  }

  async listReminders(
    principal: TenantPrincipal,
    options?: { invoiceId?: string; limit?: number }
  ) {
    const limit = Math.min(options?.limit ?? 50, 200);
    const conditions = ["r.organization_id = $1::uuid"];
    const values: unknown[] = [principal.organizationId];

    if (options?.invoiceId) {
      values.push(options.invoiceId);
      conditions.push(`r.invoice_id = $${values.length}::uuid`);
    }

    values.push(limit);
    const result = await this.db.query(
      `SELECT
         r.id::text,
         r.invoice_id::text,
         i.invoice_number,
         i.room_code_snapshot AS room_code,
         r.reminder_tier,
         r.recipient_phone,
         r.recipient_name,
         r.remaining_vnd::text,
         r.due_date::text,
         r.channel,
         r.status,
         r.message_text,
         r.created_at
       FROM renter_invoice_reminders r
       JOIN renter_invoices i
         ON i.organization_id = r.organization_id
        AND i.id = r.invoice_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY r.created_at DESC
       LIMIT $${values.length}`,
      values
    );

    return {
      reminders: result.rows.map((row) => ({
        id: row.id,
        invoiceId: row.invoice_id,
        invoiceNumber: row.invoice_number,
        roomCode: row.room_code,
        tier: row.reminder_tier,
        recipientPhone: row.recipient_phone,
        recipientName: row.recipient_name,
        remainingVnd: Number(row.remaining_vnd),
        dueDate: row.due_date,
        channel: row.channel,
        status: row.status,
        messageText: row.message_text,
        createdAt: row.created_at
      }))
    };
  }
}
