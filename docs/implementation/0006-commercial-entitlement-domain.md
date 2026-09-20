# Implementation Slice 0006 — SaaS Commercial Lifecycle & Entitlements

Status: domain foundation. Persistence commands and tenant enforcement are intentionally separate follow-up work.

## Ownership

SaaS Commercial owns:
- subscription lifecycle policy;
- plan-snapshot semantics;
- effective entitlement resolution;
- resource-limit decisions.

CMS is only an operator client. Property/Room remains the source of truth for room usage.

## Subscription lifecycle

Baseline transitions:

```text
TRIALING -> ACTIVE
TRIALING -> CANCELLED

ACTIVE -> PAST_DUE
ACTIVE -> CANCELLED

PAST_DUE -> ACTIVE
PAST_DUE -> GRACE_PERIOD
PAST_DUE -> CANCELLED

GRACE_PERIOD -> ACTIVE
GRACE_PERIOD -> SUSPENDED
GRACE_PERIOD -> CANCELLED

SUSPENDED -> ACTIVE
SUSPENDED -> CANCELLED

CANCELLED -> terminal
```

Access policy:
- TRIALING / ACTIVE / PAST_DUE / GRACE_PERIOD => FULL;
- SUSPENDED / CANCELLED => READ_ONLY.

This encodes the product rule that payment failure does not immediately lock an operator out of their rental data.

## Entitlements

Plan baseline values:
- room limit;
- staff limit;
- monthly automation-action quota;
- feature booleans.

Organization overrides may replace plan values while active.

Resolution order:

```text
active organization override
  -> subscription plan snapshot
```

Expired overrides are ignored.

## Over-limit invariant

Existing resource state is never deleted because a plan limit decreases.

Examples:
- 72 existing rooms on a 60-room limit: read/operate existing data remains valid;
- requested increase 0: allowed;
- requested increase +1: denied;
- 59 rooms requesting +2 on a 60-room limit: denied before resource creation.

The eventual Room create application service must call this decision before commit. Frontend disabling alone is never sufficient.

## Tests

Domain tests cover:
- valid/invalid subscription transitions;
- recovery from payment delinquency;
- grace to suspension;
- read-only access policy;
- active and expired overrides;
- override type validation;
- already-over-limit behavior;
- crossing-limit behavior.

## Follow-up

- persistence for entitlement overrides;
- subscription commands with optimistic version/idempotency/audit;
- application-service enforcement in Room/Staff creation;
- automation quota reservation at execution time;
- renewal/payment scheduler.
