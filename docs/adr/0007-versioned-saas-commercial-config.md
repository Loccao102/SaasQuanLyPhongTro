# ADR-0007: Versioned SaaS Commercial Configuration

- Status: Accepted
- Date: 2026-09-21

## Context

The SaaS needs configurable plans, room/staff/automation limits and organization subscriptions. These values are edited from CMS but are business state used by the SaaS itself.

If CMS owned these records separately, SaaS authorization/entitlement checks would depend on synchronization with a second source of truth.

If plan rows were updated in place, existing subscriptions could silently inherit new historical pricing/limits.

## Decision

Keep SaaS Commercial inside the modular monolith and the same PostgreSQL database.

Use:
- `saas_plans` as stable plan identity;
- immutable `saas_plan_versions` for price/limit snapshots;
- `saas_plans.current_version_id` for the current sellable configuration;
- `organization_subscriptions.plan_version_id` as the subscription snapshot.

CMS is only an operator client over `/api/cms/*`; it does not own these tables.

Plan configuration mutations:
- require platform permission;
- require reason;
- require optimistic `expectedVersion`;
- require `Idempotency-Key`;
- create a new version instead of updating the old version;
- write platform audit in the same transaction.

## Consequences

Positive:
- no CMS/SaaS synchronization;
- historical subscription configuration remains stable;
- pricing/limits can evolve without hard-coded conditionals;
- future entitlement resolution can use the subscription snapshot directly.

Tradeoffs:
- current-plan reads require a join to the version table;
- explicit lifecycle logic is needed for upgrade/downgrade and pending plan changes;
- subscription payment/invoice state remains a separate future slice.

## Non-goals

This ADR does not yet define:
- payment provider;
- subscription invoices/payments;
- entitlement overrides;
- automatic upgrade;
- renewal scheduler.
