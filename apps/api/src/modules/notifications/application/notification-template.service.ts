import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";

const categories = ["RENT", "PAYMENT", "UTILITY", "MAINTENANCE", "GENERAL"] as const;
export type TemplateCategory = (typeof categories)[number];
export const templateFields = [
  "ky_thanh_toan", "han_thanh_toan", "so_tien",
  "ngay_ghi_so", "ngay_bao_tri", "noi_dung",
  "ten_khach", "so_phong", "ten_co_so"
] as const;

// System presets are read-only starting points; they are not broadcast jobs.
// A user may copy one to their own organization and edit that copy.
export const defaultNotificationTemplates: Array<{
  id: string; name: string; category: TemplateCategory; body: string;
  source: "PRESET"; createdAt: null; updatedAt: null;
}> = [
  {
    id: "preset-rent-due",
    name: "Nhắc hạn thanh toán tiền phòng",
    category: "RENT",
    body: "Xin chào, Habi xin nhắc kỳ thanh toán {{ky_thanh_toan}} có hạn đến ngày {{han_thanh_toan}}. Bạn vui lòng kiểm tra hóa đơn và liên hệ quản lý nếu cần đối chiếu. Xin cảm ơn.",
    source: "PRESET", createdAt: null, updatedAt: null
  },
  {
    id: "preset-rent-followup",
    name: "Đối chiếu khoản chưa thanh toán",
    category: "RENT",
    body: "Xin chào, bộ phận quản lý đang đối chiếu thanh toán kỳ {{ky_thanh_toan}}. Nếu bạn đã chuyển khoản, vui lòng gửi biên nhận để chúng tôi kiểm tra. Cảm ơn bạn.",
    source: "PRESET", createdAt: null, updatedAt: null
  },
  {
    id: "preset-payment-confirmed",
    name: "Xác nhận đã nhận tiền",
    category: "PAYMENT",
    body: "Xin chào, quản lý xác nhận đã ghi nhận khoản thanh toán {{so_tien}} cho kỳ {{ky_thanh_toan}}. Nếu thông tin chưa chính xác, vui lòng phản hồi để được kiểm tra. Cảm ơn bạn.",
    source: "PRESET", createdAt: null, updatedAt: null
  },
  {
    id: "preset-utility",
    name: "Thông báo ghi số điện nước",
    category: "UTILITY",
    body: "Xin chào, ban quản lý dự kiến ghi chỉ số điện và nước vào ngày {{ngay_ghi_so}}. Bạn vui lòng tạo điều kiện để nhân viên thực hiện. Xin cảm ơn.",
    source: "PRESET", createdAt: null, updatedAt: null
  },
  {
    id: "preset-maintenance",
    name: "Lịch bảo trì và sửa chữa",
    category: "MAINTENANCE",
    body: "Xin chào, ban quản lý dự kiến bảo trì vào {{ngay_bao_tri}}. Nội dung: {{noi_dung}}. Vui lòng phản hồi nếu thời gian không thuận tiện.",
    source: "PRESET", createdAt: null, updatedAt: null
  },
  {
    id: "preset-general",
    name: "Thông báo chung",
    category: "GENERAL",
    body: "Xin chào, ban quản lý xin thông báo: {{noi_dung}}. Cảm ơn bạn đã hợp tác.",
    source: "PRESET", createdAt: null, updatedAt: null
  }
];

type TemplateRow = QueryResultRow & {
  id: string;
  name: string;
  category: TemplateCategory;
  body: string;
  created_at: Date;
  updated_at: Date;
};

function validatedDraft(value: unknown): {
  name: string; category: TemplateCategory; body: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Invalid message template.");
  }
  const payload = value as Record<string, unknown>;
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (name.length < 2 || name.length > 100) {
    throw new BadRequestException("Template name must be 2–100 characters.");
  }
  if (body.length < 1 || body.length > 4000) {
    throw new BadRequestException("Template body must be 1–4000 characters.");
  }
  if (!categories.includes(payload.category as TemplateCategory)) {
    throw new BadRequestException("Invalid template category.");
  }
  const tokenPattern = /{{\s*([^{}]+?)\s*}}/g;
  const fields = [...body.matchAll(tokenPattern)].map((match) => match[1]!.trim());
  for (const field of fields) {
    if (!(templateFields as readonly string[]).includes(field)) {
      throw new BadRequestException("Unsupported template variable: " + field);
    }
  }
  if (/{{|}}/.test(body.replace(tokenPattern, ""))) {
    throw new BadRequestException("Unclosed template variable.");
  }
  return { name, category: payload.category as TemplateCategory, body };
}

@Injectable()
export class NotificationTemplateService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessControlService
  ) {}

  async list(principal: TenantPrincipal) {
    this.require(principal, "notification.read");
    const result = await this.db.query<TemplateRow>(
      `SELECT id::text, name, category, body, created_at, updated_at
       FROM notification_message_templates
       WHERE organization_id = $1::uuid AND deleted_at IS NULL
       ORDER BY updated_at DESC, name LIMIT 200`,
      [principal.organizationId]
    );
    return {
      fields: [...templateFields],
      templates: [
        ...result.rows.map((row) => this.map(row)),
        ...defaultNotificationTemplates
      ]
    };
  }

  async create(principal: TenantPrincipal, input: unknown) {
    this.require(principal, "notification.send");
    const draft = validatedDraft(input);
    return this.save(principal, draft, null);
  }

  async update(principal: TenantPrincipal, id: string, input: unknown) {
    this.require(principal, "notification.send");
    const draft = validatedDraft(input);
    return this.save(principal, draft, id);
  }

  async remove(principal: TenantPrincipal, id: string) {
    this.require(principal, "notification.send");
    return this.db.withTransaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE notification_message_templates
         SET deleted_at = now(), updated_at = now(), updated_by_user_id = $3::uuid
         WHERE organization_id = $1::uuid AND id = $2::uuid AND deleted_at IS NULL
         RETURNING id::text`,
        [principal.organizationId, id, principal.userId]
      );
      if (!result.rowCount) throw new NotFoundException("Template was not found.");
      await client.query(
        `INSERT INTO audit_events
         (organization_id, actor_user_id, action, resource_type, resource_id)
         VALUES ($1::uuid, $2::uuid, 'NOTIFICATION_TEMPLATE_DELETED', 'NOTIFICATION_TEMPLATE', $3::uuid)`,
        [principal.organizationId, principal.userId, id]
      );
      return { deleted: true };
    });
  }

  private async save(
    principal: TenantPrincipal,
    draft: { name: string; category: TemplateCategory; body: string },
    id: string | null
  ) {
    try {
      return await this.db.withTransaction(async (client) => {
        const params = [principal.organizationId, draft.name, draft.category, draft.body, principal.userId];
        const result = id === null
          ? await client.query<TemplateRow>(
              `INSERT INTO notification_message_templates
                 (organization_id, name, category, body, created_by_user_id, updated_by_user_id)
               VALUES ($1::uuid, $2, $3, $4, $5::uuid, $5::uuid)
               RETURNING id::text, name, category, body, created_at, updated_at`,
              params
            )
          : await client.query<TemplateRow>(
              `UPDATE notification_message_templates
               SET name = $2, category = $3, body = $4, updated_by_user_id = $5::uuid, updated_at = now()
               WHERE organization_id = $1::uuid AND id = $6::uuid AND deleted_at IS NULL
               RETURNING id::text, name, category, body, created_at, updated_at`,
              [...params, id]
            );
        const row = result.rows[0];
        if (!row) throw new NotFoundException("Template was not found.");
        await client.query(
          `INSERT INTO audit_events
           (organization_id, actor_user_id, action, resource_type, resource_id)
           VALUES ($1::uuid, $2::uuid, $3, 'NOTIFICATION_TEMPLATE', $4::uuid)`,
          [principal.organizationId, principal.userId,
            id === null ? "NOTIFICATION_TEMPLATE_CREATED" : "NOTIFICATION_TEMPLATE_UPDATED", row.id]
        );
        return this.map(row);
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictException("A template with this name already exists.");
      }
      throw error;
    }
  }

  private map(row: TemplateRow) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      body: row.body,
      source: "CUSTOM" as const,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  }

  private require(principal: TenantPrincipal, permission: "notification.read" | "notification.send") {
    if (!this.access.can(principal.membership, permission, {
      organizationId: principal.organizationId
    })) {
      throw new ForbiddenException("Insufficient notification permissions.");
    }
  }
}

export { validatedDraft as validateNotificationTemplateDraft };
