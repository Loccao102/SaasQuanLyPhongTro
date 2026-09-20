# Implementation Slice 0005 — CMS API & Commercial Configuration

## Scope

This slice turns the CMS Settings/Plans/Organizations/Audit surfaces from mock data into real SaaS-owned PostgreSQL/API flows.

It deliberately does not fabricate job or observability data. Those endpoints report integration-not-connected until their owning modules exist.

## Ownership

- Platform access: CMS module, linked to global User identity through platform_operators.
- System settings: SaaS platform configuration.
- SaaS plan/version data: commercial configuration, same SaaS DB.
- Organization subscription pointer: SaaS commercial state, not CMS-owned state.
- Platform audit/idempotency receipts: platform operational infrastructure.
- Rooms/memberships remain owned by existing property/identity modules.

## Security

CMS does not accept a browser-supplied user id as authentication.

Current foundation resolution:
1. future auth middleware may attach authenticatedUserId to the request;
2. only outside production, API may resolve CMS_DEV_USER_ID from server environment;
3. that user must also have an ACTIVE platform_operators row.

Tenant OWNER/ADMIN membership never grants CMS access by itself.

## Mutation correctness

Setting and plan mutations require:
- platform permission;
- reason;
- Idempotency-Key;
- optimistic expectedVersion;
- validation;
- DB transaction;
- durable platform audit;
- command receipt storing the returned response.

Plan changes create immutable saas_plan_versions and move saas_plans.current_version_id. Existing organization_subscriptions keep their plan_version_id snapshot.

## Local development

Apply migrations through `0003_cms_commercial_foundation.sql`, then:

```bash
psql "$DATABASE_URL" -f apps/api/db/seeds/cms_dev_operator.sql
```

Then set:

```text
CMS_DEV_USER_ID=00000000-0000-0000-0000-000000000901
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api
```

Run API and CMS separately.

## Pending integrations

- real authentication/session middleware;
- subscription lifecycle/payment processing;
- entitlement overrides/usage reservation;
- durable notification/general job tables;
- Loki/observability adapter.
