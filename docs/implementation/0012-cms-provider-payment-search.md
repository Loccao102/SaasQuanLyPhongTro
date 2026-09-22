# Implementation Slice 0012 — CMS Provider Payment Search

## Product design preflight

- Surface: CMS / internal Control Plane.
- Primary personas: PLATFORM_ADMIN, SUPPORT_OPERATOR, OPS_OPERATOR and READ_ONLY_AUDITOR according to platform capabilities.
- Permission scope:
  - `platform.billing.read` for search/detail;
  - `platform.billing.manage` for allocation;
  - `platform.audit.read` for audit history.
- Job-to-be-done: locate a provider payment quickly, understand its reconciliation state and financial history, then take an already-authorized reconciliation action without exposing raw provider data.
- Main flow: search/filter -> inspect paginated results -> open detail -> inspect balances/allocations/webhook/audit -> optionally allocate remaining money through the existing audited workflow.
- Critical states: initial loading, filtered empty state, search error/retry, detail loading/error, unassigned payment, zero allocations, partial allocation, fully allocated payment, no linked webhook, missing audit permission.
- Responsive behavior: filters collapse to one column and tables remain contained/scrollable on narrow screens.
- Financial risk: search/detail are read-only. Allocation retains the existing explicit amount + invoice + audit reason confirmation and backend balance/tenant checks.

## Implemented

- provider transaction search in CMS by:
  - payment UUID;
  - provider transaction ID;
  - payment reference;
- provider filter;
- reconciliation-status filter;
- cursor pagination with Load more;
- clear-filter/retry states;
- safe copy actions for payment ID and payment reference;
- transaction detail drill-down;
- complete append-only allocation history with invoice/balance context;
- linked billing webhook operational history;
- permission-aware platform audit history;
- allocation action from search results when `platform.billing.manage` is present;
- automatic result/detail refresh after successful allocation;
- API contract documentation.

## Data minimization

Provider-payment CMS responses use a dedicated safe DTO. They do not return:

- raw provider payment metadata;
- internal payment idempotency keys;
- raw webhook bodies;
- webhook headers;
- audit before/after JSON snapshots.

The payment reference is extracted explicitly because it is an operator-facing reconciliation identifier.

## Financial invariants preserved

- search/detail never mutate financial state;
- PaymentTransaction remains the original provider record;
- PaymentAllocation remains append-only;
- allocation cannot exceed payment unallocated amount or invoice remaining balance;
- cross-organization allocation remains rejected server-side;
- ambiguous money remains REVIEW_REQUIRED;
- provider retries do not duplicate financial effects.

## Verification

Relevant integration coverage verifies:

- transaction search;
- payment-reference search;
- reconciliation-status cursor pagination;
- safe search DTO does not expose metadata/idempotency key;
- detail returns the expected allocation and target invoice;
- unmatched detail has no invented allocation;
- raw provider metadata is not returned.

Repository CI remains the final gate for lint, typecheck, tests, integration tests and build.

## Follow-up

- organization search/filter/cursor pagination and direct organization detail route;
- direct invoice detail route;
- deep links from provider-payment detail to organization/invoice;
- resolve allocation actor IDs to safe display names when permitted;
- future refund/credit/reversal history after those financial policies are defined.
