# Implementation Slice 0023 — SePay API-v2 Reconciliation Sweep

## Architecture preflight

Owning concerns:
- Integrations owns SePay HTTP/API-v2 behavior.
- Renter Payments owns financial normalization/allocation.
- Worker owns retryable polling orchestration.
- PostgreSQL owns durable reconciliation cursor state.

Core/Edge:
- SePay bearer token and API response parsing stay at the Edge.
- Worker does not write PostgreSQL.
- API-v2 observations enter the same durable inbox as webhook observations.
- Existing provider-neutral payment processor remains the only path that creates
  provider PaymentTransactions/Allocations.

Idempotency:
- API-v2 event ID is `api-v2:<SePay UUID>`.
- stable observation payload omits mutable `webhook_success`.
- canonical provider identity deduplicates API-v2 UUID against legacy webhook
  numeric aliases.
- cursor advances only after durable observation persistence.

Failure:
- failures leave cursor unchanged;
- stale duplicate observations are safe;
- concurrent cursor advance is rejected via optimistic version;
- pagination has a bounded safety cap;
- reconciliation is disabled by default.

## Runtime configuration

```text
RENTER_PAYMENT_WEBHOOK_PROVIDER=SEPAY
SEPAY_RECONCILIATION_ENABLED=true
SEPAY_API_TOKEN=<deployment secret>
SEPAY_RECONCILIATION_SCOPE_KEY=production-company
SEPAY_RECONCILIATION_INTERVAL_MS=900000
SEPAY_RECONCILIATION_INITIAL_LOOKBACK_HOURS=24
```

## Initial and incremental flow

Initial:

```text
now - lookback
 -> transaction_date_from
 -> ascending pages (max 100 rows/page)
 -> persist observations
 -> cursor = final observed SePay UUID
```

Incremental:

```text
cursor
 -> since_id
 -> incoming transactions, ascending
 -> persist observations
 -> optimistic cursor advance
```

## Verification

Required CI coverage:
- worker API-v2 request/query construction;
- stable observation serialization;
- cursor not advanced on persistence failure;
- API-v2 SePay adapter normalization;
- database cursor initialization/optimistic update conflict;
- durable observation duplicate replay;
- migration 0020 forward/rollback/reapply;
- full integration/build suite.
