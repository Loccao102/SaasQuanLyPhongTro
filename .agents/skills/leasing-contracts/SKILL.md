---
name: propops-leasing-contracts
description: Use when implementing residents, leases/contracts, activation, renewal/amendment, move-out, termination, deposit readiness, or room occupancy derived from lease state.
---

# Leasing & Contracts Skill

1. A Room never stores "current tenant" as mutable source-of-truth. Occupancy is derived from current Lease state.
2. Lease history is immutable in identity: ending a lease never deletes it and the next tenant gets a new Lease.
3. Every tenant-owned leasing aggregate carries `organization_id`; important foreign keys must include tenant scope where practical.
4. Model contract lifecycle explicitly. Do not implement termination as record deletion or generic status editing.
5. Baseline lifecycle:
   - DRAFT -> ACTIVE;
   - DRAFT -> CANCELLED;
   - ACTIVE -> TERMINATION_SCHEDULED;
   - TERMINATION_SCHEDULED -> ACTIVE when a scheduled termination is cancelled;
   - TERMINATION_SCHEDULED -> TERMINATED only after required readiness checks pass.
6. At most one current occupying lease may exist for a room. Enforce this at the database layer in addition to application checks.
7. Financial values such as base rent and required deposit use integer VND.
8. Termination orchestration must not copy invoice/payment/meter source-of-truth into Leasing. Keep readiness/status references and let owning modules keep their own records.
9. Retryable lease commands require persisted idempotency keys. Reusing an idempotency key for a different command is a conflict.
10. Activation, termination scheduling/cancellation/finalization, role/party changes, and amendments must be auditable.
11. UI for termination is a guided workflow showing effective date, meter readiness, outstanding financial readiness, deposit readiness, and final consequences before the final action.
12. Test happy path, invalid transitions, duplicate retry, tenant isolation, duplicate current-room occupancy, and termination-not-ready cases.
