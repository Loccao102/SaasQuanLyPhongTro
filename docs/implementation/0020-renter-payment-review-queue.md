# Implementation Slice 0020 — Tenant Renter-Payment Review Queue

## Architecture preflight

Owning module:
- Renter Payments.

Tenant boundary:
- review list/detail is always scoped by `organization_id`;
- membership resource scopes are applied to the referenced invoice property;
- provider transactions without a safely attributable tenant/invoice are not exposed to a tenant review queue.

Financial invariants:
- original provider transaction is never edited or deleted;
- manual reconciliation creates a `PaymentAllocation`;
- allocation cannot exceed provider transaction unallocated amount;
- allocation cannot exceed invoice remaining amount;
- invoice projection is recomputed transactionally;
- excess money is never silently converted to credit;
- provider transaction remains `REVIEW_REQUIRED` while any amount is unallocated.

Idempotency:
- client supplies a stable allocation UUID;
- retry with the same allocation UUID + transaction + invoice + amount is safe;
- reuse with different financial data is rejected.

Audit:
- each successful manual reconciliation records `RENTER_PROVIDER_PAYMENT_MANUALLY_RECONCILED` with actor, transaction, invoice, amount, reason and before/after balances.

Commercial policy:
- financial writes still pass `assertTenantWriteAllowed`.

## Product design preflight

Surface:
- Admin Web.

Persona:
- OWNER / ADMIN / ACCOUNTANT or another role with `payment.read` / `payment.reconcile`.

Job-to-be-done:
- inspect unsafe provider payments and explicitly allocate only the verified amount to the already referenced renter invoice.

Main flow:
1. open Thu tiền;
2. scan REVIEW_REQUIRED queue;
3. select transaction;
4. inspect provider evidence, reason and referenced invoice;
5. enter safe allocation amount + reconciliation reason;
6. review financial consequences;
7. explicitly confirm;
8. observe invoice/payment state after commit.

Critical states:
- loading;
- empty queue;
- API error;
- selected review;
- no reconcile permission;
- invoice not eligible;
- partial reconciliation with excess remaining;
- successful full reconciliation.

Responsive:
- desktop/tablet two-pane operations layout;
- collapses to one column on narrow screens.

## Intentional limitation

Unknown payment references that cannot be attributed to an organization are not exposed to tenant users. They remain platform/integration operational review until ownership can be established without guessing.
