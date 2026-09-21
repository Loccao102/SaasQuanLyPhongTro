import { Injectable } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import {
  transitionSubscription,
  type SubscriptionState,
  type SubscriptionStatus
} from "../domain/subscription-lifecycle.js";

type SubscriptionRow = QueryResultRow & {
  id: string;
  organization_id: string;
  plan_id: string;
  plan_version_id: string;
  plan_code: string;
  status: SubscriptionStatus;
  version: number;
  trial_ends_at: Date | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
  grace_ends_at: Date | null;
  cancel_at_period_end: boolean;
};

type SettingRow = QueryResultRow & {
  value: unknown;
};

export interface SubscriptionView {
  id: string;
  organizationId: string;
  planId: string;
  planVersionId: string;
  planCode: string;
  status: SubscriptionStatus;
  version: number;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
}

export class SubscriptionAlreadyExistsError extends Error {
  constructor() {
    super("Organization already has a SaaS subscription.");
    this.name = "SubscriptionAlreadyExistsError";
  }
}

export class SubscriptionNotFoundError extends Error {
  constructor() {
    super("Organization SaaS subscription was not found.");
    this.name = "SubscriptionNotFoundError";
  }
}

export class SubscriptionPlanNotFoundError extends Error {
  constructor() {
    super("Active SaaS plan was not found.");
    this.name = "SubscriptionPlanNotFoundError";
  }
}

export class ConcurrentSubscriptionUpdateError extends Error {
  constructor() {
    super("Subscription changed since it was loaded.");
    this.name = "ConcurrentSubscriptionUpdateError";
  }
}

export class InvalidSubscriptionProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSubscriptionProvisioningError";
  }
}

@Injectable()
export class SubscriptionManagementService {
  async provision(
    client: PoolClient,
    input: {
      organizationId: string;
      planCode: string;
      status: "TRIALING" | "ACTIVE";
      trialEndsAt?: string | null;
    }
  ): Promise<SubscriptionView> {
    const organization = await client.query(
      `SELECT id
       FROM organizations
       WHERE id = $1
       FOR UPDATE`,
      [input.organizationId]
    );
    if (organization.rowCount !== 1) {
      throw new SubscriptionNotFoundError();
    }

    const existing = await client.query(
      `SELECT id
       FROM organization_subscriptions
       WHERE organization_id = $1`,
      [input.organizationId]
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new SubscriptionAlreadyExistsError();
    }

    const plan = await client.query<
      QueryResultRow & {
        plan_id: string;
        plan_version_id: string;
      }
    >(
      `SELECT
         p.id::text AS plan_id,
         p.current_version_id::text AS plan_version_id
       FROM saas_plans p
       WHERE p.code = $1
         AND p.status = 'ACTIVE'
         AND p.current_version_id IS NOT NULL
       FOR SHARE`,
      [input.planCode]
    );
    const selectedPlan = plan.rows[0];
    if (!selectedPlan) {
      throw new SubscriptionPlanNotFoundError();
    }

    let trialEndsAt: string | null = null;
    if (input.status === "TRIALING") {
      trialEndsAt =
        input.trialEndsAt ??
        (await this.defaultFutureTimestamp(client, "trial_days"));

      const parsed = new Date(trialEndsAt);
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        throw new InvalidSubscriptionProvisioningError(
          "trialEndsAt must be a future date-time."
        );
      }
    }

    const inserted = await client.query<SubscriptionRow>(
      `INSERT INTO organization_subscriptions (
         organization_id,
         plan_id,
         plan_version_id,
         status,
         trial_ends_at,
         current_period_start
       )
       VALUES ($1, $2, $3, $4, $5::timestamptz, now())
       RETURNING
         id::text,
         organization_id::text,
         plan_id::text,
         plan_version_id::text,
         $6::text AS plan_code,
         status,
         version,
         trial_ends_at,
         current_period_start,
         current_period_end,
         grace_ends_at,
         cancel_at_period_end`,
      [
        input.organizationId,
        selectedPlan.plan_id,
        selectedPlan.plan_version_id,
        input.status,
        trialEndsAt,
        input.planCode
      ]
    );

    return this.mapRow(inserted.rows[0]!);
  }

  async transition(
    client: PoolClient,
    input: {
      organizationId: string;
      to: SubscriptionStatus;
      expectedVersion: number;
      reason: string;
    }
  ): Promise<SubscriptionView> {
    const currentResult = await client.query<SubscriptionRow>(
      `SELECT
         s.id::text,
         s.organization_id::text,
         s.plan_id::text,
         s.plan_version_id::text,
         p.code AS plan_code,
         s.status,
         s.version,
         s.trial_ends_at,
         s.current_period_start,
         s.current_period_end,
         s.grace_ends_at,
         s.cancel_at_period_end
       FROM organization_subscriptions s
       JOIN saas_plans p ON p.id = s.plan_id
       WHERE s.organization_id = $1
       FOR UPDATE OF s`,
      [input.organizationId]
    );
    const current = currentResult.rows[0];
    if (!current) {
      throw new SubscriptionNotFoundError();
    }

    if (current.version !== input.expectedVersion) {
      throw new ConcurrentSubscriptionUpdateError();
    }

    const state: SubscriptionState = {
      id: current.id,
      organizationId: current.organization_id,
      planId: current.plan_id,
      planVersionId: current.plan_version_id,
      status: current.status,
      version: current.version
    };

    const transition = transitionSubscription(state, input.to, input.reason);

    let nextGraceEndsAt = current.grace_ends_at?.toISOString() ?? null;
    if (input.to === "GRACE_PERIOD") {
      nextGraceEndsAt = await this.defaultFutureTimestamp(
        client,
        "grace_period_days"
      );
    } else if (input.to === "ACTIVE") {
      nextGraceEndsAt = null;
    }

    const updatedResult = await client.query<SubscriptionRow>(
      `UPDATE organization_subscriptions
       SET status = $2,
           version = $3,
           grace_ends_at = $4::timestamptz,
           trial_ends_at = CASE
             WHEN $2 = 'ACTIVE' THEN NULL
             ELSE trial_ends_at
           END,
           updated_at = now()
       WHERE organization_id = $1
       RETURNING
         id::text,
         organization_id::text,
         plan_id::text,
         plan_version_id::text,
         $5::text AS plan_code,
         status,
         version,
         trial_ends_at,
         current_period_start,
         current_period_end,
         grace_ends_at,
         cancel_at_period_end`,
      [
        input.organizationId,
        transition.subscription.status,
        transition.subscription.version,
        nextGraceEndsAt,
        current.plan_code
      ]
    );

    return this.mapRow(updatedResult.rows[0]!);
  }

  private async defaultFutureTimestamp(
    client: PoolClient,
    settingKey: "trial_days" | "grace_period_days"
  ): Promise<string> {
    const result = await client.query<SettingRow>(
      "SELECT value FROM system_settings WHERE key = $1",
      [settingKey]
    );
    const raw = result.rows[0]?.value;
    const days = typeof raw === "number" ? raw : Number(raw);

    if (!Number.isInteger(days) || days < 1) {
      throw new InvalidSubscriptionProvisioningError(
        `System setting ${settingKey} must be a positive integer.`
      );
    }

    return new Date(Date.now() + days * 86_400_000).toISOString();
  }

  private mapRow(row: SubscriptionRow): SubscriptionView {
    return {
      id: row.id,
      organizationId: row.organization_id,
      planId: row.plan_id,
      planVersionId: row.plan_version_id,
      planCode: row.plan_code,
      status: row.status,
      version: row.version,
      trialEndsAt: row.trial_ends_at?.toISOString() ?? null,
      currentPeriodStart: row.current_period_start?.toISOString() ?? null,
      currentPeriodEnd: row.current_period_end?.toISOString() ?? null,
      graceEndsAt: row.grace_ends_at?.toISOString() ?? null,
      cancelAtPeriodEnd: row.cancel_at_period_end
    };
  }
}
