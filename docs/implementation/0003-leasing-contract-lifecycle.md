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

## Migration notes

Forward:
1. Apply 0001 identity/property migration.
2. Apply 0002 leasing migration.

Bootstrap rollback:
1. Roll back 0002.
2. Roll back 0001 only if returning to a completely empty development database.

Production migrations should be forward-corrective rather than destructive rollback once real customer data exists.
