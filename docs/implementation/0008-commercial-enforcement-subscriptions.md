# Implementation Slice 0008 — Commercial Enforcement & Subscription Operations

## Scope

This slice makes SaaS commercial state operational instead of informational.

Implemented:
- subscription provisioning from current plan-version snapshot;
- subscription lifecycle transitions with optimistic version;
- automatic default trial/grace duration from system settings;
- platform idempotency + audit around CMS subscription commands;
- CMS Organizations controls for provision/transition;
- shared commercial write policy for tenant commands;
- room-limit enforcement on room creation;
- staff-limit enforcement on membership activation;
- read-only enforcement on Leasing mutation commands;
- PostgreSQL integration coverage.

## Subscription Operations

Provisioning accepts only `TRIALING` or `ACTIVE`.

A provisioned subscription stores:
- stable plan id;
- exact plan_version_id snapshot;
- lifecycle status;
- optimistic version;
- trial timestamps when relevant.

Lifecycle transitions reuse the Commercial domain state machine.

CMS requires:
- `platform.subscriptions.manage`;
- reason;
- `Idempotency-Key`;
- expectedVersion for transitions.

Platform audit and command receipt are written in the same PostgreSQL transaction as the subscription change.

## Tenant Enforcement

`CommercialPolicyService` resolves plan snapshot + active organization overrides.

Room create and membership activation lock the organization row before reading usage. This protects the limit check from concurrent resource increases.

Current staff-limit semantics count every ACTIVE organization membership, including OWNER. An INVITED or SUSPENDED membership does not consume an active seat until activation.

Existing resources are not removed after downgrade. Only new increases are denied while over limit.

Lease commands now reject new writes when organization/subscription state is read-only, while an already persisted idempotent lease command replay still returns its stored response.

## Verification

Integration tests cover:
- room create and idempotent retry;
- room limit rejection;
- staff activation limit rejection and later activation after override increase;
- idempotent resource replay after subscription suspension;
- lease mutation rejection while suspended;
- CMS subscription provision idempotency;
- plan-version snapshot on provision;
- lifecycle transition optimistic version;
- subscription platform audit count;
- setting/plan/entitlement CMS commands from previous slices.

## Not Yet Implemented

- payment provider and subscription invoice/payment records;
- automated renewal collection;
- scheduler that moves PAST_DUE -> GRACE_PERIOD -> SUSPENDED;
- plan upgrade/downgrade command;
- scheduled future plan changes;
- monthly automation quota reservation/consumption ledger.
