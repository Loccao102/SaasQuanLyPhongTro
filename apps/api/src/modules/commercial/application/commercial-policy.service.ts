import { Injectable } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import {
  evaluateResourceLimit,
  resolveEffectiveEntitlements,
  type EffectiveEntitlements,
  type EntitlementKey,
  type EntitlementOverride,
  type PlanEntitlements
} from "../domain/entitlements.js";
import {
  subscriptionAccessMode,
  type SubscriptionAccessMode,
  type SubscriptionStatus
} from "../domain/subscription-lifecycle.js";

type OrganizationPolicyRow = QueryResultRow & {
  organization_id: string;
  organization_status: string;
  subscription_id: string | null;
  subscription_status: SubscriptionStatus | null;
  plan_code: string | null;
  plan_version_id: string | null;
  room_limit: number | null;
  staff_limit: number | null;
  automation_quota: number | null;
  features: unknown;
};

type OverrideRow = QueryResultRow & {
  entitlement_key: EntitlementKey;
  value: unknown;
  expires_at: Date | null;
};

export type CommercialResource = "ROOM" | "STAFF";

export interface OrganizationCommercialPolicy {
  organizationId: string;
  organizationStatus: string;
  subscriptionId: string;
  subscriptionStatus: SubscriptionStatus;
  accessMode: SubscriptionAccessMode;
  planCode: string;
  planVersionId: string;
  entitlements: EffectiveEntitlements;
}

export class OrganizationCommercialPolicyNotFoundError extends Error {
  constructor() {
    super("Organization was not found.");
    this.name = "OrganizationCommercialPolicyNotFoundError";
  }
}

export class CommercialSubscriptionNotFoundError extends Error {
  constructor() {
    super("Organization does not have a SaaS subscription.");
    this.name = "CommercialSubscriptionNotFoundError";
  }
}

export class CommercialWriteRestrictedError extends Error {
  constructor(message = "Organization is read-only under the current commercial state.") {
    super(message);
    this.name = "CommercialWriteRestrictedError";
  }
}

export class CommercialResourceLimitExceededError extends Error {
  constructor(
    public readonly resource: CommercialResource,
    public readonly current: number,
    public readonly requestedIncrease: number,
    public readonly limit: number
  ) {
    super(
      `${resource} limit exceeded: current=${current}, requestedIncrease=${requestedIncrease}, limit=${limit}.`
    );
    this.name = "CommercialResourceLimitExceededError";
  }
}

function featureBoolean(
  features: unknown,
  key: "advanced_reports" | "audit_log"
): boolean {
  if (
    typeof features === "object" &&
    features !== null &&
    key in features
  ) {
    return (features as Record<string, unknown>)[key] === true;
  }

  return false;
}

@Injectable()
export class CommercialPolicyService {
  async lockOrganizationForMutation(
    client: PoolClient,
    organizationId: string
  ): Promise<void> {
    const result = await client.query(
      `SELECT id
       FROM organizations
       WHERE id = $1
       FOR UPDATE`,
      [organizationId]
    );

    if (result.rowCount !== 1) {
      throw new OrganizationCommercialPolicyNotFoundError();
    }
  }

  async loadPolicy(
    client: PoolClient,
    organizationId: string
  ): Promise<OrganizationCommercialPolicy> {
    const policyResult = await client.query<OrganizationPolicyRow>(
      `SELECT
         o.id::text AS organization_id,
         o.status AS organization_status,
         s.id::text AS subscription_id,
         s.status AS subscription_status,
         p.code AS plan_code,
         s.plan_version_id::text,
         pv.room_limit,
         pv.staff_limit,
         pv.automation_quota,
         pv.features
       FROM organizations o
       LEFT JOIN organization_subscriptions s
         ON s.organization_id = o.id
       LEFT JOIN saas_plans p
         ON p.id = s.plan_id
       LEFT JOIN saas_plan_versions pv
         ON pv.id = s.plan_version_id
       WHERE o.id = $1`,
      [organizationId]
    );

    const row = policyResult.rows[0];
    if (!row) {
      throw new OrganizationCommercialPolicyNotFoundError();
    }

    if (
      row.subscription_id === null ||
      row.subscription_status === null ||
      row.plan_code === null ||
      row.plan_version_id === null ||
      row.room_limit === null ||
      row.staff_limit === null ||
      row.automation_quota === null
    ) {
      throw new CommercialSubscriptionNotFoundError();
    }

    const overrideResult = await client.query<OverrideRow>(
      `SELECT entitlement_key, value, expires_at
       FROM organization_entitlement_overrides
       WHERE organization_id = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY created_at`,
      [organizationId]
    );

    const overrides: EntitlementOverride[] = overrideResult.rows.map((item) => ({
      key: item.entitlement_key,
      value: item.value as number | boolean,
      expiresAt: item.expires_at?.toISOString() ?? null
    }));

    const planEntitlements: PlanEntitlements = {
      roomLimit: row.room_limit,
      staffLimit: row.staff_limit,
      automationActionsMonthly: row.automation_quota,
      advancedReports: featureBoolean(row.features, "advanced_reports"),
      auditLog: featureBoolean(row.features, "audit_log")
    };

    return {
      organizationId: row.organization_id,
      organizationStatus: row.organization_status,
      subscriptionId: row.subscription_id,
      subscriptionStatus: row.subscription_status,
      accessMode: subscriptionAccessMode(row.subscription_status),
      planCode: row.plan_code,
      planVersionId: row.plan_version_id,
      entitlements: resolveEffectiveEntitlements(planEntitlements, overrides)
    };
  }

  assertWriteAllowed(policy: OrganizationCommercialPolicy): void {
    if (policy.organizationStatus !== "ACTIVE") {
      throw new CommercialWriteRestrictedError(
        "Organization is suspended and cannot perform write operations."
      );
    }

    if (policy.accessMode !== "FULL") {
      throw new CommercialWriteRestrictedError(
        `Subscription status ${policy.subscriptionStatus} is read-only.`
      );
    }
  }

  assertResourceIncreaseAllowed(
    policy: OrganizationCommercialPolicy,
    resource: CommercialResource,
    current: number,
    requestedIncrease: number
  ): void {
    this.assertWriteAllowed(policy);

    const limit =
      resource === "ROOM"
        ? policy.entitlements.roomLimit
        : policy.entitlements.staffLimit;

    const decision = evaluateResourceLimit(current, requestedIncrease, limit);

    if (!decision.allowed) {
      throw new CommercialResourceLimitExceededError(
        resource,
        decision.current,
        decision.requestedIncrease,
        decision.limit
      );
    }
  }

  async assertTenantWriteAllowed(
    client: PoolClient,
    organizationId: string
  ): Promise<OrganizationCommercialPolicy> {
    await this.lockOrganizationForMutation(client, organizationId);
    const policy = await this.loadPolicy(client, organizationId);
    this.assertWriteAllowed(policy);
    return policy;
  }
}
