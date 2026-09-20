# ADR-0005: Lease Lifecycle and Termination Orchestration

- Status: Accepted
- Date: 2026-09-21

## Context

Room occupancy, historical contracts, final meter readings, outstanding invoices and deposit settlement meet at move-out. Treating a contract as generic CRUD would make historical data mutable and couple Leasing directly to Metering/Billing/Payments.

## Decision

Leasing owns:
- Resident records;
- Lease identity and contractual dates/amounts;
- Lease party membership;
- explicit lease lifecycle;
- termination orchestration/readiness;
- persisted idempotency receipts for retryable lease commands.

Baseline lifecycle:

```text
DRAFT -> ACTIVE -> TERMINATION_SCHEDULED -> TERMINATED
   \-> CANCELLED

TERMINATION_SCHEDULED -> ACTIVE
when a scheduled move-out is cancelled.
```

A lease in `ACTIVE` or `TERMINATION_SCHEDULED` occupies its room. PostgreSQL enforces at most one such lease per room.

Final termination requires the readiness of:
- Metering;
- financial settlement (Billing/Payments);
- deposit settlement.

Leasing stores readiness, not copies of meter readings, invoices or payment transactions. Owning modules retain their own source-of-truth records.

Retryable commands use an organization-scoped persisted idempotency key. Reusing a key for a different command is rejected.

## Consequences

Positive:
- changing tenants never destroys historical leases;
- room availability can be derived consistently;
- future Metering/Billing integrations have explicit orchestration contracts;
- duplicate client retries can be made safe;
- database constraints backstop application invariants.

Constraints:
- termination completion is intentionally blocked until dependent modules resolve readiness;
- API/application services must transactionally persist lease state, command receipt and audit/domain events;
- amendments/renewals remain a later explicit workflow rather than arbitrary row editing.
