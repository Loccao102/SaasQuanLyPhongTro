import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { CommercialPolicyService } from "../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import { roleHasPermission } from "../identity/domain/access-control.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";

export const pricingItemTypes = [
  "ELECTRICITY_PER_KWH",
  "WATER_PER_M3",
  "INTERNET",
  "PARKING",
  "TRASH",
  "CUSTOM"
] as const;

export type PricingItemType = (typeof pricingItemTypes)[number];

export type ResolvedPricingItem = {
  id: string;
  itemType: PricingItemType;
  description: string;
  unitPriceVnd: number;
  fixedQuantity: string;
  sortOrder: number;
};

export type ResolvedPricingPolicy = {
  id: string;
  name: string;
  propertyId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  items: ResolvedPricingItem[];
};

export interface CreatePricingPolicyInput {
  id: string;
  propertyId: string;
  name: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  items: Array<{
    id: string;
    itemType: PricingItemType;
    description: string;
    unitPriceVnd: number;
    fixedQuantity?: string | number;
    sortOrder?: number;
  }>;
}

type PolicyRow = QueryResultRow & {
  id: string;
  property_id: string;
  name: string;
  effective_from: Date | string;
  effective_to: Date | string | null;
};

type ItemRow = QueryResultRow & {
  id: string;
  policy_id: string;
  item_type: PricingItemType;
  description: string;
  unit_price_vnd: string;
  fixed_quantity: string;
  sort_order: number;
};

type PropertyScopeRow = QueryResultRow & {
  id: string;
  operational_group_ids: string[];
};

@Injectable()
export class PricingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async listForProperty(principal: TenantPrincipal, propertyId: string) {
    await this.requirePropertyRead(principal, propertyId);

    const [policies, items] = await Promise.all([
      this.db.query<PolicyRow>(
        `SELECT
           id::text,
           property_id::text,
           name,
           effective_from,
           effective_to
         FROM pricing_policies
         WHERE organization_id = $1::uuid
           AND property_id = $2::uuid
         ORDER BY effective_from DESC, id`,
        [principal.organizationId, propertyId]
      ),
      this.db.query<ItemRow>(
        `SELECT
           i.id::text,
           i.policy_id::text,
           i.item_type,
           i.description,
           i.unit_price_vnd::text,
           i.fixed_quantity::text,
           i.sort_order
         FROM pricing_policy_items i
         JOIN pricing_policies p
           ON p.organization_id = i.organization_id
          AND p.id = i.policy_id
         WHERE i.organization_id = $1::uuid
           AND p.property_id = $2::uuid
         ORDER BY p.effective_from DESC, i.sort_order, i.id`,
        [principal.organizationId, propertyId]
      )
    ]);

    const itemMap = new Map<string, ResolvedPricingItem[]>();
    for (const row of items.rows) {
      const bucket = itemMap.get(row.policy_id) ?? [];
      bucket.push(this.mapItem(row));
      itemMap.set(row.policy_id, bucket);
    }

    return {
      propertyId,
      policies: policies.rows.map((row) => this.mapPolicy(row, itemMap.get(row.id) ?? []))
    };
  }

  async createPolicy(
    principal: TenantPrincipal,
    input: CreatePricingPolicyInput
  ) {
    const name = this.required(input.name, "name");
    const effectiveFrom = this.isoDate(input.effectiveFrom, "effectiveFrom");
    const effectiveTo =
      input.effectiveTo === undefined ||
      input.effectiveTo === null ||
      input.effectiveTo === ""
        ? null
        : this.isoDate(input.effectiveTo, "effectiveTo");
    if (effectiveTo !== null && effectiveTo < effectiveFrom) {
      throw new ConflictException(
        "effectiveTo cannot be earlier than effectiveFrom."
      );
    }
    const items = this.normalizeItems(input.items);

    return this.db.withTransaction(async (client) => {
      await this.requirePropertyManage(client, principal, input.propertyId);
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const existing = await this.loadPolicy(
        client,
        principal.organizationId,
        input.id
      );
      if (existing) {
        const expected = {
          id: input.id,
          name,
          propertyId: input.propertyId,
          effectiveFrom,
          effectiveTo,
          items
        };
        if (JSON.stringify(this.normalizedPolicy(existing)) !== JSON.stringify(expected)) {
          throw new ConflictException(
            "Pricing policy id was already used with different data."
          );
        }
        return existing;
      }

      const overlap = await client.query(
        `SELECT id
         FROM pricing_policies
         WHERE organization_id = $1::uuid
           AND property_id = $2::uuid
           AND daterange(
             effective_from,
             COALESCE(effective_to, 'infinity'::date),
             '[]'
           ) && daterange(
             $3::date,
             COALESCE($4::date, 'infinity'::date),
             '[]'
           )
         LIMIT 1`,
        [
          principal.organizationId,
          input.propertyId,
          effectiveFrom,
          effectiveTo
        ]
      );
      if ((overlap.rowCount ?? 0) > 0) {
        throw new ConflictException(
          "Pricing policy effective range overlaps an existing policy."
        );
      }

      await client.query(
        `INSERT INTO pricing_policies (
           id,
           organization_id,
           property_id,
           name,
           effective_from,
           effective_to,
           created_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.id,
          principal.organizationId,
          input.propertyId,
          name,
          effectiveFrom,
          effectiveTo,
          principal.userId
        ]
      );

      for (const item of items) {
        await client.query(
          `INSERT INTO pricing_policy_items (
             id,
             organization_id,
             policy_id,
             item_type,
             description,
             unit_price_vnd,
             fixed_quantity,
             sort_order
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8)`,
          [
            item.id,
            principal.organizationId,
            input.id,
            item.itemType,
            item.description,
            item.unitPriceVnd,
            item.fixedQuantity,
            item.sortOrder
          ]
        );
      }

      await this.audit(
        client,
        principal,
        "PRICING_POLICY_CREATED",
        "PRICING_POLICY",
        input.id,
        {
          propertyId: input.propertyId,
          effectiveFrom,
          effectiveTo,
          itemCount: items.length
        }
      );

      return {
        id: input.id,
        name,
        propertyId: input.propertyId,
        effectiveFrom,
        effectiveTo,
        items
      };
    });
  }

  async resolvePolicy(
    client: PoolClient,
    organizationId: string,
    propertyId: string,
    periodStart: string,
    periodEnd: string
  ): Promise<ResolvedPricingPolicy | null> {
    const policies = await client.query<PolicyRow>(
      `SELECT
         id::text,
         property_id::text,
         name,
         effective_from,
         effective_to
       FROM pricing_policies
       WHERE organization_id = $1::uuid
         AND property_id = $2::uuid
         AND effective_from <= $3::date
         AND (effective_to IS NULL OR effective_to >= $4::date)
       ORDER BY effective_from DESC, id
       LIMIT 2`,
      [organizationId, propertyId, periodStart, periodEnd]
    );
    if (policies.rows.length === 0) return null;
    if (policies.rows.length > 1) {
      throw new ConflictException(
        "Multiple pricing policies cover the billing cycle."
      );
    }

    const policy = policies.rows[0]!;
    const items = await client.query<ItemRow>(
      `SELECT
         id::text,
         policy_id::text,
         item_type,
         description,
         unit_price_vnd::text,
         fixed_quantity::text,
         sort_order
       FROM pricing_policy_items
       WHERE organization_id = $1::uuid
         AND policy_id = $2::uuid
       ORDER BY sort_order, id`,
      [organizationId, policy.id]
    );

    return this.mapPolicy(policy, items.rows.map((row) => this.mapItem(row)));
  }

  private normalizeItems(
    rawItems: CreatePricingPolicyInput["items"]
  ): ResolvedPricingItem[] {
    const seenIds = new Set<string>();
    let electricityCount = 0;
    let waterCount = 0;

    return rawItems
      .map((item, index) => {
        if (seenIds.has(item.id)) {
          throw new ConflictException("Pricing item ids must be unique.");
        }
        seenIds.add(item.id);

        if (!pricingItemTypes.includes(item.itemType)) {
          throw new ConflictException(
            "Unsupported pricing item type: " + String(item.itemType)
          );
        }
        if (item.itemType === "ELECTRICITY_PER_KWH") electricityCount += 1;
        if (item.itemType === "WATER_PER_M3") waterCount += 1;
        if (electricityCount > 1 || waterCount > 1) {
          throw new ConflictException(
            "A pricing policy can contain at most one electricity and one water meter item."
          );
        }

        if (!Number.isSafeInteger(item.unitPriceVnd) || item.unitPriceVnd < 0) {
          throw new ConflictException(
            "unitPriceVnd must be a non-negative safe integer."
          );
        }

        const metered =
          item.itemType === "ELECTRICITY_PER_KWH" ||
          item.itemType === "WATER_PER_M3";
        const fixedQuantity = metered
          ? "1.000"
          : this.decimal3(item.fixedQuantity ?? 1, "fixedQuantity");
        const sortOrder = item.sortOrder ?? index * 10 + 20;
        if (!Number.isInteger(sortOrder)) {
          throw new ConflictException("sortOrder must be an integer.");
        }

        return {
          id: item.id,
          itemType: item.itemType,
          description: this.required(item.description, "description"),
          unitPriceVnd: item.unitPriceVnd,
          fixedQuantity,
          sortOrder
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }

  private async requirePropertyRead(
    principal: TenantPrincipal,
    propertyId: string
  ) {
    if (!roleHasPermission(principal.role, "billing.read")) {
      throw new ForbiddenException("Billing read permission denied.");
    }
    const result = await this.db.query<PropertyScopeRow>(
      `SELECT
         p.id::text,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids
       FROM properties p
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       WHERE p.organization_id = $1::uuid
         AND p.id = $2::uuid
       GROUP BY p.id
       LIMIT 1`,
      [principal.organizationId, propertyId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Property was not found.");
    if (
      !this.accessControl.can(principal.membership, "billing.read", {
        organizationId: principal.organizationId,
        propertyId,
        operationalGroupIds: row.operational_group_ids
      })
    ) {
      throw new ForbiddenException("Billing scope denied for this property.");
    }
  }

  private async requirePropertyManage(
    client: PoolClient,
    principal: TenantPrincipal,
    propertyId: string
  ) {
    if (!roleHasPermission(principal.role, "billing.manage")) {
      throw new ForbiddenException("Billing manage permission denied.");
    }
    const result = await client.query<PropertyScopeRow>(
      `SELECT
         p.id::text,
         COALESCE(
           array_agg(DISTINCT pog.operational_group_id::text)
             FILTER (WHERE pog.operational_group_id IS NOT NULL),
           '{}'::text[]
         ) AS operational_group_ids
       FROM properties p
       LEFT JOIN property_operational_groups pog
         ON pog.organization_id = p.organization_id
        AND pog.property_id = p.id
       WHERE p.organization_id = $1::uuid
         AND p.id = $2::uuid
         AND p.is_active = true
       GROUP BY p.id
       LIMIT 1`,
      [principal.organizationId, propertyId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Property was not found.");
    if (
      !this.accessControl.can(principal.membership, "billing.manage", {
        organizationId: principal.organizationId,
        propertyId,
        operationalGroupIds: row.operational_group_ids
      })
    ) {
      throw new ForbiddenException("Billing scope denied for this property.");
    }
  }

  private async loadPolicy(
    client: PoolClient,
    organizationId: string,
    policyId: string
  ): Promise<ResolvedPricingPolicy | null> {
    const policyResult = await client.query<PolicyRow>(
      `SELECT
         id::text,
         property_id::text,
         name,
         effective_from,
         effective_to
       FROM pricing_policies
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
       LIMIT 1`,
      [organizationId, policyId]
    );
    const row = policyResult.rows[0];
    if (!row) return null;

    const items = await client.query<ItemRow>(
      `SELECT
         id::text,
         policy_id::text,
         item_type,
         description,
         unit_price_vnd::text,
         fixed_quantity::text,
         sort_order
       FROM pricing_policy_items
       WHERE organization_id = $1::uuid
         AND policy_id = $2::uuid
       ORDER BY sort_order, id`,
      [organizationId, policyId]
    );
    return this.mapPolicy(row, items.rows.map((item) => this.mapItem(item)));
  }

  private normalizedPolicy(policy: ResolvedPricingPolicy) {
    return {
      id: policy.id,
      name: policy.name,
      propertyId: policy.propertyId,
      effectiveFrom: policy.effectiveFrom,
      effectiveTo: policy.effectiveTo,
      items: [...policy.items].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
      )
    };
  }

  private mapPolicy(
    row: PolicyRow,
    items: ResolvedPricingItem[]
  ): ResolvedPricingPolicy {
    return {
      id: row.id,
      name: row.name,
      propertyId: row.property_id,
      effectiveFrom: this.dateOnly(row.effective_from),
      effectiveTo: row.effective_to ? this.dateOnly(row.effective_to) : null,
      items
    };
  }

  private mapItem(row: ItemRow): ResolvedPricingItem {
    return {
      id: row.id,
      itemType: row.item_type,
      description: row.description,
      unitPriceVnd: Number(row.unit_price_vnd),
      fixedQuantity: this.decimal3(row.fixed_quantity, "fixedQuantity"),
      sortOrder: row.sort_order
    };
  }

  private decimal3(value: string | number, field: string): string {
    const raw = typeof value === "number" ? String(value) : value.trim();
    const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(raw);
    if (!match) {
      throw new ConflictException(
        field + " must be a non-negative decimal with at most 3 decimals."
      );
    }
    return match[1] + "." + (match[2] ?? "").padEnd(3, "0");
  }

  private required(value: string, field: string) {
    const normalized = value.trim();
    if (!normalized) throw new ConflictException(field + " is required.");
    return normalized;
  }

  private isoDate(value: string, field: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new ConflictException(field + " must use YYYY-MM-DD.");
    }
    const date = new Date(value + "T00:00:00.000Z");
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new ConflictException(field + " is not a valid calendar date.");
    }
    return value;
  }

  private dateOnly(value: Date | string) {
    return value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value.slice(0, 10);
  }

  private async audit(
    client: PoolClient,
    principal: TenantPrincipal,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Readonly<Record<string, unknown>>
  ) {
    await client.query(
      `INSERT INTO audit_events (
         organization_id, actor_user_id, action, resource_type, resource_id, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        principal.organizationId,
        principal.userId,
        action,
        resourceType,
        resourceId,
        JSON.stringify(metadata)
      ]
    );
  }
}
