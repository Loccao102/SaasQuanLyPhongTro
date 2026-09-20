import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { PostgresService } from "../../infrastructure/database/postgres.service.js";
import type {
  PlatformPrincipal,
  UpdatePlanInput,
  UpdateSettingInput
} from "./cms.types.js";
import {
  CmsConfigValidationError,
  validatePlanConfig,
  validateSettingValue,
  type SettingValueType
} from "./domain/config-validation.js";
import {
  platformRoleHasPermission,
  type PlatformPermission
} from "./domain/platform-access.js";

type SettingRow = QueryResultRow & {
  key: string;
  group_key: string;
  label: string;
  description: string;
  value: unknown;
  value_type: SettingValueType;
  version: number;
  updated_at: Date;
};

type PlanRow = QueryResultRow & {
  plan_id: string;
  code: string;
  name: string;
  status: string;
  version_id: string;
  version: number;
  monthly_price_vnd: string;
  yearly_price_vnd: string | null;
  room_limit: number;
  staff_limit: number;
  automation_quota: number;
  effective_from: Date;
};

type ReceiptRow = QueryResultRow & {
  request_fingerprint: string;
  response: unknown;
};

type OrganizationRow = QueryResultRow & {
  id: string;
  slug: string;
  name: string;
  status: string;
  owner_name: string | null;
  room_count: number;
  staff_count: number;
  subscription_status: string | null;
  plan_code: string | null;
  room_limit: number | null;
  staff_limit: number | null;
  automation_quota: number | null;
};

type AuditRow = QueryResultRow & {
  id: string;
  occurred_at: Date;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_key: string;
  organization_id: string | null;
  before_state: unknown;
  after_state: unknown;
  reason: string;
};

@Injectable()
export class CmsService {
  constructor(private readonly db: PostgresService) {}

  async getDashboard(principal: PlatformPrincipal) {
    this.requirePermission(principal, "platform.cms.read");

    const [orgs, rooms, settings, plans, audit] = await Promise.all([
      this.db.query<QueryResultRow & { count: string }>(
        "SELECT count(*)::text AS count FROM organizations"
      ),
      this.db.query<QueryResultRow & { count: string }>(
        "SELECT count(*)::text AS count FROM rooms WHERE is_active = true"
      ),
      this.db.query<QueryResultRow & { count: string }>(
        "SELECT count(*)::text AS count FROM system_settings"
      ),
      this.db.query<QueryResultRow & { count: string }>(
        "SELECT count(*)::text AS count FROM saas_plans WHERE status = 'ACTIVE'"
      ),
      this.db.query<QueryResultRow & { count: string }>(
        "SELECT count(*)::text AS count FROM platform_audit_events WHERE occurred_at >= now() - interval '24 hours'"
      )
    ]);

    return {
      organizationCount: Number(orgs.rows[0]?.count ?? 0),
      activeRoomCount: Number(rooms.rows[0]?.count ?? 0),
      settingCount: Number(settings.rows[0]?.count ?? 0),
      activePlanCount: Number(plans.rows[0]?.count ?? 0),
      platformAudit24h: Number(audit.rows[0]?.count ?? 0)
    };
  }

  async listSettings(principal: PlatformPrincipal) {
    this.requirePermission(principal, "platform.cms.read");
    const result = await this.db.query<SettingRow>(
      `SELECT key, group_key, label, description, value, value_type, version, updated_at
       FROM system_settings
       ORDER BY group_key, key`
    );
    return result.rows.map((row) => this.mapSetting(row));
  }

  async updateSetting(
    principal: PlatformPrincipal,
    key: string,
    input: UpdateSettingInput,
    idempotencyKey: string | undefined
  ) {
    this.requirePermission(principal, "platform.settings.manage");
    const reason = this.requireReason(input.reason);
    const commandKey = this.requireIdempotencyKey(idempotencyKey);
    const fingerprint = this.fingerprint({
      action: "SYSTEM_SETTING_UPDATED",
      key,
      value: input.value,
      expectedVersion: input.expectedVersion,
      reason
    });

    return this.db.transaction(async (client) => {
      const receipt = await this.readReceipt(
        client,
        principal.userId,
        commandKey
      );
      if (receipt) {
        if (receipt.request_fingerprint !== fingerprint) {
          throw new ConflictException(
            "Idempotency-Key was already used with a different request."
          );
        }
        return receipt.response;
      }

      const currentResult = await client.query<SettingRow>(
        `SELECT key, group_key, label, description, value, value_type, version, updated_at
         FROM system_settings WHERE key = $1 FOR UPDATE`,
        [key]
      );
      const current = currentResult.rows[0];
      if (!current) {
        throw new NotFoundException("System setting was not found.");
      }

      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== current.version
      ) {
        throw new ConflictException(
          "Setting changed since it was loaded. Refresh and retry."
        );
      }

      try {
        validateSettingValue(current.value_type, input.value);
      } catch (error) {
        if (error instanceof CmsConfigValidationError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }

      const updatedResult = await client.query<SettingRow>(
        `UPDATE system_settings
         SET value = $2::jsonb,
             version = version + 1,
             updated_by_user_id = $3,
             updated_at = now()
         WHERE key = $1
         RETURNING key, group_key, label, description, value, value_type, version, updated_at`,
        [key, JSON.stringify(input.value), principal.userId]
      );
      const response = this.mapSetting(updatedResult.rows[0]!);

      await this.insertAudit(client, {
        actorUserId: principal.userId,
        action: "SYSTEM_SETTING_UPDATED",
        targetType: "SYSTEM_SETTING",
        targetKey: key,
        beforeState: {
          value: current.value,
          version: current.version
        },
        afterState: {
          value: response.value,
          version: response.version
        },
        reason
      });
      await this.insertReceipt(
        client,
        principal.userId,
        commandKey,
        "SYSTEM_SETTING_UPDATED",
        fingerprint,
        response
      );
      return response;
    });
  }

  async listPlans(principal: PlatformPrincipal) {
    this.requirePermission(principal, "platform.cms.read");
    const result = await this.db.query<PlanRow>(this.planSelectSql());
    return result.rows.map((row) => this.mapPlan(row));
  }

  async updatePlan(
    principal: PlatformPrincipal,
    code: string,
    input: UpdatePlanInput,
    idempotencyKey: string | undefined
  ) {
    this.requirePermission(principal, "platform.plans.manage");
    const reason = this.requireReason(input.reason);
    const commandKey = this.requireIdempotencyKey(idempotencyKey);
    const fingerprint = this.fingerprint({
      action: "PLAN_CONFIG_UPDATED",
      code,
      monthlyPriceVnd: input.monthlyPriceVnd ?? null,
      roomLimit: input.roomLimit ?? null,
      staffLimit: input.staffLimit ?? null,
      automationQuota: input.automationQuota ?? null,
      expectedVersion: input.expectedVersion ?? null,
      effectiveAt: input.effectiveAt ?? null,
      reason
    });

    return this.db.transaction(async (client) => {
      const receipt = await this.readReceipt(
        client,
        principal.userId,
        commandKey
      );
      if (receipt) {
        if (receipt.request_fingerprint !== fingerprint) {
          throw new ConflictException(
            "Idempotency-Key was already used with a different request."
          );
        }
        return receipt.response;
      }

      const currentResult = await client.query<PlanRow>(
        this.planSelectSql("WHERE p.code = $1", "FOR UPDATE OF p"),
        [code]
      );
      const current = currentResult.rows[0];
      if (!current) {
        throw new NotFoundException("SaaS plan was not found.");
      }

      const next = {
        monthlyPriceVnd:
          input.monthlyPriceVnd ?? Number(current.monthly_price_vnd),
        roomLimit: input.roomLimit ?? current.room_limit,
        staffLimit: input.staffLimit ?? current.staff_limit,
        automationQuota:
          input.automationQuota ?? current.automation_quota
      };

      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== current.version
      ) {
        throw new ConflictException(
          "Plan changed since it was loaded. Refresh and retry."
        );
      }

      try {
        validatePlanConfig(next);
      } catch (error) {
        if (error instanceof CmsConfigValidationError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }

      const versionResult = await client.query<
        QueryResultRow & { id: string }
      >(
        `INSERT INTO saas_plan_versions (
           plan_id, version, monthly_price_vnd, yearly_price_vnd,
           room_limit, staff_limit, automation_quota, features,
           effective_from, created_by_user_id, reason
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb, COALESCE($8::timestamptz, now()), $9, $10)
         RETURNING id`,
        [
          current.plan_id,
          current.version + 1,
          next.monthlyPriceVnd,
          current.yearly_price_vnd,
          next.roomLimit,
          next.staffLimit,
          next.automationQuota,
          input.effectiveAt ?? null,
          principal.userId,
          reason
        ]
      );

      await client.query(
        `UPDATE saas_plans
         SET current_version_id = $2, updated_at = now()
         WHERE id = $1`,
        [current.plan_id, versionResult.rows[0]!.id]
      );

      const updatedResult = await client.query<PlanRow>(
        this.planSelectSql("WHERE p.code = $1"),
        [code]
      );
      const response = this.mapPlan(updatedResult.rows[0]!);

      await this.insertAudit(client, {
        actorUserId: principal.userId,
        action: "PLAN_CONFIG_UPDATED",
        targetType: "SAAS_PLAN",
        targetKey: code,
        beforeState: this.mapPlan(current),
        afterState: response,
        reason
      });
      await this.insertReceipt(
        client,
        principal.userId,
        commandKey,
        "PLAN_CONFIG_UPDATED",
        fingerprint,
        response
      );
      return response;
    });
  }

  async listOrganizations(principal: PlatformPrincipal) {
    this.requirePermission(principal, "platform.organizations.inspect");
    const result = await this.db.query<OrganizationRow>(
      `SELECT
         o.id::text,
         o.slug,
         o.name,
         o.status,
         owner.display_name AS owner_name,
         COALESCE(room_usage.room_count, 0)::int AS room_count,
         COALESCE(staff_usage.staff_count, 0)::int AS staff_count,
         s.status AS subscription_status,
         p.code AS plan_code,
         pv.room_limit,
         pv.staff_limit,
         pv.automation_quota
       FROM organizations o
       LEFT JOIN LATERAL (
         SELECT u.display_name
         FROM organization_memberships om
         JOIN users u ON u.id = om.user_id
         WHERE om.organization_id = o.id
           AND om.role = 'OWNER'
           AND om.status = 'ACTIVE'
         ORDER BY om.created_at
         LIMIT 1
       ) owner ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS room_count
         FROM rooms r
         WHERE r.organization_id = o.id AND r.is_active = true
       ) room_usage ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS staff_count
         FROM organization_memberships om
         WHERE om.organization_id = o.id AND om.status = 'ACTIVE'
       ) staff_usage ON true
       LEFT JOIN organization_subscriptions s
         ON s.organization_id = o.id
       LEFT JOIN saas_plans p
         ON p.id = s.plan_id
       LEFT JOIN saas_plan_versions pv
         ON pv.id = s.plan_version_id
       ORDER BY o.created_at DESC, o.id DESC`
    );

    return result.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      ownerName: row.owner_name,
      rooms: row.room_count,
      staff: row.staff_count,
      subscriptionStatus: row.subscription_status ?? "UNASSIGNED",
      planCode: row.plan_code,
      roomLimit: row.room_limit,
      staffLimit: row.staff_limit,
      automationQuota: row.automation_quota,
      automationUsed: null
    }));
  }

  async listAudit(principal: PlatformPrincipal) {
    this.requirePermission(principal, "platform.audit.read");
    const result = await this.db.query<AuditRow>(
      `SELECT
         pae.id::text,
         pae.occurred_at,
         u.display_name AS actor_name,
         u.email AS actor_email,
         pae.action,
         pae.target_type,
         pae.target_key,
         pae.organization_id::text,
         pae.before_state,
         pae.after_state,
         pae.reason
       FROM platform_audit_events pae
       LEFT JOIN users u ON u.id = pae.actor_user_id
       ORDER BY pae.occurred_at DESC, pae.id DESC
       LIMIT 200`
    );

    return result.rows.map((row) => ({
      id: row.id,
      at: row.occurred_at.toISOString(),
      actor: row.actor_name ?? row.actor_email ?? "system",
      action: row.action,
      targetType: row.target_type,
      target: row.target_key,
      organizationId: row.organization_id,
      before: row.before_state,
      after: row.after_state,
      reason: row.reason
    }));
  }

  getJobsIntegrationStatus(principal: PlatformPrincipal) {
    this.requirePermission(principal, "platform.jobs.read");
    return {
      connected: false,
      reason:
        "Durable notification/general job persistence has not been implemented in this repository slice.",
      entries: []
    };
  }

  getLogsIntegrationStatus(principal: PlatformPrincipal) {
    this.requirePermission(principal, "platform.logs.read");
    return {
      connected: false,
      reason:
        "Observability/Loki integration has not been connected yet. CMS does not fabricate technical log entries.",
      entries: []
    };
  }

  private requirePermission(
    principal: PlatformPrincipal,
    permission: PlatformPermission
  ): void {
    if (!platformRoleHasPermission(principal.role, permission)) {
      throw new ForbiddenException("Platform permission denied.");
    }
  }

  private requireReason(reason: string | undefined): string {
    const normalized = reason?.trim() ?? "";
    if (normalized.length < 3) {
      throw new BadRequestException(
        "A reason of at least 3 characters is required."
      );
    }
    return normalized;
  }

  private requireIdempotencyKey(value: string | undefined): string {
    const normalized = value?.trim() ?? "";
    if (normalized.length < 8 || normalized.length > 200) {
      throw new BadRequestException(
        "Idempotency-Key must be between 8 and 200 characters."
      );
    }
    return normalized;
  }

  private fingerprint(value: unknown): string {
    return createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex");
  }

  private mapSetting(row: SettingRow) {
    return {
      key: row.key,
      group: row.group_key,
      label: row.label,
      description: row.description,
      type: row.value_type,
      value: row.value,
      version: row.version,
      updatedAt: row.updated_at.toISOString()
    };
  }

  private mapPlan(row: PlanRow) {
    return {
      id: row.plan_id,
      code: row.code,
      name: row.name,
      status: row.status,
      version: row.version,
      monthlyPriceVnd: Number(row.monthly_price_vnd),
      yearlyPriceVnd:
        row.yearly_price_vnd === null ? null : Number(row.yearly_price_vnd),
      roomLimit: row.room_limit,
      staffLimit: row.staff_limit,
      automationQuota: row.automation_quota,
      effectiveFrom: row.effective_from.toISOString()
    };
  }

  private planSelectSql(whereClause = "", lockClause = ""): string {
    return `SELECT
       p.id::text AS plan_id,
       p.code,
       p.name,
       p.status,
       pv.id::text AS version_id,
       pv.version,
       pv.monthly_price_vnd::text,
       pv.yearly_price_vnd::text,
       pv.room_limit,
       pv.staff_limit,
       pv.automation_quota,
       pv.effective_from
     FROM saas_plans p
     JOIN saas_plan_versions pv
       ON pv.id = p.current_version_id
     ${suffix}
     ORDER BY p.created_at, p.code`;
  }

  private async readReceipt(
    client: PoolClient,
    actorUserId: string,
    idempotencyKey: string
  ): Promise<ReceiptRow | undefined> {
    const result = await client.query<ReceiptRow>(
      `SELECT request_fingerprint, response
       FROM platform_command_receipts
       WHERE actor_user_id = $1 AND idempotency_key = $2`,
      [actorUserId, idempotencyKey]
    );
    return result.rows[0];
  }

  private async insertReceipt(
    client: PoolClient,
    actorUserId: string,
    idempotencyKey: string,
    action: string,
    fingerprint: string,
    response: unknown
  ): Promise<void> {
    await client.query(
      `INSERT INTO platform_command_receipts (
         actor_user_id, idempotency_key, action, request_fingerprint, response
       )
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        actorUserId,
        idempotencyKey,
        action,
        fingerprint,
        JSON.stringify(response)
      ]
    );
  }

  private async insertAudit(
    client: PoolClient,
    event: {
      actorUserId: string;
      action: string;
      targetType: string;
      targetKey: string;
      organizationId?: string;
      beforeState: unknown;
      afterState: unknown;
      reason: string;
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO platform_audit_events (
         actor_user_id, action, target_type, target_key, organization_id,
         before_state, after_state, reason
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        event.actorUserId,
        event.action,
        event.targetType,
        event.targetKey,
        event.organizationId ?? null,
        JSON.stringify(event.beforeState),
        JSON.stringify(event.afterState),
        event.reason
      ]
    );
  }
}
