import {
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import { roleHasPermission } from "../../identity/domain/access-control.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";

type PropertySummaryRow = QueryResultRow & {
  id: string;
  code: string;
  name: string;
  property_type: string;
  address_text: string | null;
  administrative_area_name: string | null;
  operational_group_ids: string[];
  floor_count: number;
  room_count: number;
  occupied_room_count: number;
};

type PropertyDetailRow = PropertySummaryRow;

type RoomDetailRow = QueryResultRow & {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  property_id: string;
  property_code: string;
  property_name: string;
  floor_id: string | null;
  floor_code: string | null;
  floor_name: string | null;
  operational_group_ids: string[];
  lease_id: string | null;
  lease_code: string | null;
  lease_status: string | null;
  lease_start_date: Date | string | null;
  lease_planned_end_date: Date | string | null;
  base_rent_vnd: string | null;
  deposit_required_vnd: string | null;
};

@Injectable()
export class AssetReadService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService
  ) {}

  async overview(principal: TenantPrincipal) {
    this.requirePropertyRead(principal);

    const result = await this.db.query<PropertySummaryRow>(
      `SELECT
         p.id::text,
         p.code,
         p.name,
         p.property_type,
         p.address_text,
         aa.name AS administrative_area_name,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids,
         count(DISTINCT f.id)::int AS floor_count,
         count(DISTINCT r.id)::int AS room_count,
         count(DISTINCT r.id) FILTER (
           WHERE l.id IS NOT NULL
         )::int AS occupied_room_count
       FROM properties p
       LEFT JOIN administrative_areas aa
         ON aa.id = p.administrative_area_id
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       LEFT JOIN floors f
         ON f.organization_id = p.organization_id
        AND f.property_id = p.id
        AND f.is_active = true
       LEFT JOIN rooms r
         ON r.organization_id = p.organization_id
        AND r.property_id = p.id
        AND r.is_active = true
       LEFT JOIN leases l
         ON l.organization_id = r.organization_id
        AND l.room_id = r.id
        AND l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
       WHERE p.organization_id = $1::uuid
         AND p.is_active = true
       GROUP BY
         p.id, p.code, p.name, p.property_type, p.address_text, aa.name
       ORDER BY p.name, p.id`,
      [principal.organizationId]
    );

    const properties = result.rows
      .filter((row) => this.canReadProperty(principal, row.id, row.operational_group_ids))
      .map((row) => this.mapProperty(row));

    return {
      organization: {
        id: principal.organizationId,
        name: principal.organizationName
      },
      principal: {
        role: principal.role
      },
      summary: {
        propertyCount: properties.length,
        floorCount: properties.reduce((sum, item) => sum + item.floors, 0),
        roomCount: properties.reduce((sum, item) => sum + item.rooms, 0),
        occupiedRoomCount: properties.reduce(
          (sum, item) => sum + item.occupiedRooms,
          0
        ),
        vacantRoomCount: properties.reduce(
          (sum, item) => sum + Math.max(0, item.rooms - item.occupiedRooms),
          0
        )
      },
      properties
    };
  }


  /**
   * Tenant-scoped operational dashboard. Property visibility comes from the
   * existing asset overview, so financial and notification totals cannot
   * accidentally include properties outside the caller's membership scope.
   */
  async dashboard(principal: TenantPrincipal) {
    const assets = await this.overview(principal);
    const propertyIds = assets.properties.map((property) => property.id);
    const canReadLeases = roleHasPermission(principal.role, "lease.read");
    const canReadBilling = roleHasPermission(principal.role, "billing.read");
    const canReadPayments = roleHasPermission(principal.role, "payment.read");
    const canReadNotifications = roleHasPermission(principal.role, "notification.read")
      && principal.membership.scopes.some((scope) => scope.type === "ORGANIZATION");

    type InvoiceRow = QueryResultRow & {
      property_id: string;
      billed_rooms: number;
      outstanding_vnd: string;
      overdue_rooms: number;
      review_invoices: number;
    };
    type PaidRow = QueryResultRow & {
      property_id: string;
      paid_vnd: string;
    };

    const emptyInvoices: InvoiceRow[] = [];
    const emptyPayments: PaidRow[] = [];
    const monthStart =
      "date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date";
    const dayToday = "(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date";

    const [
      newRoomsResult,
      invoicesResult,
      paymentsResult,
      leasesResult,
      notificationsResult
    ] = await Promise.all([
      propertyIds.length
        ? this.db.query<{ count: number }>(
            `SELECT count(*)::int AS count
             FROM rooms
             WHERE organization_id = $1::uuid
               AND property_id = ANY($2::uuid[])
               AND is_active = true
               AND created_at >= now() - interval '30 days'`,
            [principal.organizationId, propertyIds]
          )
        : Promise.resolve({ rows: [{ count: 0 }] }),
      propertyIds.length && canReadBilling
        ? this.db.query<InvoiceRow>(
            `SELECT
               property_id::text AS property_id,
               count(DISTINCT room_id) FILTER (
                 WHERE status = 'ISSUED'
                   AND period_start >= ${monthStart}
                   AND period_start < (${monthStart} + interval '1 month')::date
               )::int AS billed_rooms,
               COALESCE(sum(GREATEST(remaining_vnd, 0))
                 FILTER (WHERE status = 'ISSUED'), 0)::text AS outstanding_vnd,
               count(DISTINCT room_id) FILTER (
                 WHERE status = 'ISSUED'
                   AND remaining_vnd > 0
                   AND due_date < ${dayToday}
               )::int AS overdue_rooms,
               count(*) FILTER (
                 WHERE status <> 'VOID'
                   AND calculation_status = 'REVIEW_REQUIRED'
                   AND period_start >= ${monthStart}
                   AND period_start < (${monthStart} + interval '1 month')::date
               )::int AS review_invoices
             FROM renter_invoices
             WHERE organization_id = $1::uuid
               AND property_id = ANY($2::uuid[])
             GROUP BY property_id`,
            [principal.organizationId, propertyIds]
          )
        : Promise.resolve({ rows: emptyInvoices }),
      propertyIds.length && canReadPayments
        ? this.db.query<PaidRow>(
            `SELECT i.property_id::text AS property_id,
                    COALESCE(sum(a.amount_vnd), 0)::text AS paid_vnd
             FROM renter_payment_allocations a
             JOIN renter_invoices i
               ON i.id = a.invoice_id
              AND i.organization_id = a.organization_id
             JOIN renter_payment_transactions t
               ON t.id = a.payment_transaction_id
              AND t.organization_id = a.organization_id
             WHERE a.organization_id = $1::uuid
               AND i.property_id = ANY($2::uuid[])
               AND t.status = 'POSTED'
               AND t.occurred_at >= (${monthStart}::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
               AND t.occurred_at < ((${monthStart} + interval '1 month')::timestamp
                  AT TIME ZONE 'Asia/Ho_Chi_Minh')
             GROUP BY i.property_id`,
            [principal.organizationId, propertyIds]
          )
        : Promise.resolve({ rows: emptyPayments }),
      propertyIds.length && canReadLeases
        ? this.db.query<{ count: number }>(
            `SELECT count(DISTINCT l.id)::int AS count
             FROM leases l
             JOIN rooms r
               ON r.id = l.room_id AND r.organization_id = l.organization_id
              AND r.is_active = true
             WHERE l.organization_id = $1::uuid
               AND r.property_id = ANY($2::uuid[])
               AND l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
               AND l.planned_end_date >= ${dayToday}
               AND l.planned_end_date < (${dayToday} + interval '30 days')::date`,
            [principal.organizationId, propertyIds]
          )
        : Promise.resolve({ rows: [{ count: 0 }] }),
      canReadNotifications
        ? this.db.query<{ count: number }>(
            `SELECT count(*)::int AS count
             FROM notification_jobs
             WHERE organization_id = $1::uuid
               AND status IN ('FAILED', 'MANUAL_REVIEW')`,
            [principal.organizationId]
          )
        : Promise.resolve({ rows: [{ count: 0 }] })
    ]);

    const invoicesByProperty = new Map(
      invoicesResult.rows.map((row) => [row.property_id, row])
    );
    const paymentsByProperty = new Map(
      paymentsResult.rows.map((row) => [row.property_id, row])
    );

    const properties = assets.properties.map((property) => {
      const invoice = invoicesByProperty.get(property.id);
      const payment = paymentsByProperty.get(property.id);
      return {
        id: property.id,
        code: property.code,
        name: property.name,
        administrativeArea: property.administrativeArea,
        rooms: property.rooms,
        occupiedRooms: property.occupiedRooms,
        billedRooms: canReadBilling
          ? Math.min(property.occupiedRooms, invoice?.billed_rooms ?? 0) : null,
        outstandingVnd: canReadBilling
          ? Number(invoice?.outstanding_vnd ?? 0) : null,
        collectedThisMonthVnd: canReadPayments
          ? Number(payment?.paid_vnd ?? 0) : null,
        overdueRooms: canReadBilling ? invoice?.overdue_rooms ?? 0 : null,
        reviewInvoices: canReadBilling ? invoice?.review_invoices ?? 0 : null
      };
    });

    const sum = (field: "outstandingVnd" | "collectedThisMonthVnd"
      | "overdueRooms" | "reviewInvoices" | "billedRooms") =>
      properties.reduce((total, property) => total + (property[field] ?? 0), 0);

    const monthLabel = new Intl.DateTimeFormat("vi-VN", {
      month: "2-digit",
      year: "numeric",
      timeZone: "Asia/Ho_Chi_Minh"
    }).format(new Date());

    return {
      monthLabel,
      summary: {
        propertyCount: assets.summary.propertyCount,
        roomCount: assets.summary.roomCount,
        occupiedRoomCount: assets.summary.occupiedRoomCount,
        newRoomsLast30Days: newRoomsResult.rows[0]?.count ?? 0,
        collectedThisMonthVnd: canReadPayments
          ? sum("collectedThisMonthVnd") : null,
        outstandingVnd: canReadBilling ? sum("outstandingVnd") : null,
        overdueRooms: canReadBilling ? sum("overdueRooms") : null,
        expiringLeases: canReadLeases ? leasesResult.rows[0]?.count ?? 0 : null,
        failedNotifications: canReadNotifications
          ? notificationsResult.rows[0]?.count ?? 0 : null
      },
      billingProgress: {
        totalOccupiedRooms: assets.summary.occupiedRoomCount,
        billedRooms: canReadBilling ? sum("billedRooms") : null,
        reviewInvoices: canReadBilling ? sum("reviewInvoices") : null,
        overdueRooms: canReadBilling ? sum("overdueRooms") : null
      },
      properties
    };
  }

  async property(principal: TenantPrincipal, propertyId: string) {
    this.requirePropertyRead(principal);

    const propertyResult = await this.db.query<PropertyDetailRow>(
      `SELECT
         p.id::text,
         p.code,
         p.name,
         p.property_type,
         p.address_text,
         aa.name AS administrative_area_name,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids,
         count(DISTINCT f.id)::int AS floor_count,
         count(DISTINCT r.id)::int AS room_count,
         count(DISTINCT r.id) FILTER (
           WHERE l.id IS NOT NULL
         )::int AS occupied_room_count
       FROM properties p
       LEFT JOIN administrative_areas aa
         ON aa.id = p.administrative_area_id
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       LEFT JOIN floors f
         ON f.organization_id = p.organization_id
        AND f.property_id = p.id
        AND f.is_active = true
       LEFT JOIN rooms r
         ON r.organization_id = p.organization_id
        AND r.property_id = p.id
        AND r.is_active = true
       LEFT JOIN leases l
         ON l.organization_id = r.organization_id
        AND l.room_id = r.id
        AND l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
       WHERE p.organization_id = $1::uuid
         AND p.id = $2::uuid
         AND p.is_active = true
       GROUP BY
         p.id, p.code, p.name, p.property_type, p.address_text, aa.name
       LIMIT 1`,
      [principal.organizationId, propertyId]
    );

    const property = propertyResult.rows[0];
    if (!property) {
      throw new NotFoundException("Property was not found.");
    }
    if (
      !this.canReadProperty(
        principal,
        property.id,
        property.operational_group_ids
      )
    ) {
      throw new ForbiddenException("Property scope denied.");
    }

    const floorResult = await this.db.query<{
      id: string;
      code: string;
      name: string;
      sort_order: number;
    }>(
      `SELECT
         id::text,
         code,
         name,
         sort_order
       FROM floors
       WHERE organization_id = $1::uuid
         AND property_id = $2::uuid
         AND is_active = true
       ORDER BY
         sort_order,
         name,
         id`,
      [principal.organizationId, propertyId]
    );

    const roomResult = await this.db.query<{
      room_id: string;
      room_code: string;
      room_name: string;
      room_sort_order: number;
      floor_id: string | null;
      lease_id: string | null;
      lease_code: string | null;
      lease_status: string | null;
    }>(
      `SELECT
         r.id::text AS room_id,
         r.code AS room_code,
         r.name AS room_name,
         r.sort_order AS room_sort_order,
         r.floor_id::text AS floor_id,
         l.id::text AS lease_id,
         l.lease_code,
         l.status AS lease_status
       FROM rooms r
       LEFT JOIN leases l
         ON l.organization_id = r.organization_id
        AND l.room_id = r.id
        AND l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
       WHERE r.organization_id = $1::uuid
         AND r.property_id = $2::uuid
         AND r.is_active = true
       ORDER BY
         r.sort_order,
         r.code,
         r.id`,
      [principal.organizationId, propertyId]
    );

    const floorMap = new Map<
      string,
      {
        id: string | null;
        code: string;
        name: string;
        sortOrder: number;
        rooms: Array<{
          id: string;
          code: string;
          name: string;
          sortOrder: number;
          occupancy: "OCCUPIED" | "VACANT";
          lease: { id: string; code: string; status: string } | null;
        }>;
      }
    >();

    // 1. Initialize all active floors so empty floors are always visible
    for (const floor of floorResult.rows) {
      floorMap.set(floor.id, {
        id: floor.id,
        code: floor.code,
        name: floor.name,
        sortOrder: floor.sort_order,
        rooms: []
      });
    }

    // 2. Add rooms to their assigned floors or to the unassigned bucket
    for (const row of roomResult.rows) {
      const key =
        row.floor_id && floorMap.has(row.floor_id)
          ? row.floor_id
          : "__NO_FLOOR__";

      if (!floorMap.has(key)) {
        floorMap.set(key, {
          id: null,
          code: "CHƯA_GÁN",
          name: "Chưa gán tầng",
          sortOrder: Number.MAX_SAFE_INTEGER,
          rooms: []
        });
      }
      floorMap.get(key)!.rooms.push({
        id: row.room_id,
        code: row.room_code,
        name: row.room_name,
        sortOrder: row.room_sort_order,
        occupancy: row.lease_id ? "OCCUPIED" : "VACANT",
        lease:
          row.lease_id && row.lease_code && row.lease_status
            ? {
                id: row.lease_id,
                code: row.lease_code,
                status: row.lease_status
              }
            : null
      });
    }

    const floors = [...floorMap.values()].sort(
      (a, b) => a.sortOrder - b.sortOrder
    );

    return {
      organization: {
        id: principal.organizationId,
        name: principal.organizationName
      },
      property: this.mapProperty(property),
      floors
    };
  }

  async room(principal: TenantPrincipal, roomId: string) {
    this.requirePropertyRead(principal);

    const result = await this.db.query<RoomDetailRow>(
      `SELECT
         r.id::text,
         r.code,
         r.name,
         r.sort_order,
         p.id::text AS property_id,
         p.code AS property_code,
         p.name AS property_name,
         f.id::text AS floor_id,
         f.code AS floor_code,
         f.name AS floor_name,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids,
         l.id::text AS lease_id,
         l.lease_code,
         l.status AS lease_status,
         l.start_date AS lease_start_date,
         l.planned_end_date AS lease_planned_end_date,
         l.base_rent_vnd::text,
         l.deposit_required_vnd::text
       FROM rooms r
       JOIN properties p
         ON p.organization_id = r.organization_id
        AND p.id = r.property_id
       LEFT JOIN floors f
         ON f.organization_id = r.organization_id
        AND f.property_id = r.property_id
        AND f.id = r.floor_id
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       LEFT JOIN leases l
         ON l.organization_id = r.organization_id
        AND l.room_id = r.id
        AND l.status IN ('ACTIVE', 'TERMINATION_SCHEDULED')
       WHERE r.organization_id = $1::uuid
         AND r.id = $2::uuid
         AND r.is_active = true
         AND p.is_active = true
       GROUP BY
         r.id, r.code, r.name, r.sort_order,
         p.id, p.code, p.name,
         f.id, f.code, f.name,
         l.id, l.lease_code, l.status, l.start_date, l.planned_end_date,
         l.base_rent_vnd, l.deposit_required_vnd
       LIMIT 1`,
      [principal.organizationId, roomId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Room was not found.");
    }
    if (
      !this.canReadProperty(
        principal,
        row.property_id,
        row.operational_group_ids
      )
    ) {
      throw new ForbiddenException("Property scope denied.");
    }

    return {
      organization: {
        id: principal.organizationId,
        name: principal.organizationName
      },
      room: {
        id: row.id,
        code: row.code,
        name: row.name,
        sortOrder: row.sort_order,
        occupancy: row.lease_id ? "OCCUPIED" : "VACANT"
      },
      property: {
        id: row.property_id,
        code: row.property_code,
        name: row.property_name
      },
      floor: row.floor_id
        ? {
            id: row.floor_id,
            code: row.floor_code,
            name: row.floor_name
          }
        : null,
      currentLease:
        row.lease_id && row.lease_code && row.lease_status
          ? {
              id: row.lease_id,
              code: row.lease_code,
              status: row.lease_status,
              startDate: this.dateOnly(row.lease_start_date),
              plannedEndDate: this.dateOnly(row.lease_planned_end_date),
              baseRentVnd: Number(row.base_rent_vnd),
              depositRequiredVnd: Number(row.deposit_required_vnd)
            }
          : null
    };
  }

  private requirePropertyRead(principal: TenantPrincipal): void {
    if (!roleHasPermission(principal.role, "property.read")) {
      throw new ForbiddenException("Property read permission denied.");
    }
  }

  private canReadProperty(
    principal: TenantPrincipal,
    propertyId: string,
    operationalGroupIds: string[]
  ): boolean {
    return this.accessControl.can(principal.membership, "property.read", {
      organizationId: principal.organizationId,
      propertyId,
      operationalGroupIds
    });
  }

  private mapProperty(row: PropertySummaryRow) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.property_type,
      address: row.address_text,
      administrativeArea: row.administrative_area_name,
      floors: row.floor_count,
      rooms: row.room_count,
      occupiedRooms: row.occupied_room_count,
      vacantRooms: Math.max(0, row.room_count - row.occupied_room_count)
    };
  }

  private dateOnly(value: Date | string | null): string | null {
    if (!value) return null;
    return value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value.slice(0, 10);
  }
}
