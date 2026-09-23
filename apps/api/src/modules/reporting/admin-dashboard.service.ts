import {
  ForbiddenException,
  Injectable
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import {
  CommercialPolicyService,
  CommercialSubscriptionNotFoundError
} from "../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../database/database.service.js";
import { roleHasPermission } from "../identity/domain/access-control.js";
import type { AdminPrincipal } from "./admin-dashboard.types.js";

type PropertyIdRow = QueryResultRow & {
  id: string;
};

type DashboardAggregateRow = QueryResultRow & {
  active_properties: string;
  active_rooms: string;
  occupied_rooms: string;
  active_residents: string;
  active_leases: string;
  termination_scheduled_leases: string;
  draft_leases: string;
  expiring_leases: string;
  contracted_monthly_rent_vnd: string;
  required_deposit_vnd: string;
};

type TopPropertyRow = QueryResultRow & {
  id: string;
  code: string;
  name: string;
  address_text: string | null;
  active_rooms: string;
  occupied_rooms: string;
  contracted_monthly_rent_vnd: string;
};

type ExpiringLeaseRow = QueryResultRow & {
  id: string;
  lease_code: string;
  planned_end_date: Date;
  days_remaining: number;
  property_id: string;
  property_name: string;
  room_id: string;
  room_code: string;
  room_name: string;
  primary_resident_name: string | null;
};

type SettingRow = QueryResultRow & {
  key: string;
  value: unknown;
};

@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async getDashboard(principal: AdminPrincipal) {
    if (
      !roleHasPermission(
        principal.membership.role,
        "report.read"
      )
    ) {
      throw new ForbiddenException(
        "Current membership cannot read organization reports."
      );
    }

    const hasOrganizationScope =
      principal.membership.scopes.some(
        (scope) => scope.type === "ORGANIZATION"
      );
    const propertyScopeIds =
      principal.membership.scopes.flatMap((scope) =>
        scope.type === "PROPERTY" ? [scope.propertyId] : []
      );
    const operationalGroupScopeIds =
      principal.membership.scopes.flatMap((scope) =>
        scope.type === "OPERATIONAL_GROUP"
          ? [scope.operationalGroupId]
          : []
      );

    const settingsResult = await this.db.query<SettingRow>(
      `SELECT key, value
       FROM system_settings
       WHERE key = ANY($1::text[])`,
      [[
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
        "dashboard_top_items_limit"
      ]]
    );
    const settings = new Map(
      settingsResult.rows.map((row) => [row.key, row.value])
    );
    const stringSetting = (key: string, fallback: string) => {
      const value = settings.get(key);
      return typeof value === "string" && value.trim()
        ? value
        : fallback;
    };
    const integerSetting = (key: string, fallback: number) => {
      const value = settings.get(key);
      return typeof value === "number" &&
        Number.isInteger(value) &&
        value > 0
        ? value
        : fallback;
    };
    const objectSetting = (
      key: string,
      fallback: Record<string, unknown>
    ) => {
      const value = settings.get(key);
      return typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : fallback;
    };

    const leaseExpiryDays = Math.min(
      integerSetting("dashboard_lease_expiry_days", 30),
      365
    );
    const topItemsLimit = Math.min(
      integerSetting("dashboard_top_items_limit", 5),
      20
    );

    const authorizedPropertyResult =
      await this.db.query<PropertyIdRow>(
        `SELECT DISTINCT p.id::text
         FROM properties p
         LEFT JOIN property_operational_groups pog
           ON pog.organization_id = p.organization_id
          AND pog.property_id = p.id
         WHERE p.organization_id = $1
           AND p.is_active = true
           AND (
             $2::boolean
             OR p.id = ANY($3::uuid[])
             OR pog.operational_group_id = ANY($4::uuid[])
           )
         ORDER BY p.id`,
        [
          principal.organizationId,
          hasOrganizationScope,
          propertyScopeIds,
          operationalGroupScopeIds
        ]
      );

    const propertyIds = authorizedPropertyResult.rows.map(
      (row) => row.id
    );

    const [aggregateResult, topPropertiesResult, expiringResult] =
      await Promise.all([
        this.db.query<DashboardAggregateRow>(
          `WITH authorized_rooms AS (
             SELECT r.id, r.property_id
             FROM rooms r
             WHERE r.organization_id = $1
               AND r.is_active = true
               AND r.property_id = ANY($2::uuid[])
           ),
           current_leases AS (
             SELECT l.*
             FROM leases l
             JOIN authorized_rooms ar ON ar.id = l.room_id
             WHERE l.organization_id = $1
               AND l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
           )
           SELECT
             (
               SELECT count(*)::text
               FROM properties p
               WHERE p.organization_id = $1
                 AND p.is_active = true
                 AND p.id = ANY($2::uuid[])
             ) AS active_properties,
             (
               SELECT count(*)::text
               FROM authorized_rooms
             ) AS active_rooms,
             (
               SELECT count(DISTINCT room_id)::text
               FROM current_leases
             ) AS occupied_rooms,
             (
               SELECT count(DISTINCT lr.resident_id)::text
               FROM current_leases cl
               JOIN lease_residents lr
                 ON lr.organization_id = cl.organization_id
                AND lr.lease_id = cl.id
               WHERE lr.left_on IS NULL
             ) AS active_residents,
             (
               SELECT count(*)::text
               FROM current_leases
               WHERE status = 'ACTIVE'
             ) AS active_leases,
             (
               SELECT count(*)::text
               FROM current_leases
               WHERE status = 'TERMINATION_SCHEDULED'
             ) AS termination_scheduled_leases,
             (
               SELECT count(*)::text
               FROM leases l
               JOIN authorized_rooms ar ON ar.id = l.room_id
               WHERE l.organization_id = $1
                 AND l.status = 'DRAFT'
             ) AS draft_leases,
             (
               SELECT count(*)::text
               FROM current_leases
               WHERE planned_end_date IS NOT NULL
                 AND planned_end_date BETWEEN current_date
                   AND current_date + $3::int
             ) AS expiring_leases,
             (
               SELECT COALESCE(sum(base_rent_vnd), 0)::text
               FROM current_leases
             ) AS contracted_monthly_rent_vnd,
             (
               SELECT COALESCE(sum(deposit_required_vnd), 0)::text
               FROM current_leases
             ) AS required_deposit_vnd`,
          [
            principal.organizationId,
            propertyIds,
            leaseExpiryDays
          ]
        ),
        this.db.query<TopPropertyRow>(
          `SELECT
             p.id::text,
             p.code,
             p.name,
             p.address_text,
             count(DISTINCT r.id) FILTER (
               WHERE r.is_active = true
             )::text AS active_rooms,
             count(DISTINCT l.room_id) FILTER (
               WHERE l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
             )::text AS occupied_rooms,
             COALESCE(
               sum(l.base_rent_vnd) FILTER (
                 WHERE l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
               ),
               0
             )::text AS contracted_monthly_rent_vnd
           FROM properties p
           LEFT JOIN rooms r
             ON r.organization_id = p.organization_id
            AND r.property_id = p.id
           LEFT JOIN leases l
             ON l.organization_id = r.organization_id
            AND l.room_id = r.id
           WHERE p.organization_id = $1
             AND p.is_active = true
             AND p.id = ANY($2::uuid[])
           GROUP BY p.id, p.code, p.name, p.address_text
           ORDER BY
             count(DISTINCT r.id) FILTER (
               WHERE r.is_active = true
             ) DESC,
             p.name
           LIMIT $3`,
          [
            principal.organizationId,
            propertyIds,
            topItemsLimit
          ]
        ),
        this.db.query<ExpiringLeaseRow>(
          `SELECT
             l.id::text,
             l.lease_code,
             l.planned_end_date,
             (l.planned_end_date - current_date)::int AS days_remaining,
             p.id::text AS property_id,
             p.name AS property_name,
             r.id::text AS room_id,
             r.code AS room_code,
             r.name AS room_name,
             resident.full_name AS primary_resident_name
           FROM leases l
           JOIN rooms r
             ON r.organization_id = l.organization_id
            AND r.id = l.room_id
           JOIN properties p
             ON p.organization_id = r.organization_id
            AND p.id = r.property_id
           LEFT JOIN lease_residents lr
             ON lr.organization_id = l.organization_id
            AND lr.lease_id = l.id
            AND lr.party_role = 'PRIMARY_TENANT'
            AND lr.left_on IS NULL
           LEFT JOIN residents resident
             ON resident.organization_id = lr.organization_id
            AND resident.id = lr.resident_id
           WHERE l.organization_id = $1
             AND r.property_id = ANY($2::uuid[])
             AND l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
             AND l.planned_end_date IS NOT NULL
             AND l.planned_end_date BETWEEN current_date
               AND current_date + $3::int
           ORDER BY l.planned_end_date, p.name, r.code
           LIMIT 10`,
          [
            principal.organizationId,
            propertyIds,
            leaseExpiryDays
          ]
        )
      ]);

    let subscription: {
      status: string;
      accessMode: string;
      planCode: string;
      roomLimit: number;
      staffLimit: number;
      automationQuota: number;
    } | null = null;

    if (hasOrganizationScope) {
      try {
        const policy = await this.db.withTransaction((client) =>
          this.commercialPolicy.loadPolicy(
            client,
            principal.organizationId
          )
        );
        subscription = {
          status: policy.subscriptionStatus,
          accessMode: policy.accessMode,
          planCode: policy.planCode,
          roomLimit: policy.entitlements.roomLimit,
          staffLimit: policy.entitlements.staffLimit,
          automationQuota:
            policy.entitlements.automationActionsMonthly
        };
      } catch (error) {
        if (!(error instanceof CommercialSubscriptionNotFoundError)) {
          throw error;
        }
      }
    }

    const row = aggregateResult.rows[0]!;
    const activeRooms = Number(row.active_rooms ?? 0);
    const occupiedRooms = Number(row.occupied_rooms ?? 0);
    const vacantRooms = Math.max(0, activeRooms - occupiedRooms);
    const occupancyRatePercent =
      activeRooms === 0
        ? 0
        : Math.round((occupiedRooms / activeRooms) * 1000) / 10;

    return {
      branding: {
        productName: stringSetting("brand_product_name", "Habi"),
        descriptor: stringSetting(
          "brand_product_descriptor",
          "SaaS vận hành nhà cho thuê"
        ),
        tagline: stringSetting(
          "brand_tagline",
          "Nhà gọn. Việc trôi."
        ),
        palette: objectSetting("brand_palette", {
          navy: "#25355C",
          teal: "#35C6A8",
          amber: "#FFB36B",
          background: "#F7FAF9",
          surface: "#FFFFFF"
        })
      },
      display: {
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
        presets: objectSetting("display_format_presets", {})
      },
      workspace: {
        id: principal.organizationId,
        name: principal.organizationName,
        slug: principal.organizationSlug,
        status: principal.organizationStatus,
        userDisplayName: principal.userDisplayName,
        role: principal.membership.role,
        scopeMode: hasOrganizationScope
          ? "ORGANIZATION"
          : "SCOPED",
        authorizedPropertyCount: propertyIds.length
      },
      windows: {
        leaseExpiryDays,
        topItemsLimit
      },
      subscription,
      metrics: {
        activeProperties: Number(row.active_properties ?? 0),
        activeRooms,
        occupiedRooms,
        vacantRooms,
        occupancyRatePercent,
        activeResidents: Number(row.active_residents ?? 0),
        activeLeases: Number(row.active_leases ?? 0),
        terminationScheduledLeases: Number(
          row.termination_scheduled_leases ?? 0
        ),
        draftLeases: Number(row.draft_leases ?? 0),
        expiringLeases: Number(row.expiring_leases ?? 0),
        contractedMonthlyRentVnd: Number(
          row.contracted_monthly_rent_vnd ?? 0
        ),
        requiredDepositVnd: Number(
          row.required_deposit_vnd ?? 0
        )
      },
      topProperties: topPropertiesResult.rows.map((item) => {
        const rooms = Number(item.active_rooms ?? 0);
        const occupied = Number(item.occupied_rooms ?? 0);
        return {
          id: item.id,
          code: item.code,
          name: item.name,
          addressText: item.address_text,
          activeRooms: rooms,
          occupiedRooms: occupied,
          vacantRooms: Math.max(0, rooms - occupied),
          occupancyRatePercent:
            rooms === 0
              ? 0
              : Math.round((occupied / rooms) * 1000) / 10,
          contractedMonthlyRentVnd: Number(
            item.contracted_monthly_rent_vnd ?? 0
          )
        };
      }),
      expiringLeases: expiringResult.rows.map((item) => ({
        id: item.id,
        leaseCode: item.lease_code,
        plannedEndDate:
          item.planned_end_date.toISOString().slice(0, 10),
        daysRemaining: item.days_remaining,
        propertyId: item.property_id,
        propertyName: item.property_name,
        roomId: item.room_id,
        roomCode: item.room_code,
        roomName: item.room_name,
        primaryResidentName: item.primary_resident_name
      }))
    };
  }
}
