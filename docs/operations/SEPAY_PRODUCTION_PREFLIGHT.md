# SePay Production Preflight

## Purpose

Run this check before enabling a real SePay renter-payment cutover.

The preflight is intentionally local and deterministic. It does **not** make a
bank transfer and does not call SePay. Test-mode delivery and a low-value Live
payment are still separate operational gates.

## Command

Run inside an environment that has the same database and SePay deployment
configuration as production:

```bash
pnpm --filter @propops/api sepay:preflight
```

Required production inputs include:

```text
DATABASE_URL
SEPAY_RENTER_WEBHOOK_SECRET
SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS   # optional rotation overlap
SEPAY_RECONCILIATION_ENABLED
SEPAY_API_BASE_URL
SEPAY_API_TOKEN                        # required when reconciliation=true
SEPAY_RECONCILIATION_SCOPE_KEY
SEPAY_RECONCILIATION_INTERVAL_MS
SEPAY_RECONCILIATION_INITIAL_LOOKBACK_HOURS
```

The command exits non-zero when any `FAIL` check exists. `WARN` checks are
visible operational risks but do not by themselves block the command.

## What it checks

Environment safety:

- current webhook HMAC secret exists and is long enough;
- optional previous secret is valid, different, and visibly marked as overlap;
- reconciliation flag is valid;
- API token exists when reconciliation is enabled;
- SePay API URL uses HTTPS;
- reconciliation scope/interval/lookback are production-safe.

Database readiness:

- supported migration ledger exists;
- renter-payment/observability/canonical-identity/reconciliation migrations are
  recorded as applied;
- required runtime tables exist;
- every organization that currently has an outstanding `ISSUED` renter
  invoice has an active payment profile.

Operational state:

- current SePay manual-review backlog;
- invalid webhook signatures seen in the last 24 hours;
- latest renter-payment worker heartbeat;
- reconciliation cursor initialization/freshness for the configured scope.

## Secret and payment-data safety

The output never includes:

- webhook secrets;
- SePay API bearer token;
- bank account number;
- provider transaction ID;
- payment reference;
- reconciliation cursor value;
- raw webhook payload.

Counts, health states and age values are allowed because they are needed for
operations.

## Recommended cutover sequence

1. Deploy migrations and application code.
2. Configure production webhook/reconciliation secrets.
3. Run `sepay:preflight` until there are zero failures.
4. Resolve warnings that matter to the intended rollout.
5. Verify SePay Test-mode webhook delivery.
6. Enable reconciliation and confirm the cursor advances.
7. Run one low-value Live payment.
8. Confirm webhook + API-v2 observation produce only one financial effect.
9. Confirm invoice/public payment state updates correctly.
10. Keep monitoring worker stale state, review backlog and invalid signatures.

A green preflight proves local configuration/schema/data readiness. It does not
replace the Test/Live provider verification steps.
