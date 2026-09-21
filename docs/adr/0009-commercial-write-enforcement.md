# ADR-0009: Commercial Write Enforcement at Application Boundaries

- Status: Accepted
- Date: 2026-09-21

## Context

Plan limits and subscription lifecycle state affect what an organization may mutate. Enforcing those rules only in CMS or frontend controls would allow direct API calls, retries or concurrent requests to bypass them.

Room and staff limits are derived from authoritative tenant data:
- active rooms from `rooms`;
- active seats from `organization_memberships`.

The platform also requires a safe downgrade path: lowering a limit must never delete existing rooms or memberships.

## Decision

Commercial policy is enforced inside tenant application services before new mutations commit.

The shared `CommercialPolicyService` resolves:

```text
Organization status
  + OrganizationSubscription status
  + Subscription plan-version snapshot
  + active organization entitlement overrides
  -> effective write access + effective entitlements
```

Write access:
- TRIALING / ACTIVE / PAST_DUE / GRACE_PERIOD => FULL;
- SUSPENDED / CANCELLED => READ_ONLY;
- suspended organization => READ_ONLY.

Resource-increase policy:
- existing state is retained even when already over limit;
- requests with no increase remain valid;
- any request that increases usage beyond the effective limit is rejected before mutation.

For resource creation/activation, the transaction locks the organization row before reading current usage. This serializes competing room/staff increases for the same organization and prevents two requests at the limit from both passing.

Idempotent replay is evaluated before commercial write denial when a durable or identity-based result already exists. A successful command can therefore be replayed safely after a later suspension without executing another mutation.

## Initial Enforcement Points

- Lease lifecycle write commands: subscription/organization read-only policy.
- Room creation: write policy + room limit.
- Membership activation: write policy + staff limit.

Room creation uses a client-provided room UUID as idempotent identity. Reusing the UUID with different room data is a conflict.

## Consequences

Commercial policy is no longer a UI concern. New tenant write application services must explicitly call the shared policy service.

Usage counters are not copied into CMS or Commercial as authoritative mutable state. Each resource-owning module remains source of truth.

The organization-row lock can serialize bursts of resource-creation commands for one organization. This is intentional for correctness at current scale and can later be replaced by a dedicated quota-reservation primitive if throughput requires it.
