import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import {
  SubscriptionBillingConflictError,
  SubscriptionBillingNotFoundError,
  SubscriptionBillingService,
  type BillingSettlementView,
  type SubscriptionCancellationScheduleView
} from "../commercial/application/subscription-billing.service.js";
import {
  ConcurrentSubscriptionUpdateError,
  InvalidSubscriptionPlanChangeError,
  InvalidSubscriptionProvisioningError,
  SubscriptionAlreadyExistsError,
  SubscriptionManagementService,
  SubscriptionNotFoundError,
  SubscriptionPlanNotFoundError
} from "../commercial/application/subscription-management.service.js";
import { InvalidSubscriptionTransitionError } from "../commercial/domain/subscription-lifecycle.js";
import { DatabaseService } from "../database/database.service.js";
import {
  BillingWebhookConflictError,
  SaasBillingWebhookInboxService,
  type SaasBillingWebhookEventView
} from "../integrations/saas-billing-webhook-inbox.service.js";
import {
  NotificationJobRetryConflictError,
  NotificationOperationsService
} from "../notifications/application/notification-operations.service.js";
import {
  InvalidEntitlementOverrideError,
  isEntitlementKey,
  validateEntitlementOverride,
  type EntitlementValue
} from "../commercial/domain/entitlements.js";
import type {
  AllocateProviderPaymentInput,
  ChangeSubscriptionPlanInput,
  PlatformPrincipal,
  SetSubscriptionCancellationInput,
  ProvisionSubscriptionInput,
  RecordSubscriptionPaymentInput,
  RequeueBillingWebhookInput,
  RevokeEntitlementOverrideInput,
  RetryNotificationJobInput,
  TransitionSubscriptionInput,
  UpdateEntitlementOverrideInput,
  UpdateNotificationProviderControlInput,
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
  platformPermissionsForRole,
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

type BillingWebhookRow = QueryResultRow & {
  id: string;
  provider: string;
  provider_event_id: string;
  signature_status: "VERIFIED" | "INVALID" | "NOT_CONFIGURED";
  processing_status:
    | "RECEIVED"
    | "PROCESSING"
    | "PROCESSED"
    | "REVIEW_REQUIRED"
    | "IGNORED"
    | "FAILED";
  processing_attempts: number;
  received_at: Date;
  processing_started_at: Date | null;
  processed_at: Date | null;
  last_error_code: string | null;
  last_error_message: string | null;
  payment_id: string | null;
  is_stale: boolean;
};

type BillingWebhookSummaryRow = QueryResultRow & {
  received_count: string;
  processing_count: string;
  review_required_count: string;
  failed_count: string;
  stale_processing_count: string;
  processed_24h_count: string;
};

type EntitlementOverrideRow = QueryResultRow & {
  id: string;
  organization_id: string;
  organization_name: string;
  entitlement_key: string;
  value: unknown;
  expires_at: Date | null;
  reason: string;
  created_at: Date;
  created_by_name: string | null;
  revoked_at: Date | null;
};

@Injectable()
export class CmsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly subscriptionManagement: SubscriptionManagementService,
    private readonly subscriptionBilling: SubscriptionBillingService,
    private readonly notificationOperations: NotificationOperationsService,
    private readonly billingWebhookInbox: SaasBillingWebhookInboxService
  ) {}

  getBootstrap(principal: PlatformPrincipal) {
    this.requirePermission(principal, "platform.cms.read");
    return {
      userId: principal.userId,
      role: principal.role,
      permissions: platformPermissionsForRole(principal.role)
    };
  }

  async getDashboard(principal: PlatformPrincipal) {
    this.requirePermission(principal, "platform.cms.read");

    const settingKeys = [
      "brand_product_name",
      "brand_product_descriptor",
      "brand_tagline",
      "brand_palette",
      "display_locale",
      "display_timezone",
      "display_currency_code",
      "display_date_format",
      "display_datetime_format",
      "display_format_presets",
      "dashboard_lease_expiry_days",
      "dashboard_recent_window_hours",
      "worker_stale_after_seconds",
      "billing_webhook_processing_timeout_seconds"
    ];

    const settingsResult = await this.db.query<
      QueryResultRow & { key: string; value: unknown }
    >(
      `SELECT key, value
       FROM system_settings
       WHERE key = ANY($1::text[])`,
      [settingKeys]
    );
    const settingMap = new Map(
      settingsResult.rows.map((row) => [row.key, row.value])
    );
    const stringSetting = (key: string, fallback: string) => {
      const value = settingMap.get(key);
      return typeof value === "string" && value.trim()
        ? value
        : fallback;
    };
    const integerSetting = (key: string, fallback: number) => {
      const value = settingMap.get(key);
      return Number.isInteger(value) && Number(value) > 0
        ? Number(value)
        : fallback;
    };
    const jsonSetting = (
      key: string,
      fallback: Record<string, unknown>
    ) => {
      const value = settingMap.get(key);
      return typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : fallback;
    };

    const leaseExpiryDays = integerSetting(
      "dashboard_lease_expiry_days",
      30
    );
    const recentHours = integerSetting(
      "dashboard_recent_window_hours",
      24
    );
    const workerStaleAfterSeconds = integerSetting(
      "worker_stale_after_seconds",
      60
    );
    const webhookStaleAfterSeconds = integerSetting(
      "billing_webhook_processing_timeout_seconds",
      300
    );

    const [
      organizationStats,
      assetStats,
      commercialStats,
      notificationStats,
      workerStats,
      webhookStats,
      platformStats,
      topOrganizations,
      planDistribution
    ] = await Promise.all([
      this.db.query<
        QueryResultRow & {
          total: string;
          active: string;
          suspended: string;
          active_memberships: string;
        }
      >(
        `SELECT
           count(*)::text AS total,
           count(*) FILTER (WHERE status = 'ACTIVE')::text AS active,
           count(*) FILTER (WHERE status = 'SUSPENDED')::text AS suspended,
           (
             SELECT count(*)::text
             FROM organization_memberships
             WHERE status = 'ACTIVE'
           ) AS active_memberships
         FROM organizations`
      ),
      this.db.query<
        QueryResultRow & {
          active_properties: string;
          active_rooms: string;
          occupied_rooms: string;
          active_residents: string;
          active_leases: string;
          termination_scheduled_leases: string;
          expiring_leases: string;
        }
      >(
        `SELECT
           (
             SELECT count(*)::text
             FROM properties
             WHERE is_active = true
           ) AS active_properties,
           (
             SELECT count(*)::text
             FROM rooms
             WHERE is_active = true
           ) AS active_rooms,
           (
             SELECT count(*)::text
             FROM rooms r
             WHERE r.is_active = true
               AND EXISTS (
                 SELECT 1
                 FROM leases l
                 WHERE l.organization_id = r.organization_id
                   AND l.room_id = r.id
                   AND l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
               )
           ) AS occupied_rooms,
           (
             SELECT count(*)::text
             FROM residents
             WHERE is_active = true
           ) AS active_residents,
           (
             SELECT count(*)::text
             FROM leases
             WHERE status = 'ACTIVE'
           ) AS active_leases,
           (
             SELECT count(*)::text
             FROM leases
             WHERE status = 'TERMINATION_SCHEDULED'
           ) AS termination_scheduled_leases,
           (
             SELECT count(*)::text
             FROM leases
             WHERE status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
               AND planned_end_date IS NOT NULL
               AND planned_end_date BETWEEN current_date
                 AND current_date + $1::int
           ) AS expiring_leases`,
        [leaseExpiryDays]
      ),
      this.db.query<
        QueryResultRow & {
          trialing: string;
          active: string;
          past_due: string;
          grace_period: string;
          suspended: string;
          cancelled: string;
          cancel_at_period_end: string;
          unpaid_invoice_count: string;
          overdue_invoice_count: string;
          outstanding_vnd: string;
          overdue_vnd: string;
          successful_payment_count: string;
          successful_payment_vnd: string;
          active_plans: string;
        }
      >(
        `WITH invoice_balances AS (
           SELECT
             i.id,
             i.due_at,
             GREATEST(
               i.amount_vnd - COALESCE(
                 sum(a.amount_vnd) FILTER (WHERE p.id IS NOT NULL),
                 0
               ),
               0
             )::bigint AS remaining_vnd
           FROM saas_subscription_invoices i
           LEFT JOIN saas_subscription_payment_allocations a
             ON a.organization_id = i.organization_id
            AND a.invoice_id = i.id
           LEFT JOIN saas_subscription_payments p
             ON p.id = a.payment_id
            AND p.status = 'SUCCEEDED'
           WHERE i.status <> 'VOID'
           GROUP BY i.id
         )
         SELECT
           (SELECT count(*)::text FROM organization_subscriptions WHERE status = 'TRIALING') AS trialing,
           (SELECT count(*)::text FROM organization_subscriptions WHERE status = 'ACTIVE') AS active,
           (SELECT count(*)::text FROM organization_subscriptions WHERE status = 'PAST_DUE') AS past_due,
           (SELECT count(*)::text FROM organization_subscriptions WHERE status = 'GRACE_PERIOD') AS grace_period,
           (SELECT count(*)::text FROM organization_subscriptions WHERE status = 'SUSPENDED') AS suspended,
           (SELECT count(*)::text FROM organization_subscriptions WHERE status = 'CANCELLED') AS cancelled,
           (
             SELECT count(*)::text
             FROM organization_subscriptions
             WHERE cancel_at_period_end = true
           ) AS cancel_at_period_end,
           count(*) FILTER (WHERE remaining_vnd > 0)::text AS unpaid_invoice_count,
           count(*) FILTER (
             WHERE remaining_vnd > 0 AND due_at <= now()
           )::text AS overdue_invoice_count,
           COALESCE(sum(remaining_vnd), 0)::text AS outstanding_vnd,
           COALESCE(sum(remaining_vnd) FILTER (
             WHERE due_at <= now()
           ), 0)::text AS overdue_vnd,
           (
             SELECT count(*)::text
             FROM saas_subscription_payments
             WHERE status = 'SUCCEEDED'
               AND occurred_at >=
                 now() - ($1::int * interval '1 hour')
           ) AS successful_payment_count,
           (
             SELECT COALESCE(sum(amount_vnd), 0)::text
             FROM saas_subscription_payments
             WHERE status = 'SUCCEEDED'
               AND occurred_at >=
                 now() - ($1::int * interval '1 hour')
           ) AS successful_payment_vnd,
           (
             SELECT count(*)::text
             FROM saas_plans
             WHERE status = 'ACTIVE'
           ) AS active_plans
         FROM invoice_balances`,
        [recentHours]
      ),
      this.db.query<
        QueryResultRow & {
          queued: string;
          running: string;
          retry_wait: string;
          manual_review: string;
          failed: string;
          sent_recent: string;
        }
      >(
        `SELECT
           count(*) FILTER (WHERE status = 'QUEUED')::text AS queued,
           count(*) FILTER (WHERE status = 'RUNNING')::text AS running,
           count(*) FILTER (WHERE status = 'RETRY_WAIT')::text AS retry_wait,
           count(*) FILTER (WHERE status = 'MANUAL_REVIEW')::text AS manual_review,
           count(*) FILTER (WHERE status = 'FAILED')::text AS failed,
           count(*) FILTER (
             WHERE status = 'SENT'
               AND sent_at >= now() - ($1::int * interval '1 hour')
           )::text AS sent_recent
         FROM notification_jobs`,
        [recentHours]
      ),
      this.db.query<
        QueryResultRow & {
          healthy: string;
          degraded: string;
          stale: string;
          paused_providers: string;
        }
      >(
        `SELECT
           count(*) FILTER (
             WHERE h.status = 'HEALTHY'
               AND h.last_seen_at >=
                 now() - ($1::int * interval '1 second')
           )::text AS healthy,
           count(*) FILTER (
             WHERE h.status = 'DEGRADED'
               AND h.last_seen_at >=
                 now() - ($1::int * interval '1 second')
           )::text AS degraded,
           count(*) FILTER (
             WHERE h.status <> 'STOPPING'
               AND h.last_seen_at <
                 now() - ($1::int * interval '1 second')
           )::text AS stale,
           (
             SELECT count(*)::text
             FROM notification_provider_controls
             WHERE status = 'PAUSED'
           ) AS paused_providers
         FROM notification_worker_heartbeats h`,
        [workerStaleAfterSeconds]
      ),
      this.db.query<
        QueryResultRow & {
          received: string;
          processing: string;
          review_required: string;
          failed: string;
          stale_processing: string;
          processed_recent: string;
        }
      >(
        `SELECT
           count(*) FILTER (WHERE processing_status = 'RECEIVED')::text AS received,
           count(*) FILTER (WHERE processing_status = 'PROCESSING')::text AS processing,
           count(*) FILTER (WHERE processing_status = 'REVIEW_REQUIRED')::text AS review_required,
           count(*) FILTER (WHERE processing_status = 'FAILED')::text AS failed,
           count(*) FILTER (
             WHERE processing_status = 'PROCESSING'
               AND processing_started_at IS NOT NULL
               AND processing_started_at <
                 now() - ($1::int * interval '1 second')
           )::text AS stale_processing,
           count(*) FILTER (
             WHERE processing_status = 'PROCESSED'
               AND processed_at >=
                 now() - ($2::int * interval '1 hour')
           )::text AS processed_recent
         FROM saas_billing_webhook_events`,
        [webhookStaleAfterSeconds, recentHours]
      ),
      this.db.query<
        QueryResultRow & {
          settings: string;
          audit_recent: string;
        }
      >(
        `SELECT
           (SELECT count(*)::text FROM system_settings) AS settings,
           (
             SELECT count(*)::text
             FROM platform_audit_events
             WHERE occurred_at >=
               now() - ($1::int * interval '1 hour')
           ) AS audit_recent`,
        [recentHours]
      ),
      this.db.query<
        QueryResultRow & {
          id: string;
          name: string;
          slug: string;
          active_rooms: string;
          current_leases: string;
        }
      >(
        `SELECT
           o.id::text,
           o.name,
           o.slug,
           count(DISTINCT r.id) FILTER (
             WHERE r.is_active = true
           )::text AS active_rooms,
           count(DISTINCT l.id) FILTER (
             WHERE l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
           )::text AS current_leases
         FROM organizations o
         LEFT JOIN rooms r
           ON r.organization_id = o.id
         LEFT JOIN leases l
           ON l.organization_id = o.id
          AND l.room_id = r.id
         GROUP BY o.id, o.name, o.slug
         ORDER BY
           count(DISTINCT r.id) FILTER (WHERE r.is_active = true) DESC,
           o.name
         LIMIT 5`
      ),
      this.db.query<
        QueryResultRow & {
          plan_code: string;
          plan_name: string;
          subscriptions: string;
        }
      >(
        `SELECT
           p.code AS plan_code,
           p.name AS plan_name,
           count(s.id)::text AS subscriptions
         FROM saas_plans p
         LEFT JOIN organization_subscriptions s
           ON s.plan_id = p.id
          AND s.status <> 'CANCELLED'
         WHERE p.status = 'ACTIVE'
         GROUP BY p.code, p.name
         ORDER BY count(s.id) DESC, p.code`
      )
    ]);

    const org = organizationStats.rows[0]!;
    const assets = assetStats.rows[0]!;
    const commercial = commercialStats.rows[0]!;
    const notifications = notificationStats.rows[0]!;
    const workers = workerStats.rows[0]!;
    const webhooks = webhookStats.rows[0]!;
    const platform = platformStats.rows[0]!;

    const activeRooms = Number(assets.active_rooms ?? 0);
    const occupiedRooms = Number(assets.occupied_rooms ?? 0);
    const vacantRooms = Math.max(0, activeRooms - occupiedRooms);
    const occupancyRatePercent =
      activeRooms === 0
        ? 0
        : Math.round((occupiedRooms / activeRooms) * 1000) / 10;
    const billingReadable = platformRoleHasPermission(
      principal.role,
      "platform.billing.read"
    );
    const delinquentOrganizationCount =
      Number(commercial.past_due ?? 0) +
      Number(commercial.grace_period ?? 0) +
      Number(commercial.suspended ?? 0);

    const branding = {
      productName: stringSetting("brand_product_name", "Habi"),
      descriptor: stringSetting(
        "brand_product_descriptor",
        "SaaS vận hành nhà cho thuê"
      ),
      tagline: stringSetting(
        "brand_tagline",
        "Nhà gọn. Việc trôi."
      ),
      palette: jsonSetting("brand_palette", {
        navy: "#25355C",
        teal: "#35C6A8",
        amber: "#FFB36B",
        background: "#F7FAF9",
        surface: "#FFFFFF"
      })
    };
    const display = {
      locale: stringSetting("display_locale", "vi-VN"),
      timezone: stringSetting(
        "display_timezone",
        "Asia/Ho_Chi_Minh"
      ),
      currencyCode: stringSetting(
        "display_currency_code",
        "VND"
      ),
      dateFormat: stringSetting(
        "display_date_format",
        "dd/MM/yyyy"
      ),
      dateTimeFormat: stringSetting(
        "display_datetime_format",
        "dd/MM/yyyy HH:mm"
      ),
      presets: jsonSetting("display_format_presets", {})
    };

    return {
      branding,
      display,
      windows: {
        leaseExpiryDays,
        recentHours,
        workerStaleAfterSeconds,
        webhookStaleAfterSeconds
      },
      organizations: {
        total: Number(org.total ?? 0),
        active: Number(org.active ?? 0),
        suspended: Number(org.suspended ?? 0),
        activeMemberships: Number(org.active_memberships ?? 0)
      },
      assets: {
        activeProperties: Number(assets.active_properties ?? 0),
        activeRooms,
        occupiedRooms,
        vacantRooms,
        occupancyRatePercent,
        activeResidents: Number(assets.active_residents ?? 0),
        activeLeases: Number(assets.active_leases ?? 0),
        terminationScheduledLeases: Number(
          assets.termination_scheduled_leases ?? 0
        ),
        expiringLeases: Number(assets.expiring_leases ?? 0)
      },
      commercial: {
        trialingSubscriptions: Number(commercial.trialing ?? 0),
        activeSubscriptions: Number(commercial.active ?? 0),
        pastDueSubscriptions: Number(commercial.past_due ?? 0),
        gracePeriodSubscriptions: Number(
          commercial.grace_period ?? 0
        ),
        suspendedSubscriptions: Number(
          commercial.suspended ?? 0
        ),
        cancelledSubscriptions: Number(
          commercial.cancelled ?? 0
        ),
        cancelAtPeriodEndSubscriptions: Number(
          commercial.cancel_at_period_end ?? 0
        ),
        delinquentOrganizationCount: billingReadable
          ? delinquentOrganizationCount
          : null,
        unpaidInvoiceCount: billingReadable
          ? Number(commercial.unpaid_invoice_count ?? 0)
          : null,
        overdueInvoiceCount: billingReadable
          ? Number(commercial.overdue_invoice_count ?? 0)
          : null,
        outstandingVnd: billingReadable
          ? Number(commercial.outstanding_vnd ?? 0)
          : null,
        overdueVnd: billingReadable
          ? Number(commercial.overdue_vnd ?? 0)
          : null,
        successfulPaymentCountRecent: billingReadable
          ? Number(commercial.successful_payment_count ?? 0)
          : null,
        successfulPaymentVndRecent: billingReadable
          ? Number(commercial.successful_payment_vnd ?? 0)
          : null,
        activePlans: Number(commercial.active_plans ?? 0)
      },
      automation: {
        queuedJobs: Number(notifications.queued ?? 0),
        runningJobs: Number(notifications.running ?? 0),
        retryWaitJobs: Number(notifications.retry_wait ?? 0),
        manualReviewJobs: Number(
          notifications.manual_review ?? 0
        ),
        failedJobs: Number(notifications.failed ?? 0),
        sentJobsRecent: Number(notifications.sent_recent ?? 0),
        healthyWorkers: Number(workers.healthy ?? 0),
        degradedWorkers: Number(workers.degraded ?? 0),
        staleWorkers: Number(workers.stale ?? 0),
        pausedProviders: Number(workers.paused_providers ?? 0),
        webhookReceived: Number(webhooks.received ?? 0),
        webhookProcessing: Number(webhooks.processing ?? 0),
        webhookReviewRequired: Number(
          webhooks.review_required ?? 0
        ),
        webhookFailed: Number(webhooks.failed ?? 0),
        webhookStaleProcessing: Number(
          webhooks.stale_processing ?? 0
        ),
        webhookProcessedRecent: Number(
          webhooks.processed_recent ?? 0
        )
      },
      platform: {
        settingCount: Number(platform.settings ?? 0),
        auditRecent: Number(platform.audit_recent ?? 0)
      },
      topOrganizations: topOrganizations.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        activeRooms: Number(row.active_rooms ?? 0),
        currentLeases: Number(row.current_leases ?? 0)
      })),
      planDistribution: planDistribution.rows.map((row) => ({
        planCode: row.plan_code,
        planName: row.plan_name,
        subscriptions: Number(row.subscriptions ?? 0)
      })),

      // Backward-compatible fields while CMS consumers migrate.
      organizationCount: Number(org.total ?? 0),
      activeRoomCount: activeRooms,
      settingCount: Number(platform.settings ?? 0),
      activePlanCount: Number(commercial.active_plans ?? 0),
      platformAudit24h: Number(platform.audit_recent ?? 0),
      delinquentOrganizationCount: billingReadable
        ? delinquentOrganizationCount
        : null,
      unpaidInvoiceCount: billingReadable
        ? Number(commercial.unpaid_invoice_count ?? 0)
        : null,
      overdueInvoiceCount: billingReadable
        ? Number(commercial.overdue_invoice_count ?? 0)
        : null,
      outstandingVnd: billingReadable
        ? Number(commercial.outstanding_vnd ?? 0)
        : null,
      overdueVnd: billingReadable
        ? Number(commercial.overdue_vnd ?? 0)
        : null
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

    return this.db.withTransaction(async (client) => {
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

    if (input.effectiveAt !== undefined) {
      const effectiveAt = new Date(input.effectiveAt);
      if (Number.isNaN(effectiveAt.getTime())) {
        throw new BadRequestException("effectiveAt must be a valid date-time.");
      }
      if (effectiveAt.getTime() > Date.now()) {
        throw new BadRequestException(
          "Future plan activation is not supported until scheduled commercial changes are implemented."
        );
      }
    }

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

    return this.db.withTransaction(async (client) => {
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
         s.version AS subscription_version,
         s.billing_interval,
         s.current_period_start,
         s.current_period_end,
         s.trial_ends_at,
         s.cancel_at_period_end AS subscription_cancel_at_period_end,
         p.code AS plan_code,
         billing_invoice.id::text AS latest_invoice_id,
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
         COALESCE(automation_override.value, pv.automation_quota) AS automation_quota,
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
         COALESCE(automation_usage.reserved_actions, 0)::int AS automation_reserved,
         COALESCE(automation_usage.consumed_actions, 0)::int AS automation_consumed
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
           AND timezone(quota_timezone.timezone, now())::date >= aqp.period_start
           AND timezone(quota_timezone.timezone, now())::date < aqp.period_end
         ORDER BY aqp.period_start DESC
         LIMIT 1
       ) automation_usage ON true
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
      subscriptionVersion: row.subscription_version,
      billingInterval: row.billing_interval,
      currentPeriodStart:
        row.current_period_start?.toISOString() ?? null,
      currentPeriodEnd:
        row.current_period_end?.toISOString() ?? null,
      trialEndsAt: row.trial_ends_at?.toISOString() ?? null,
      cancelAtPeriodEnd:
        row.subscription_cancel_at_period_end ?? null,
      planCode: row.plan_code,
      latestInvoice:
        row.latest_invoice_id === null
          ? null
          : {
              id: row.latest_invoice_id,
              status: row.latest_invoice_status,
              amountVnd: Number(row.latest_invoice_amount_vnd),
              paidAmountVnd: Number(
                row.latest_invoice_paid_amount_vnd
              ),
              remainingAmountVnd: Number(
                row.latest_invoice_remaining_amount_vnd
              ),
              isOverdue: row.latest_invoice_is_overdue ?? false,
              dueAt:
                row.latest_invoice_due_at?.toISOString() ?? null,
              paidAt:
                row.latest_invoice_paid_at?.toISOString() ?? null,
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
      automationReserved: row.automation_reserved
    }));
  }

  async provisionSubscription(
    principal: PlatformPrincipal,
    organizationId: string,
    input: ProvisionSubscriptionInput,
    idempotencyKey: string | undefined
  ) {
    this.requirePermission(principal, "platform.subscriptions.manage");
    const reason = this.requireReason(input.reason);
    const commandKey = this.requireIdempotencyKey(idempotencyKey);
    const planCode = input.planCode?.trim() ?? "";
    const status = input.status;
    const billingInterval = input.billingInterval ?? "MONTHLY";

    if (planCode.length === 0) {
      throw new BadRequestException("planCode is required.");
    }
    if (status !== "TRIALING" && status !== "ACTIVE") {
      throw new BadRequestException(
        "Initial subscription status must be TRIALING or ACTIVE."
      );
    }
    if (
      billingInterval !== "MONTHLY" &&
      billingInterval !== "YEARLY"
    ) {
      throw new BadRequestException(
        "billingInterval must be MONTHLY or YEARLY."
      );
    }

    const fingerprint = this.fingerprint({
      action: "SUBSCRIPTION_PROVISIONED",
      organizationId,
      planCode,
      status,
      billingInterval,
      trialEndsAt: input.trialEndsAt ?? null,
      reason
    });

    return this.db.withTransaction(async (client) => {
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

      try {
        const response = await this.subscriptionManagement.provision(client, {
          organizationId,
          planCode,
          status,
          billingInterval,
          trialEndsAt: input.trialEndsAt ?? null
        });

        await this.insertAudit(client, {
          actorUserId: principal.userId,
          action: "SUBSCRIPTION_PROVISIONED",
          targetType: "ORGANIZATION_SUBSCRIPTION",
          targetKey: organizationId,
          organizationId,
          beforeState: {},
          afterState: response,
          reason
        });
        await this.insertReceipt(
          client,
          principal.userId,
          commandKey,
          "SUBSCRIPTION_PROVISIONED",
          fingerprint,
          response
        );
        return response;
      } catch (error) {
        this.rethrowSubscriptionError(error);
      }
    });
  }

  async transitionSubscription(
    principal: PlatformPrincipal,
    organizationId: string,
    input: TransitionSubscriptionInput,
    idempotencyKey: string | undefined
  ) {
    this.requirePermission(principal, "platform.subscriptions.manage");
    const reason = this.requireReason(input.reason);
    const commandKey = this.requireIdempotencyKey(idempotencyKey);
    const to = input.to;
    const expectedVersion = input.expectedVersion;

    if (
      to !== "TRIALING" &&
      to !== "ACTIVE" &&
      to !== "PAST_DUE" &&
      to !== "GRACE_PERIOD" &&
      to !== "SUSPENDED" &&
      to !== "CANCELLED"
    ) {
      throw new BadRequestException("A valid target subscription status is required.");
    }
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
      throw new BadRequestException("expectedVersion must be a positive integer.");
    }

    const fingerprint = this.fingerprint({
      action: "SUBSCRIPTION_STATUS_CHANGED",
      organizationId,
      to,
      expectedVersion,
      reason
    });

    return this.db.withTransaction(async (client) => {
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

      try {
        const transition = await this.subscriptionManagement.transition(
          client,
          {
            organizationId,
            to,
            expectedVersion: Number(expectedVersion),
            reason
          }
        );

        await this.insertAudit(client, {
          actorUserId: principal.userId,
          action: "SUBSCRIPTION_STATUS_CHANGED",
          targetType: "ORGANIZATION_SUBSCRIPTION",
          targetKey: organizationId,
          organizationId,
          beforeState: transition.before,
          afterState: transition.after,
          reason
        });
        await this.insertReceipt(
          client,
          principal.userId,
          commandKey,
          "SUBSCRIPTION_STATUS_CHANGED",
          fingerprint,
          transition.after
        );
        return transition.after;
      } catch (error) {
        this.rethrowSubscriptionError(error);
      }
    });
  }

  async changeSubscriptionPlan(
    principal: PlatformPrincipal,
    organizationId: string,
    input: ChangeSubscriptionPlanInput,
    idempotencyKey: string | undefined
  ) {
    this.requirePermission(principal, "platform.subscriptions.manage");
    const reason = this.requireReason(input.reason);
    const commandKey = this.requireIdempotencyKey(idempotencyKey);
    const targetPlanCode = input.targetPlanCode?.trim() ?? "";
    const expectedVersion = input.expectedVersion;

    if (targetPlanCode.length === 0) {
      throw new BadRequestException("targetPlanCode is required.");
    }
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
      throw new BadRequestException("expectedVersion must be a positive integer.");
    }

    const fingerprint = this.fingerprint({
      action: "SUBSCRIPTION_PLAN_CHANGED",
      organizationId,
      targetPlanCode,
      expectedVersion,
      reason
    });

    return this.db.withTransaction(async (client) => {
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

      try {
        const change = await this.subscriptionManagement.changePlan(client, {
          organizationId,
          targetPlanCode,
          expectedVersion: Number(expectedVersion)
        });

        await this.insertAudit(client, {
          actorUserId: principal.userId,
          action: "SUBSCRIPTION_PLAN_CHANGED",
          targetType: "ORGANIZATION_SUBSCRIPTION",
          targetKey: organizationId,
          organizationId,
          beforeState: change.before,
          afterState: change.after,
          reason
        });
        await this.insertReceipt(
          client,
          principal.userId,
          commandKey,
          "SUBSCRIPTION_PLAN_CHANGED",
          fingerprint,
          change.after
        );
        return change.after;
      } catch (error) {
        this.rethrowSubscriptionError(error);
      }
    });
  }

  async setSubscriptionCancellation(
    principal: PlatformPrincipal,
    organizationId: string,
    input: SetSubscriptionCancellationInput,
    idempotencyKey: string | undefined
  ): Promise<SubscriptionCancellationScheduleView> {
    this.requirePermission(principal, "platform.subscriptions.manage");
    const reason = this.requireReason(input.reason);
    const commandKey = this.requireIdempotencyKey(idempotencyKey);
    const expectedVersion = input.expectedVersion;
    const cancelAtPeriodEnd = input.cancelAtPeriodEnd;

    if (typeof cancelAtPeriodEnd !== "boolean") {
      throw new BadRequestException(
        "cancelAtPeriodEnd must be boolean."
      );
    }
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
      throw new BadRequestException(
        "expectedVersion must be a positive integer."
      );
    }

    const fingerprint = this.fingerprint({
      action: cancelAtPeriodEnd
        ? "SUBSCRIPTION_CANCELLATION_SCHEDULED"
        : "SUBSCRIPTION_CANCELLATION_SCHEDULE_REVOKED",
      organizationId,
      cancelAtPeriodEnd,
      expectedVersion,
      reason
    });

    return this.db.withTransaction(async (client) => {
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
        return receipt.response as SubscriptionCancellationScheduleView;
      }

      try {
        const result =
          await this.subscriptionBilling.setCancellationScheduleInTransaction(
            client,
            {
              organizationId,
              cancelAtPeriodEnd,
              expectedVersion: Number(expectedVersion),
              reason
            }
          );

        await this.insertAudit(client, {
          actorUserId: principal.userId,
          action: cancelAtPeriodEnd
            ? "SUBSCRIPTION_CANCELLATION_SCHEDULED"
            : "SUBSCRIPTION_CANCELLATION_SCHEDULE_REVOKED",
          targetType: "ORGANIZATION_SUBSCRIPTION",
          targetKey: organizationId,
          organizationId,
          beforeState: {
            expectedVersion,
            cancelAtPeriodEnd: !cancelAtPeriodEnd
          },
          afterState: result,
          reason
        });
        await this.insertReceipt(
          client,
          principal.userId,
          commandKey,
          cancelAtPeriodEnd
            ? "SUBSCRIPTION_CANCELLATION_SCHEDULED"
            : "SUBSCRIPTION_CANCELLATION_SCHEDULE_REVOKED",
          fingerprint,
          result
        );

        return result;
      } catch (error) {
        if (error instanceof SubscriptionBillingConflictError) {
          throw new ConflictException(error.message);
        }
        if (error instanceof SubscriptionBillingNotFoundError) {
          throw new NotFoundException(error.message);
        }
        throw error;
      }
    });
  }

  async recordSubscriptionPayment(
    principal: PlatformPrincipal,
    organizationId: string,
    input: RecordSubscriptionPaymentInput,
    idempotencyKey: string | undefined
  ): Promise<BillingSettlementView> {
    this.requirePermission(principal, "platform.billing.manage");
    const reason = this.requireReason(input.reason);
    const commandKey = this.requireIdempotencyKey(idempotencyKey);
    const invoiceId = input.invoiceId?.trim() ?? "";
    const amountVnd = input.amountVnd;

    if (!invoiceId) {
      throw new BadRequestException("invoiceId is required.");
    }
    if (!Number.isInteger(amountVnd) || Number(amountVnd) <= 0) {
      throw new BadRequestException(
        "amountVnd must be a positive integer VND amount."
      );
    }

    const fingerprint = this.fingerprint({
      action: "SUBSCRIPTION_PAYMENT_RECORDED_MANUALLY",
      organizationId,
      invoiceId,
      amountVnd,
      reason
    });

    return this.db.withTransaction(async (client) => {
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
        return receipt.response as BillingSettlementView;
      }

      try {
        const settlement =
          await this.subscriptionBilling.recordManualPaymentInTransaction(
            client,
            {
              organizationId,
              invoiceId,
              amountVnd: Number(amountVnd),
              idempotencyKey:
                "cms-manual-" +
                this.fingerprint({
                  actorUserId: principal.userId,
                  commandKey
                }),
              recordedByUserId: principal.userId,
              reason,
              metadata: {
                reason,
                source: "CMS"
              }
            }
          );

        await this.insertAudit(client, {
          actorUserId: principal.userId,
          action: "SUBSCRIPTION_PAYMENT_RECORDED_MANUALLY",
          targetType: "SAAS_SUBSCRIPTION_INVOICE",
          targetKey: invoiceId,
          organizationId,
          beforeState: {
            invoiceId,
            amountVnd,
            requestedBy: principal.userId
          },
          afterState: settlement,
          reason
        });
        await this.insertReceipt(
          client,
          principal.userId,
          commandKey,
          "SUBSCRIPTION_PAYMENT_RECORDED_MANUALLY",
          fingerprint,
          settlement
        );
        return settlement;
      } catch (error) {
        if (error instanceof SubscriptionBillingNotFoundError) {
          throw new NotFoundException(error.message);
        }
        if (error instanceof SubscriptionBillingConflictError) {
          throw new ConflictException(error.message);
        }
        throw error;
      }
    });
  }

  async searchProviderPayments(
    principal: PlatformPrincipal,
    input: {
      query?: string;
      provider?: string;
      reconciliationStatus?: string;
      limit?: number;
      cursor?: string;
    }
  ) {
    this.requirePermission(principal, "platform.billing.read");

    const query = input.query?.trim() || undefined;
    const provider = input.provider?.trim() || undefined;
    const cursor = input.cursor?.trim() || undefined;
    const limit = input.limit ?? 50;
    const reconciliationStatus =
      input.reconciliationStatus?.trim() || undefined;

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException(
        "limit must be an integer between 1 and 100."
      );
    }
    if (query && query.length > 200) {
      throw new BadRequestException("query is too long.");
    }
    if (provider && provider.length > 100) {
      throw new BadRequestException("provider is too long.");
    }
    if (cursor && cursor.length > 1000) {
      throw new BadRequestException("cursor is too long.");
    }
    if (
      reconciliationStatus !== undefined &&
      reconciliationStatus !== "UNALLOCATED" &&
      reconciliationStatus !== "ALLOCATED" &&
      reconciliationStatus !== "REVIEW_REQUIRED"
    ) {
      throw new BadRequestException(
        "Invalid reconciliationStatus."
      );
    }

    try {
      return await this.subscriptionBilling.searchProviderPayments({
        query,
        provider,
        reconciliationStatus,
        limit,
        cursor
      });
    } catch (error) {
      if (error instanceof SubscriptionBillingConflictError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async getProviderPaymentDetail(
    principal: PlatformPrincipal,
    paymentId: string
  ) {
    this.requirePermission(principal, "platform.billing.read");

    try {
      return await this.subscriptionBilling.getProviderPaymentDetail(
        paymentId
      );
    } catch (error) {
      if (error instanceof SubscriptionBillingNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof SubscriptionBillingConflictError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async getBillingReconciliation(principal: PlatformPrincipal) {
    this.requirePermission(principal, "platform.billing.read");

    const [
      reviewPayments,
      invoices,
      webhookEvents,
      webhookSummary
    ] = await Promise.all([
      this.subscriptionBilling.listProviderPaymentReviews(),
      this.subscriptionBilling.listReconciliationInvoices(),
      this.db.query<BillingWebhookRow>(
        `WITH timeout_config AS (
           SELECT (value #>> '{}')::int AS timeout_seconds
           FROM system_settings
           WHERE key = 'billing_webhook_processing_timeout_seconds'
         )
         SELECT
           e.id::text,
           e.provider,
           e.provider_event_id,
           e.signature_status,
           e.processing_status,
           e.processing_attempts,
           e.received_at,
           e.processing_started_at,
           e.processed_at,
           e.last_error_code,
           e.last_error_message,
           e.payment_id::text,
           (
             e.processing_status = 'PROCESSING'
             AND e.processing_started_at IS NOT NULL
             AND e.processing_started_at <=
               now() - make_interval(
                 secs => timeout_config.timeout_seconds
               )
           ) AS is_stale
         FROM saas_billing_webhook_events e
         CROSS JOIN timeout_config
         WHERE e.processing_status IN (
           'RECEIVED',
           'PROCESSING',
           'REVIEW_REQUIRED',
           'FAILED'
         )
         ORDER BY e.received_at DESC, e.id DESC
         LIMIT 100`
      ),
      this.db.query<BillingWebhookSummaryRow>(
        `WITH timeout_config AS (
           SELECT (value #>> '{}')::int AS timeout_seconds
           FROM system_settings
           WHERE key = 'billing_webhook_processing_timeout_seconds'
         )
         SELECT
           count(*) FILTER (
             WHERE processing_status = 'RECEIVED'
           )::text AS received_count,
           count(*) FILTER (
             WHERE processing_status = 'PROCESSING'
           )::text AS processing_count,
           count(*) FILTER (
             WHERE processing_status = 'REVIEW_REQUIRED'
           )::text AS review_required_count,
           count(*) FILTER (
             WHERE processing_status = 'FAILED'
           )::text AS failed_count,
           count(*) FILTER (
             WHERE processing_status = 'PROCESSING'
               AND processing_started_at IS NOT NULL
               AND processing_started_at <=
                 now() - make_interval(
                   secs => timeout_config.timeout_seconds
                 )
           )::text AS stale_processing_count,
           count(*) FILTER (
             WHERE processing_status = 'PROCESSED'
               AND processed_at >= now() - interval '24 hours'
           )::text AS processed_24h_count
         FROM saas_billing_webhook_events
         CROSS JOIN timeout_config`
      )
    ]);

    const summary = webhookSummary.rows[0];

    return {
      reviewPayments,
      invoices,
      webhookInbox: {
        summary: {
          received: Number(summary?.received_count ?? 0),
          processing: Number(summary?.processing_count ?? 0),
          reviewRequired: Number(
            summary?.review_required_count ?? 0
          ),
          failed: Number(summary?.failed_count ?? 0),
          staleProcessing: Number(
            summary?.stale_processing_count ?? 0
          ),
          processed24h: Number(
            summary?.processed_24h_count ?? 0
          )
        },
        events: webhookEvents.rows.map((row) => ({
          id: row.id,
          provider: row.provider,
          providerEventId: row.provider_event_id,
          signatureStatus: row.signature_status,
          processingStatus: row.processing_status,
          processingAttempts: row.processing_attempts,
          receivedAt: row.received_at.toISOString(),
          processingStartedAt:
            row.processing_started_at?.toISOString() ?? null,
          processedAt: row.processed_at?.toISOString() ?? null,
          lastErrorCode: row.last_error_code,
          lastErrorMessage: row.last_error_message,
          paymentId: row.payment_id,
          isStale: row.is_stale
        }))
      }
    };
  }

  async allocateProviderPayment(
    principal: PlatformPrincipal,
    paymentId: string,
    input: AllocateProviderPaymentInput,
    idempotencyKey: string | undefined
  ): Promise<BillingSettlementView> {
    this.requirePermission(principal, "platform.billing.manage");
    const reason = this.requireReason(input.reason);
    const commandKey = this.requireIdempotencyKey(idempotencyKey);
    const invoiceId = input.invoiceId?.trim() ?? "";
    const amountVnd = input.amountVnd;

    if (!paymentId.trim()) {
      throw new BadRequestException("paymentId is required.");
    }
    if (!invoiceId) {
      throw new BadRequestException("invoiceId is required.");
    }
    if (!Number.isInteger(amountVnd) || Number(amountVnd) <= 0) {
      throw new BadRequestException(
        "amountVnd must be a positive integer VND amount."
      );
    }

    const fingerprint = this.fingerprint({
      action: "SUBSCRIPTION_PROVIDER_PAYMENT_RECONCILED_MANUALLY",
      paymentId,
      invoiceId,
      amountVnd,
      reason
    });

    return this.db.withTransaction(async (client) => {
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
        return receipt.response as BillingSettlementView;
      }

      try {
        const settlement =
          await this.subscriptionBilling.allocateProviderPaymentInTransaction(
            client,
            {
              paymentId,
              invoiceId,
              amountVnd: Number(amountVnd),
              allocatedByUserId: principal.userId,
              reason
            }
          );

        await this.insertAudit(client, {
          actorUserId: principal.userId,
          action: "SUBSCRIPTION_PROVIDER_PAYMENT_RECONCILED_MANUALLY",
          targetType: "SAAS_SUBSCRIPTION_PAYMENT",
          targetKey: paymentId,
          organizationId: settlement.invoice.organizationId,
          beforeState: {
            paymentId,
            invoiceId,
            amountVnd
          },
          afterState: settlement,
          reason
        });
        await this.insertReceipt(
          client,
          principal.userId,
          commandKey,
          "SUBSCRIPTION_PROVIDER_PAYMENT_RECONCILED_MANUALLY",
          fingerprint,
          settlement
        );
        return settlement;
      } catch (error) {
        if (error instanceof SubscriptionBillingNotFoundError) {
          throw new NotFoundException(error.message);
        }
        if (error instanceof SubscriptionBillingConflictError) {
          throw new ConflictException(error.message);
        }
        throw error;
      }
    });
  }

  async requeueBillingWebhook(
    principal: PlatformPrincipal,
    eventId: string,
    input: RequeueBillingWebhookInput,
    idempotencyKey: string | undefined
  ): Promise<SaasBillingWebhookEventView> {
    this.requirePermission(principal, "platform.billing.manage");
    const reason = this.requireReason(input.reason);
    const commandKey = this.requireIdempotencyKey(idempotencyKey);
    const normalizedEventId = eventId.trim();

    if (!normalizedEventId) {
      throw new BadRequestException("eventId is required.");
    }

    const fingerprint = this.fingerprint({
      action: "BILLING_WEBHOOK_REQUEUED",
      eventId: normalizedEventId,
      reason
    });

    return this.db.withTransaction(async (client) => {
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
        return receipt.response as SaasBillingWebhookEventView;
      }

      try {
        const requeue = await this.billingWebhookInbox.requeueInTransaction(
          client,
          normalizedEventId
        );

        await this.insertAudit(client, {
          actorUserId: principal.userId,
          action: "BILLING_WEBHOOK_REQUEUED",
          targetType: "SAAS_BILLING_WEBHOOK_EVENT",
          targetKey: normalizedEventId,
          organizationId: undefined,
          beforeState: requeue.before,
          afterState: requeue.after,
          reason
        });
        await this.insertReceipt(
          client,
          principal.userId,
          commandKey,
          "BILLING_WEBHOOK_REQUEUED",
          fingerprint,
          requeue.after
        );

        return requeue.after;
      } catch (error) {
        if (error instanceof BillingWebhookConflictError) {
          throw new ConflictException(error.message);
        }
        throw error;
      }
    });
  }

  async listEntitlementOverrides(principal: PlatformPrincipal) {
    this.requirePermission(principal, "platform.organizations.inspect");
    const result = await this.db.query<EntitlementOverrideRow>(
      `SELECT
         eo.id::text,
         eo.organization_id::text,
         o.name AS organization_name,
         eo.entitlement_key,
         eo.value,
         eo.expires_at,
         eo.reason,
         eo.created_at,
         u.display_name AS created_by_name,
         eo.revoked_at
       FROM organization_entitlement_overrides eo
       JOIN organizations o ON o.id = eo.organization_id
       LEFT JOIN users u ON u.id = eo.created_by_user_id
       WHERE eo.revoked_at IS NULL
         AND (eo.expires_at IS NULL OR eo.expires_at > now())
       ORDER BY o.name, eo.entitlement_key`
    );

    return result.rows.map((row) => this.mapEntitlementOverride(row));
  }

  async setEntitlementOverride(
    principal: PlatformPrincipal,
    organizationId: string,
    keyValue: string,
    input: UpdateEntitlementOverrideInput,
    idempotencyKey: string | undefined
  ) {
    this.requirePermission(principal, "platform.entitlements.manage");
    if (!isEntitlementKey(keyValue)) {
      throw new BadRequestException("Unknown entitlement key.");
    }

    const reason = this.requireReason(input.reason);
    const commandKey = this.requireIdempotencyKey(idempotencyKey);
    const expiresAt = input.expiresAt ?? null;

    try {
      validateEntitlementOverride({
        key: keyValue,
        value: input.value as EntitlementValue,
        expiresAt
      });
    } catch (error) {
      if (error instanceof InvalidEntitlementOverrideError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    if (expiresAt !== null && new Date(expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException("expiresAt must be in the future.");
    }

    const fingerprint = this.fingerprint({
      action: "ENTITLEMENT_OVERRIDE_SET",
      organizationId,
      key: keyValue,
      value: input.value,
      expiresAt,
      reason
    });

    return this.db.withTransaction(async (client) => {
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

      const organization = await client.query<QueryResultRow & { id: string }>(
        "SELECT id::text FROM organizations WHERE id = $1 FOR UPDATE",
        [organizationId]
      );
      if (!organization.rows[0]) {
        throw new NotFoundException("Organization was not found.");
      }

      const currentResult = await client.query<EntitlementOverrideRow>(
        `SELECT
           eo.id::text,
           eo.organization_id::text,
           o.name AS organization_name,
           eo.entitlement_key,
           eo.value,
           eo.expires_at,
           eo.reason,
           eo.created_at,
           u.display_name AS created_by_name,
           eo.revoked_at
         FROM organization_entitlement_overrides eo
         JOIN organizations o ON o.id = eo.organization_id
         LEFT JOIN users u ON u.id = eo.created_by_user_id
         WHERE eo.organization_id = $1
           AND eo.entitlement_key = $2
           AND eo.revoked_at IS NULL
         FOR UPDATE OF eo`,
        [organizationId, keyValue]
      );
      const current = currentResult.rows[0];

      if (current) {
        await client.query(
          `UPDATE organization_entitlement_overrides
           SET revoked_at = now(), revoked_by_user_id = $3
           WHERE organization_id = $1
             AND entitlement_key = $2
             AND revoked_at IS NULL`,
          [organizationId, keyValue, principal.userId]
        );
      }

      const inserted = await client.query<EntitlementOverrideRow>(
        `WITH inserted AS (
           INSERT INTO organization_entitlement_overrides (
             organization_id, entitlement_key, value, expires_at,
             reason, created_by_user_id
           )
           VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5, $6)
           RETURNING *
         )
         SELECT
           i.id::text,
           i.organization_id::text,
           o.name AS organization_name,
           i.entitlement_key,
           i.value,
           i.expires_at,
           i.reason,
           i.created_at,
           u.display_name AS created_by_name,
           i.revoked_at
         FROM inserted i
         JOIN organizations o ON o.id = i.organization_id
         LEFT JOIN users u ON u.id = i.created_by_user_id`,
        [
          organizationId,
          keyValue,
          JSON.stringify(input.value),
          expiresAt,
          reason,
          principal.userId
        ]
      );
      const response = this.mapEntitlementOverride(inserted.rows[0]!);

      await this.insertAudit(client, {
        actorUserId: principal.userId,
        action: "ENTITLEMENT_OVERRIDE_SET",
        targetType: "ENTITLEMENT_OVERRIDE",
        targetKey: organizationId + ":" + keyValue,
        organizationId,
        beforeState: current
          ? this.mapEntitlementOverride(current)
          : {},
        afterState: response,
        reason
      });
      await this.insertReceipt(
        client,
        principal.userId,
        commandKey,
        "ENTITLEMENT_OVERRIDE_SET",
        fingerprint,
        response
      );
      return response;
    });
  }

  async revokeEntitlementOverride(
    principal: PlatformPrincipal,
    organizationId: string,
    keyValue: string,
    input: RevokeEntitlementOverrideInput,
    idempotencyKey: string | undefined
  ) {
    this.requirePermission(principal, "platform.entitlements.manage");
    if (!isEntitlementKey(keyValue)) {
      throw new BadRequestException("Unknown entitlement key.");
    }

    const reason = this.requireReason(input.reason);
    const commandKey = this.requireIdempotencyKey(idempotencyKey);
    const fingerprint = this.fingerprint({
      action: "ENTITLEMENT_OVERRIDE_REVOKED",
      organizationId,
      key: keyValue,
      reason
    });

    return this.db.withTransaction(async (client) => {
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

      const currentResult = await client.query<EntitlementOverrideRow>(
        `SELECT
           eo.id::text,
           eo.organization_id::text,
           o.name AS organization_name,
           eo.entitlement_key,
           eo.value,
           eo.expires_at,
           eo.reason,
           eo.created_at,
           u.display_name AS created_by_name,
           eo.revoked_at
         FROM organization_entitlement_overrides eo
         JOIN organizations o ON o.id = eo.organization_id
         LEFT JOIN users u ON u.id = eo.created_by_user_id
         WHERE eo.organization_id = $1
           AND eo.entitlement_key = $2
           AND eo.revoked_at IS NULL
         FOR UPDATE OF eo`,
        [organizationId, keyValue]
      );
      const current = currentResult.rows[0];
      if (!current) {
        throw new NotFoundException("Active entitlement override was not found.");
      }

      await client.query(
        `UPDATE organization_entitlement_overrides
         SET revoked_at = now(), revoked_by_user_id = $3
         WHERE organization_id = $1
           AND entitlement_key = $2
           AND revoked_at IS NULL`,
        [organizationId, keyValue, principal.userId]
      );

      const response = {
        organizationId,
        key: keyValue,
        revoked: true
      };

      await this.insertAudit(client, {
        actorUserId: principal.userId,
        action: "ENTITLEMENT_OVERRIDE_REVOKED",
        targetType: "ENTITLEMENT_OVERRIDE",
        targetKey: organizationId + ":" + keyValue,
        organizationId,
        beforeState: this.mapEntitlementOverride(current),
        afterState: response,
        reason
      });
      await this.insertReceipt(
        client,
        principal.userId,
        commandKey,
        "ENTITLEMENT_OVERRIDE_REVOKED",
        fingerprint,
        response
      );
      return response;
    });
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

  async getJobsIntegrationStatus(principal: PlatformPrincipal) {
    this.requirePermission(principal, "platform.jobs.read");
    const [entries, providers, workers] = await Promise.all([
      this.notificationOperations.listJobs(),
      this.notificationOperations.listProviders(),
      this.notificationOperations.listWorkerHeartbeats()
    ]);
    return {
      connected: true,
      reason:
        "Durable notification jobs and provider worker health are connected.",
      entries,
      providers,
      workers
    };
  }

  async updateNotificationProviderControl(
    principal: PlatformPrincipal,
    providerValue: string,
    input: UpdateNotificationProviderControlInput,
    idempotencyKey: string | undefined
  ) {
    this.requirePermission(principal, "platform.jobs.manage");
    const reason = this.requireReason(input.reason);
    const commandKey = this.requireIdempotencyKey(idempotencyKey);
    const provider = providerValue.trim();
    const status = input.status;

    if (!provider) {
      throw new BadRequestException("Provider is required.");
    }
    if (status !== "ACTIVE" && status !== "PAUSED") {
      throw new BadRequestException(
        "Provider control status must be ACTIVE or PAUSED."
      );
    }

    const fingerprint = this.fingerprint({
      action: "NOTIFICATION_PROVIDER_CONTROL_UPDATED",
      provider,
      status,
      reason
    });

    return this.db.withTransaction(async (client) => {
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

      const change =
        await this.notificationOperations.setProviderControlInTransaction(
          client,
          {
            provider,
            status,
            reason,
            actorUserId: principal.userId
          }
        );

      await this.insertAudit(client, {
        actorUserId: principal.userId,
        action: "NOTIFICATION_PROVIDER_CONTROL_UPDATED",
        targetType: "NOTIFICATION_PROVIDER",
        targetKey: provider,
        beforeState: change.before,
        afterState: change.after,
        reason
      });
      await this.insertReceipt(
        client,
        principal.userId,
        commandKey,
        "NOTIFICATION_PROVIDER_CONTROL_UPDATED",
        fingerprint,
        change.after
      );
      return change.after;
    });
  }

  async retryJob(
    principal: PlatformPrincipal,
    jobId: string,
    input: RetryNotificationJobInput,
    idempotencyKey: string | undefined
  ) {
    this.requirePermission(principal, "platform.jobs.manage");
    const reason = this.requireReason(input.reason);
    const commandKey = this.requireIdempotencyKey(idempotencyKey);
    const fingerprint = this.fingerprint({
      action: "NOTIFICATION_JOB_RETRY_REQUESTED",
      jobId,
      reason
    });

    return this.db.withTransaction(async (client) => {
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

      try {
        const retry = await this.notificationOperations.retryJobInTransaction(
          client,
          jobId
        );

        await this.insertAudit(client, {
          actorUserId: principal.userId,
          action: "NOTIFICATION_JOB_RETRY_REQUESTED",
          targetType: "NOTIFICATION_JOB",
          targetKey: jobId,
          organizationId: retry.before.organizationId,
          beforeState: retry.before,
          afterState: retry.after,
          reason
        });
        await this.insertReceipt(
          client,
          principal.userId,
          commandKey,
          "NOTIFICATION_JOB_RETRY_REQUESTED",
          fingerprint,
          retry.after
        );
        return retry.after;
      } catch (error) {
        if (error instanceof NotificationJobRetryConflictError) {
          throw new ConflictException(error.message);
        }
        throw error;
      }
    });
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

  private rethrowSubscriptionError(error: unknown): never {
    if (
      error instanceof InvalidSubscriptionPlanChangeError ||
      error instanceof InvalidSubscriptionProvisioningError ||
      error instanceof InvalidSubscriptionTransitionError
    ) {
      throw new BadRequestException(error.message);
    }
    if (
      error instanceof SubscriptionNotFoundError ||
      error instanceof SubscriptionPlanNotFoundError
    ) {
      throw new NotFoundException(error.message);
    }
    if (
      error instanceof SubscriptionAlreadyExistsError ||
      error instanceof ConcurrentSubscriptionUpdateError
    ) {
      throw new ConflictException(error.message);
    }
    throw error;
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

  private mapEntitlementOverride(row: EntitlementOverrideRow) {
    return {
      id: row.id,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      key: row.entitlement_key,
      value: row.value,
      expiresAt: row.expires_at?.toISOString() ?? null,
      reason: row.reason,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by_name ?? "system"
    };
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
     ${whereClause}
     ORDER BY p.created_at, p.code
     ${lockClause}`;
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
