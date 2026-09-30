import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";

export interface PlatformBankInfo {
  bankId: string;
  bankName: string;
  accountNo: string;
  accountName: string;
}

export function getPlatformBankInfo(): PlatformBankInfo {
  return {
    bankId: process.env.SAAS_PLATFORM_BANK_ID?.trim() || "MB",
    bankName: process.env.SAAS_PLATFORM_BANK_NAME?.trim() || "MBBank (Ngân hàng Quân Đội)",
    accountNo: process.env.SAAS_PLATFORM_BANK_ACCOUNT?.trim() || "0388888888",
    accountName: process.env.SAAS_PLATFORM_BANK_ACCOUNT_NAME?.trim() || "HABI SAAS PROP-OPS"
  };
}

export function buildVietQrUrl(input: {
  bankId: string;
  accountNo: string;
  accountName: string;
  amountVnd: number;
  paymentReference: string;
}): string {
  return (
    `https://img.vietqr.io/image/${encodeURIComponent(input.bankId)}-${encodeURIComponent(input.accountNo)}-compact2.png` +
    `?amount=${input.amountVnd}&addInfo=${encodeURIComponent(input.paymentReference)}&accountName=${encodeURIComponent(input.accountName)}`
  );
}

export interface TenantSubscriptionPlanView {
  code: string;
  name: string;
  monthlyPriceVnd: number;
  yearlyPriceVnd: number;
  roomLimit: number;
  staffLimit: number;
  automationQuota: number;
  features: string[];
}

export interface TenantSubscriptionOverview {
  subscription: {
    id: string;
    planCode: string;
    planName: string;
    status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "GRACE_PERIOD" | "SUSPENDED" | "CANCELLED";
    billingInterval: "MONTHLY" | "YEARLY";
    trialEndsAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    daysRemaining: number;
    roomUsage: {
      current: number;
      limit: number;
      percentage: number;
    };
    staffUsage: {
      current: number;
      limit: number;
      percentage: number;
    };
    automationUsage: {
      current: number;
      limit: number;
      percentage: number;
    };
  };
  plans: TenantSubscriptionPlanView[];
  pendingInvoice: {
    id: string;
    amountVnd: number;
    paymentReference: string;
    status: string;
    dueAt: string;
    vietQrUrl: string;
    bankInfo: PlatformBankInfo;
  } | null;
}

@Injectable()
export class TenantSubscriptionService {
  constructor(private readonly database: DatabaseService) {}

  private assertOwnerOrAdmin(principal: TenantPrincipal) {
    if (principal.role !== "OWNER" && principal.role !== "ADMIN") {
      throw new ForbiddenException("Chỉ Chủ sở hữu (Owner) hoặc Quản trị viên (Admin) mới có quyền quản lý gói dịch vụ.");
    }
  }

  async getOverview(principal: TenantPrincipal): Promise<TenantSubscriptionOverview> {
    this.assertOwnerOrAdmin(principal);

    return this.database.withTransaction(async (client) => {
      // 1. Get current subscription
      const subResult = await client.query<{
        id: string;
        status: string;
        billing_interval: string;
        trial_ends_at: Date | null;
        current_period_start: Date | null;
        current_period_end: Date | null;
        plan_code: string;
        plan_name: string;
        monthly_price_vnd: string;
        yearly_price_vnd: string;
        room_limit: number;
        staff_limit: number;
        automation_quota: number;
      }>(
        `SELECT
           s.id::text,
           s.status,
           s.billing_interval,
           s.trial_ends_at,
           s.current_period_start,
           s.current_period_end,
           p.code AS plan_code,
           p.name AS plan_name,
           pv.monthly_price_vnd::text,
           pv.yearly_price_vnd::text,
           pv.room_limit,
           pv.staff_limit,
           pv.automation_quota
         FROM organization_subscriptions s
         JOIN saas_plans p ON p.id = s.plan_id
         JOIN saas_plan_versions pv ON pv.id = s.plan_version_id
         WHERE s.organization_id = $1`,
        [principal.organizationId]
      );

      const subRow = subResult.rows[0];
      if (!subRow) {
        throw new NotFoundException("Không tìm thấy thông tin gói dịch vụ của tổ chức.");
      }

      // 2. Count current rooms
      const roomCountResult = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM rooms r
         JOIN properties p ON p.id = r.property_id
         WHERE p.organization_id = $1`,
        [principal.organizationId]
      );
      const currentRooms = Number(roomCountResult.rows[0]?.count ?? 0);

      // 3. Count current staff
      const staffCountResult = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM memberships m
         WHERE m.organization_id = $1
           AND m.status = 'ACTIVE'
           AND m.role IN ('ADMIN', 'STAFF')`,
        [principal.organizationId]
      );
      const currentStaff = Number(staffCountResult.rows[0]?.count ?? 0);

      // 4. Count current automation actions
      const autoResult = await client.query<{ usage: string; limit: string }>(
        `SELECT
           COALESCE(monthly_usage, 0)::text AS usage,
           monthly_limit::text AS limit
         FROM organization_automation_quota
         WHERE organization_id = $1`,
        [principal.organizationId]
      );
      const currentAutoUsage = Number(autoResult.rows[0]?.usage ?? 0);

      // 5. Get available plans
      const plansResult = await client.query<{
        code: string;
        name: string;
        monthly_price_vnd: string;
        yearly_price_vnd: string;
        room_limit: number;
        staff_limit: number;
        automation_quota: number;
      }>(
        `SELECT
           p.code,
           p.name,
           pv.monthly_price_vnd::text,
           pv.yearly_price_vnd::text,
           pv.room_limit,
           pv.staff_limit,
           pv.automation_quota
         FROM saas_plans p
         JOIN saas_plan_versions pv ON pv.id = p.current_version_id
         WHERE p.status = 'ACTIVE'
         ORDER BY pv.monthly_price_vnd ASC`
      );

      const plans: TenantSubscriptionPlanView[] = plansResult.rows.map((p) => {
        let features: string[] = [];
        if (p.code === "STARTER") {
          features = [
            `Tối đa ${p.room_limit} phòng trọ`,
            `${p.staff_limit} nhân viên quản lý`,
            `${p.automation_quota.toLocaleString("vi-VN")} lượt thông báo/tháng`,
            "Tự động tính tiền điện nước",
            "Mã VietQR thanh toán tiền phòng",
            "Báo cáo dòng tiền P&L cơ bản"
          ];
        } else if (p.code === "GROWTH") {
          features = [
            `Tối đa ${p.room_limit} phòng trọ`,
            `${p.staff_limit} nhân viên quản lý`,
            `${p.automation_quota.toLocaleString("vi-VN")} lượt thông báo/tháng`,
            "Tự động gạch nợ ngân hàng SePay",
            "Background Worker tự động nhắc nợ Zalo",
            "Xuất Excel tạm trú chuẩn mẫu Công an",
            "Quản lý đặt cọc giữ chỗ phòng"
          ];
        } else if (p.code === "PRO") {
          features = [
            `Tối đa ${p.room_limit} phòng trọ`,
            `${p.staff_limit} nhân sự phân quyền cơ sở`,
            `${p.automation_quota.toLocaleString("vi-VN")} lượt thông báo/tháng`,
            "Đầy đủ tính năng cao cấp của Growth",
            "Báo hỏng sửa chữa & Quản lý thiết bị tài sản",
            "Sổ quỹ Thu - Chi đa cơ sở chi tiết",
            "Hỗ trợ kỹ thuật ưu tiên 24/7"
          ];
        } else {
          features = [
            `Tối đa ${p.room_limit} phòng trọ`,
            `${p.staff_limit} nhân sự toàn diện`,
            `${p.automation_quota.toLocaleString("vi-VN")} lượt thông báo/tháng`,
            "Tùy biến thương hiệu (White-label)",
            "Không giới hạn số cơ sở / tòa nhà",
            "API kết nối thiết bị IoT & khóa cửa thông minh"
          ];
        }

        return {
          code: p.code,
          name: p.name,
          monthlyPriceVnd: Number(p.monthly_price_vnd),
          yearlyPriceVnd: Number(p.yearly_price_vnd),
          roomLimit: p.room_limit,
          staffLimit: p.staff_limit,
          automationQuota: p.automation_quota,
          features
        };
      });

      // 6. Get pending open invoice
      const invoiceResult = await client.query<{
        id: string;
        amount_vnd: string;
        payment_reference: string;
        status: string;
        due_at: Date;
      }>(
        `SELECT
           id::text,
           amount_vnd::text,
           payment_reference,
           status,
           due_at
         FROM saas_subscription_invoices
         WHERE organization_id = $1
           AND status IN ('OPEN', 'PARTIALLY_PAID')
         ORDER BY due_at DESC
         LIMIT 1`,
        [principal.organizationId]
      );

      const bankInfo = getPlatformBankInfo();
      let pendingInvoice: TenantSubscriptionOverview["pendingInvoice"] = null;

      if (invoiceResult.rows[0]) {
        const inv = invoiceResult.rows[0];
        const amountVnd = Number(inv.amount_vnd);
        pendingInvoice = {
          id: inv.id,
          amountVnd,
          paymentReference: inv.payment_reference,
          status: inv.status,
          dueAt: inv.due_at.toISOString(),
          vietQrUrl: buildVietQrUrl({
            bankId: bankInfo.bankId,
            accountNo: bankInfo.accountNo,
            accountName: bankInfo.accountName,
            amountVnd,
            paymentReference: inv.payment_reference
          }),
          bankInfo
        };
      }

      // 7. Calculate days remaining
      const targetDate =
        subRow.status === "TRIALING"
          ? subRow.trial_ends_at
          : subRow.current_period_end;

      let daysRemaining = 0;
      if (targetDate) {
        const diffMs = targetDate.getTime() - Date.now();
        daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      }

      return {
        subscription: {
          id: subRow.id,
          planCode: subRow.plan_code,
          planName: subRow.plan_name,
          status: subRow.status as TenantSubscriptionOverview["subscription"]["status"],
          billingInterval: subRow.billing_interval as "MONTHLY" | "YEARLY",
          trialEndsAt: subRow.trial_ends_at?.toISOString() ?? null,
          currentPeriodStart: subRow.current_period_start?.toISOString() ?? null,
          currentPeriodEnd: subRow.current_period_end?.toISOString() ?? null,
          daysRemaining,
          roomUsage: {
            current: currentRooms,
            limit: subRow.room_limit,
            percentage: subRow.room_limit > 0 ? Math.min(100, Math.round((currentRooms / subRow.room_limit) * 100)) : 0
          },
          staffUsage: {
            current: currentStaff,
            limit: subRow.staff_limit,
            percentage: subRow.staff_limit > 0 ? Math.min(100, Math.round((currentStaff / subRow.staff_limit) * 100)) : 0
          },
          automationUsage: {
            current: currentAutoUsage,
            limit: subRow.automation_quota,
            percentage: subRow.automation_quota > 0 ? Math.min(100, Math.round((currentAutoUsage / subRow.automation_quota) * 100)) : 0
          }
        },
        plans,
        pendingInvoice
      };
    });
  }

  async createUpgradeRequest(
    principal: TenantPrincipal,
    input: { targetPlanCode: string; billingInterval: "MONTHLY" | "YEARLY" }
  ) {
    this.assertOwnerOrAdmin(principal);

    const targetCode = input.targetPlanCode.trim().toUpperCase();
    const interval = input.billingInterval === "YEARLY" ? "YEARLY" : "MONTHLY";

    return this.database.withTransaction(async (client) => {
      // 1. Get current subscription
      const subResult = await client.query<{
        id: string;
        plan_id: string;
        plan_version_id: string;
        status: string;
        current_period_end: Date | null;
      }>(
        `SELECT id::text, plan_id::text, plan_version_id::text, status, current_period_end
         FROM organization_subscriptions
         WHERE organization_id = $1
         FOR UPDATE`,
        [principal.organizationId]
      );
      const sub = subResult.rows[0];
      if (!sub) {
        throw new NotFoundException("Không tìm thấy thông tin gói dịch vụ.");
      }

      // 2. Find target plan & version
      const planResult = await client.query<{
        plan_id: string;
        plan_version_id: string;
        name: string;
        monthly_price_vnd: string;
        yearly_price_vnd: string;
      }>(
        `SELECT
           p.id::text AS plan_id,
           p.current_version_id::text AS plan_version_id,
           p.name,
           pv.monthly_price_vnd::text,
           pv.yearly_price_vnd::text
         FROM saas_plans p
         JOIN saas_plan_versions pv ON pv.id = p.current_version_id
         WHERE p.code = $1 AND p.status = 'ACTIVE'`,
        [targetCode]
      );
      const plan = planResult.rows[0];
      if (!plan) {
        throw new BadRequestException(`Gói dịch vụ ${targetCode} không tồn tại hoặc đã ngừng cung cấp.`);
      }

      const amountVnd = Number(interval === "YEARLY" ? plan.yearly_price_vnd : plan.monthly_price_vnd);
      if (amountVnd <= 0) {
        throw new BadRequestException("Giá trị gói cước không hợp lệ.");
      }

      // 3. Void any prior OPEN invoices for this organization
      await client.query(
        `UPDATE saas_subscription_invoices
         SET status = 'VOID', updated_at = now()
         WHERE organization_id = $1 AND status = 'OPEN'`,
        [principal.organizationId]
      );

      // 4. Calculate period
      const periodStart = new Date();
      const periodEnd = new Date();
      if (interval === "YEARLY") {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + 3);

      // Generate unique payment reference: e.g. SAAS + 8 random hex chars
      const refCode = "SAAS" + Math.random().toString(36).substring(2, 10).toUpperCase();

      // 5. Create new subscription invoice
      const invoiceResult = await client.query<{
        id: string;
        amount_vnd: string;
        payment_reference: string;
        due_at: Date;
        status: string;
      }>(
        `INSERT INTO saas_subscription_invoices (
           organization_id,
           subscription_id,
           plan_id,
           plan_version_id,
           billing_interval,
           period_start,
           period_end,
           amount_vnd,
           payment_reference,
           status,
           due_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'OPEN', $10)
         RETURNING id::text, amount_vnd::text, payment_reference, due_at, status`,
        [
          principal.organizationId,
          sub.id,
          plan.plan_id,
          plan.plan_version_id,
          interval,
          periodStart,
          periodEnd,
          amountVnd,
          refCode,
          dueAt
        ]
      );

      const invoice = invoiceResult.rows[0]!;
      const bankInfo = getPlatformBankInfo();
      const vietQrUrl = buildVietQrUrl({
        bankId: bankInfo.bankId,
        accountNo: bankInfo.accountNo,
        accountName: bankInfo.accountName,
        amountVnd,
        paymentReference: invoice.payment_reference
      });

      return {
        invoiceId: invoice.id,
        planName: plan.name,
        planCode: targetCode,
        billingInterval: interval,
        amountVnd,
        paymentReference: invoice.payment_reference,
        dueAt: invoice.due_at.toISOString(),
        status: invoice.status,
        vietQrUrl,
        bankInfo
      };
    });
  }

  async listInvoices(principal: TenantPrincipal) {
    this.assertOwnerOrAdmin(principal);

    const result = await this.database.withTransaction(async (client) => {
      return client.query<{
        id: string;
        plan_name: string;
        plan_code: string;
        billing_interval: string;
        amount_vnd: string;
        payment_reference: string;
        status: string;
        period_start: Date;
        period_end: Date;
        due_at: Date;
        paid_at: Date | null;
        created_at: Date;
      }>(
        `SELECT
           i.id::text,
           p.name AS plan_name,
           p.code AS plan_code,
           i.billing_interval,
           i.amount_vnd::text,
           i.payment_reference,
           i.status,
           i.period_start,
           i.period_end,
           i.due_at,
           i.paid_at,
           i.created_at
         FROM saas_subscription_invoices i
         JOIN saas_plans p ON p.id = i.plan_id
         WHERE i.organization_id = $1
         ORDER BY i.created_at DESC
         LIMIT 50`,
        [principal.organizationId]
      );
    });

    return {
      invoices: result.rows.map((row) => ({
        id: row.id,
        planName: row.plan_name,
        planCode: row.plan_code,
        billingInterval: row.billing_interval,
        amountVnd: Number(row.amount_vnd),
        paymentReference: row.payment_reference,
        status: row.status,
        periodStart: row.period_start.toISOString(),
        periodEnd: row.period_end.toISOString(),
        dueAt: row.due_at.toISOString(),
        paidAt: row.paid_at ? row.paid_at.toISOString() : null,
        createdAt: row.created_at.toISOString()
      }))
    };
  }

  async checkInvoiceStatus(principal: TenantPrincipal, invoiceId: string) {
    this.assertOwnerOrAdmin(principal);

    const result = await this.database.withTransaction(async (client) => {
      const inv = await client.query<{ status: string; paid_at: Date | null }>(
        `SELECT status, paid_at
         FROM saas_subscription_invoices
         WHERE id = $1 AND organization_id = $2`,
        [invoiceId, principal.organizationId]
      );
      if (!inv.rows[0]) {
        throw new NotFoundException("Không tìm thấy hóa đơn đăng ký gói.");
      }
      return {
        paid: inv.rows[0].status === "PAID",
        status: inv.rows[0].status,
        paidAt: inv.rows[0].paid_at ? inv.rows[0].paid_at.toISOString() : null
      };
    });

    return result;
  }
}
