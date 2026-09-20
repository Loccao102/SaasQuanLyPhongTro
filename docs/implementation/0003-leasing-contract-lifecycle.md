# Implementation Slice 0003 — Leasing Contract Lifecycle

## Architecture preflight

Owning module: Residents & Leases (Leasing).

Tenant boundary:
- Resident, Lease, LeaseResident, LeaseTermination and command receipts are organization-owned;
- cross-table tenant references use composite `organization_id` foreign keys;
- the existing Identity permission `lease.manage` / `lease.terminate` remains the server-side authorization capability when secure endpoints are added.

Idempotency:
- retryable lease commands require an idempotency key;
- `lease_command_receipts` persists the response;
- one organization cannot collide with another organization using the same client key;
- a key cannot be reused for another command type.

Audit:
- lifecycle functions emit domain events;
- future transactional application services will persist matching audit events after successful state changes.

Failure states:
- invalid lifecycle transition;
- invalid date;
- duplicate current lease for a room;
- duplicate primary tenant;
- termination readiness pending;
- idempotency-key conflict;
- tenant mismatch rejected by composite foreign key/application authorization.

## Lifecycle

```text
DRAFT
  ├─ activate ─> ACTIVE
  └─ cancel ───> CANCELLED

ACTIVE
  └─ schedule termination ─> TERMINATION_SCHEDULED

TERMINATION_SCHEDULED
  ├─ cancel schedule ─> ACTIVE
  └─ finalize ────────> TERMINATED
```

`ACTIVE` and `TERMINATION_SCHEDULED` are room-occupying states.

## Termination readiness contract

Termination may finalize only when Metering, financial settlement and deposit settlement are each either:
- `READY`; or
- `NOT_REQUIRED`.

Leasing does not own those modules' source-of-truth records.

## Product design preflight — Admin Leasing

Surface:
- Admin Web.

Primary persona:
- OWNER / ADMIN / MANAGER.

Permission and scope:
- list/detail requires `lease.read`;
- create/activate requires `lease.manage`;
- termination requires `lease.terminate`;
- resource context is organization + property;
- current screens explicitly remain demo UI until trustworthy principal/auth is connected.

Job-to-be-done:
- find the current/historical contract for a room and safely move a tenant out without losing contractual or financial history.

Main flow:
1. Hợp đồng list with status/property/search filters.
2. Lease detail with terms, parties and lifecycle history.
3. Dedicated “Chấm dứt hợp đồng” workflow.
4. Effective date/reason.
5. Metering readiness.
6. Financial readiness.
7. Deposit readiness.
8. Consequence review and final action.

Destructive/financial risks:
- termination makes the room available for a future lease;
- historical lease/resident/invoice data must remain;
- final action is blocked while any required readiness is PENDING;
- deposit value shown from contract is not treated as proof of an actual cash transaction.

Critical UI states:
- loaded demo state implemented;
- explicit PENDING readiness implemented;
- destructive action disabled when not ready;
- list/create mutations remain disabled until secure write API/auth exists;
- loading/empty/network/API errors will be implemented with real API integration rather than fake states.

Responsive:
- desktop/tablet-first;
- list table scrolls horizontally when needed;
- detail becomes single-column;
- termination stepper becomes a horizontal scrollable sequence before collapsing content.

Reusable components:
- AdminShell;
- PageHeader;
- StatusBadge;
- MetricCard;
- MoneyDisplay;
- SectionHeader.

## Migration notes

Forward:
1. Apply 0001 identity/property migration.
2. Apply 0002 leasing migration.

Bootstrap rollback:
1. Roll back 0002.
2. Roll back 0001 only if returning to a completely empty development database.

Production migrations should be forward-corrective rather than destructive rollback once real customer data exists.
