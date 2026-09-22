import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";
import type { PlatformPrincipal } from "./cms.types.js";
import { platformRoleHasPermission } from "./domain/platform-access.js";
import {
  encodeOrganizationDirectoryCursor,
  normalizeOrganizationDirectoryFilters
} from "./domain/organization-directory-query.js";

type OrganizationDirectoryRow = QueryResultRow & {
  id: string;
  slug: string;
  name: string;
  status: string;
  created_at: Date;
  owner_name: string | null;
  room_count: number;
  staff_count: number;
  subscription_status: string | null;
  subscription_version: number | null;
  billing_interval: "MONTHLY" | "YEARLY" | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
  trial_ends_at: Date | null;
  subscription_cancel_at_period_end: boolean | null;
  plan_code: string | null;
  latest_invoice_id: string | null;
  latest_invoice_status:
    | "OPEN"
    | "PARTIALLY_PAID"
    | "PAID"
    | "VOID"
    | null;
  latest_invoice_amount_vnd: string | null;
  latest_invoice_paid_amount_vnd: string | null;
  latest_invoice_remaining_amount_vnd: string | null;
  latest_invoice_is_overdue: boolean | null;
  latest_invoice_due_at: Date | null;
  latest_invoice_paid_at: Date | null;
  latest_invoice_period_start: Date | null;
  latest_invoice_period_end: Date | null;
  room_limit: number | null;
  staff_limit: number | null;
  automation_quota: number | null;
  room_limit_source: string | null;
  staff_limit_source: string | null;
  automation_quota_source: string | null;
  automation_reserved: number;
  automation_consumed: number;
  is_delinquent: boolean;
  is_over_limit: boolean;
};

@Injectable()
export class CmsOrganizationDirectoryService {
  constructor(private readonly db: DatabaseService) {}

  async search(
    principal: PlatformPrincipal,
    input: {
      query?: string;
      plan?: string;
      subscriptionStatus?: string;
      organizationStatus?: string;
      delinquent?: string;
      overLimit?: string;
      limit?: string;
      cursor?: string;
    }
  ) {
    this.requireInspectPermission(principal);
    const filters = normalizeOrganizationDirectoryFilters(input);

    const result = await this.db.query<OrganizationDirectoryRow>(
      `${this.organizationViewSql()}
       SELECT *
       FROM organization_view
       WHERE
         (
           $1 = ''
           OR name ILIKE '%' || $1 || '%'
           OR slug ILIKE '%' || $1 || '%'
           OR COALESCE(owner_name, '') ILIKE '%' || $1 || '%'
           OR id::text = $1
         )
         AND ($2 = '' OR COALESCE(plan_code, 'UNASSIGNED') = $2)
         AND (
           $3 = ''
           OR COALESCE(subscription_status, 'UNASSIGNED') = $3
         )
         AND ($4 = '' OR status = $4)
         AND ($5::boolean IS NULL OR is_delinquent = $5::boolean)
         AND ($6::boolean IS NULL OR is_over_limit = $6::boolean)
         AND (
           $7::timestamptz IS NULL
           OR (created_at, id) < ($7::timestamptz, $8::uuid)
         )
       ORDER BY created_at DESC, id DESC
       LIMIT $9`,
      [
        filters.query,
        filters.plan,
        filters.subscriptionStatus,
        filters.organizationStatus,
        filters.delinquent,
        filters.overLimit,
        filters.cursor?.createdAt ?? null,
        filters.cursor?.id ?? null,
        filters.limit + 1
      ]
    );

    const hasMore = result.rows.length > filters.limit;
    const rows = hasMore ? result.rows.slice(0, filters.limit) : result.rows;
    const last = rows.at(-1);

    return {
      items: rows.map((row) => this.mapOrganization(row)),
      nextCursor:
        hasMore && last
          ? encodeOrganizationDirectoryCursor({
              createdAt: last.created_at.toISOString(),
              id: last.id
            })
          : null
    };
  }

  async getById(principal: PlatformPrincipal, organizationId: string) {
    this.requireInspectPermission(principal);

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)) {
      throw new BadRequestException("organizationId must be a valid UUID.");
    }

    const result = await this.db.query<OrganizationDirectoryRow>(
      `${this.organizationViewSql()}
       SELECT *
       FROM organization_view
       WHERE id = $1::uuid
       LIMIT 1`,
      [organizationId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Organization was not found.");
    }

    return this.mapOrganization(row);
  }

  private requireInspectPermission(principal: PlatformPrincipal): void {
    if (
      !platformRoleHasPermission(
        principal.role,
        "platform.organizations.inspect"
      )
    ) {
      throw new ForbiddenException("Platform permission denied.");
    }
  }

  private organizationViewSql(): string {
    return `WITH organization_view AS (
      SELECT
        o.id,
        o.slug,
        o.name,
        o.status,
        o.created_at,
        owner.display_name AS owner_name,
        COALESCE(room_usage.room_count, 0)::int AS room_count,
        COALESCE(staff_usage.staff_count, 0)::int AS staff_count,
        s.status AS subscription_status,
        s.version AS subscription_version,
        s.billing_interval,
        s.current_period_start,
        s.current_period_end,
        s.trial_ends_at,
        s.cancel_at_period_end AS subscription_cancel_at_period_end,
        p.code AS plan_code,
        billing_invoice.id AS latest_invoice_id,
        billing_invoice.status AS latest_invoice_status,
        billing_invoice.amount_vnd::text AS latest_invoice_amount_vnd,
        billing_invoice.paid_amount_vnd::text AS latest_invoice_paid_amount_vnd,
        billing_invoice.remaining_amount_vnd::text
          AS latest_invoice_remaining_amount_vnd,
        billing_invoice.is_overdue AS latest_invoice_is_overdue,
        billing_invoice.due_at AS latest_invoice_due_at,
        billing_invoice.paid_at AS latest_invoice_paid_at,
        billing_invoice.period_start AS latest_invoice_period_start,
        billing_invoice.period_end AS latest_invoice_period_end,
        COALESCE(room_override.value, pv.room_limit) AS room_limit,
        COALESCE(staff_override.value, pv.staff_limit) AS staff_limit,
        COALESCE(automation_override.value, pv.automation_quota)
          AS automation_quota,
        CASE
          WHEN room_override.value IS NOT NULL THEN 'OVERRIDE'
          WHEN pv.room_limit IS NOT NULL THEN 'PLAN'
          ELSE NULL
        END AS room_limit_source,
        CASE
          WHEN staff_override.value IS NOT NULL THEN 'OVERRIDE'
          WHEN pv.staff_limit IS NOT NULL THEN 'PLAN'
          ELSE NULL
        END AS staff_limit_source,
        CASE
          WHEN automation_override.value IS NOT NULL THEN 'OVERRIDE'
          WHEN pv.automation_quota IS NOT NULL THEN 'PLAN'
          ELSE NULL
        END AS automation_quota_source,
        COALESCE(automation_usage.reserved_actions, 0)::int
          AS automation_reserved,
        COALESCE(automation_usage.consumed_actions, 0)::int
          AS automation_consumed,
        (
          s.status IN ('PAST_DUE', 'GRACE_PERIOD', 'SUSPENDED')
          OR COALESCE(billing_invoice.is_overdue, false)
        ) AS is_delinquent,
        (
          (
            COALESCE(room_override.value, pv.room_limit) IS NOT NULL
            AND COALESCE(room_usage.room_count, 0)
              > COALESCE(room_override.value, pv.room_limit)
          )
          OR (
            COALESCE(staff_override.value, pv.staff_limit) IS NOT NULL
            AND COALESCE(staff_usage.staff_count, 0)
              > COALESCE(staff_override.value, pv.staff_limit)
          )
          OR (
            COALESCE(automation_override.value, pv.automation_quota)
              IS NOT NULL
            AND (
              COALESCE(automation_usage.reserved_actions, 0)
              + COALESCE(automation_usage.consumed_actions, 0)
            ) > COALESCE(automation_override.value, pv.automation_quota)
          )
        ) AS is_over_limit
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
      LEFT JOIN LATERAL (
        SELECT (eo.value #>> '{}')::int AS value
        FROM organization_entitlement_overrides eo
        WHERE eo.organization_id = o.id
          AND eo.entitlement_key = 'room_limit'
          AND eo.revoked_at IS NULL
          AND (eo.expires_at IS NULL OR eo.expires_at > now())
        ORDER BY eo.created_at DESC
        LIMIT 1
      ) room_override ON true
      LEFT JOIN LATERAL (
        SELECT (eo.value #>> '{}')::int AS value
        FROM organization_entitlement_overrides eo
        WHERE eo.organization_id = o.id
          AND eo.entitlement_key = 'staff_limit'
          AND eo.revoked_at IS NULL
          AND (eo.expires_at IS NULL OR eo.expires_at > now())
        ORDER BY eo.created_at DESC
        LIMIT 1
      ) staff_override ON true
      LEFT JOIN LATERAL (
        SELECT (eo.value #>> '{}')::int AS value
        FROM organization_entitlement_overrides eo
        WHERE eo.organization_id = o.id
          AND eo.entitlement_key = 'automation_actions_monthly'
          AND eo.revoked_at IS NULL
          AND (eo.expires_at IS NULL OR eo.expires_at > now())
        ORDER BY eo.created_at DESC
        LIMIT 1
      ) automation_override ON true
      LEFT JOIN LATERAL (
        SELECT
          i.id,
          i.status,
          i.amount_vnd,
          COALESCE(alloc.paid_amount_vnd, 0)::bigint AS paid_amount_vnd,
          (
            i.amount_vnd - COALESCE(alloc.paid_amount_vnd, 0)
          )::bigint AS remaining_amount_vnd,
          (
            i.due_at <= now()
            AND i.status IN ('OPEN', 'PARTIALLY_PAID')
          ) AS is_overdue,
          i.due_at,
          i.paid_at,
          i.period_start,
          i.period_end
        FROM saas_subscription_invoices i
        LEFT JOIN LATERAL (
          SELECT COALESCE(sum(a.amount_vnd), 0)::bigint AS paid_amount_vnd
          FROM saas_subscription_payment_allocations a
          JOIN saas_subscription_payments pay
            ON pay.organization_id = a.organization_id
           AND pay.id = a.payment_id
          WHERE a.organization_id = i.organization_id
            AND a.invoice_id = i.id
            AND pay.status = 'SUCCEEDED'
        ) alloc ON true
        WHERE i.organization_id = o.id
          AND i.status <> 'VOID'
        ORDER BY i.period_start DESC, i.created_at DESC
        LIMIT 1
      ) billing_invoice ON true
      LEFT JOIN LATERAL (
        SELECT
          aqp.reserved_actions,
          aqp.consumed_actions
        FROM automation_quota_periods aqp
        JOIN LATERAL (
          SELECT value #>> '{}' AS timezone
          FROM system_settings
          WHERE key = 'automation_quota_timezone'
        ) quota_timezone ON true
        WHERE aqp.organization_id = o.id
          AND timezone(quota_timezone.timezone, now())::date
            >= aqp.period_start
          AND timezone(quota_timezone.timezone, now())::date
            < aqp.period_end
        ORDER BY aqp.period_start DESC
        LIMIT 1
      ) automation_usage ON true
    )`;
  }

  private mapOrganization(row: OrganizationDirectoryRow) {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      ownerName: row.owner_name,
      rooms: row.room_count,
      staff: row.staff_count,
      subscriptionStatus: row.subscription_status ?? "UNASSIGNED",
      subscriptionVersion: row.subscription_version,
      billingInterval: row.billing_interval,
      currentPeriodStart: row.current_period_start?.toISOString() ?? null,
      currentPeriodEnd: row.current_period_end?.toISOString() ?? null,
      trialEndsAt: row.trial_ends_at?.toISOString() ?? null,
      cancelAtPeriodEnd: row.subscription_cancel_at_period_end ?? null,
      planCode: row.plan_code,
      latestInvoice:
        row.latest_invoice_id === null
          ? null
          : {
              id: row.latest_invoice_id,
              status: row.latest_invoice_status,
              amountVnd: Number(row.latest_invoice_amount_vnd),
              paidAmountVnd: Number(row.latest_invoice_paid_amount_vnd),
              remainingAmountVnd: Number(
                row.latest_invoice_remaining_amount_vnd
              ),
              isOverdue: row.latest_invoice_is_overdue ?? false,
              dueAt: row.latest_invoice_due_at?.toISOString() ?? null,
              paidAt: row.latest_invoice_paid_at?.toISOString() ?? null,
              periodStart:
                row.latest_invoice_period_start?.toISOString() ?? null,
              periodEnd:
                row.latest_invoice_period_end?.toISOString() ?? null
            },
      roomLimit: row.room_limit,
      staffLimit: row.staff_limit,
      automationQuota: row.automation_quota,
      roomLimitSource: row.room_limit_source,
      staffLimitSource: row.staff_limit_source,
      automationQuotaSource: row.automation_quota_source,
      automationUsed: row.automation_consumed,
      automationReserved: row.automation_reserved,
      delinquent: row.is_delinquent,
      overLimit: row.is_over_limit
    };
  }
}
