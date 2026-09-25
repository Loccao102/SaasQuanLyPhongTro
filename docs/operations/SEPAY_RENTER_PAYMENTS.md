# SePay Renter Payment Webhook Runbook

## Purpose

This runbook configures the production SePay edge integration used for renter
invoice payments. The payment core remains provider-neutral.

## Habi endpoint

```text
POST https://<api-host>/api/integrations/renter-payment-webhooks/sepay
```

The endpoint requires Nest raw-body capture. Do not add middleware that replaces
the original request bytes before HMAC verification.

## SePay webhook configuration

Recommended Habi configuration:

- event: incoming transactions;
- request content type: JSON;
- authentication: HMAC-SHA256;
- URL: the public HTTPS endpoint above;
- payment-code prefix: `RENT`, matching Habi renter invoice payment references.

Set the generated/shared HMAC secret in the API deployment:

```text
SEPAY_RENTER_WEBHOOK_SECRET=<secret>
```

Set the renter-payment webhook worker adapter:

```text
WORKER_ROLE=RENTER_PAYMENT_WEBHOOK
RENTER_PAYMENT_WEBHOOK_PROVIDER=SEPAY
```

After webhook Test/Live validation, enable the periodic API-v2 reconciliation
sweep on the same worker:

```text
SEPAY_RECONCILIATION_ENABLED=true
SEPAY_API_TOKEN=<Bearer token stored in deployment secrets>
SEPAY_RECONCILIATION_SCOPE_KEY=production-company
SEPAY_RECONCILIATION_INTERVAL_MS=900000
SEPAY_RECONCILIATION_INITIAL_LOOKBACK_HOURS=24
```

The API token is an Edge secret and must never be stored in PostgreSQL, logs,
browser bundles, or committed configuration.

The worker does not need the HMAC secret. Signature verification happens only at
the API ingress boundary.

## Expected delivery behavior

A verified request is persisted before asynchronous processing and receives:

```json
{"success":true}
```

with HTTP 200.

Requests with invalid/missing/stale HMAC are not acknowledged as successful.
Their raw payload may be retained under a non-authoritative hash-derived event
key for security/debug evidence, but they cannot reserve the genuine SePay
transaction id.

## Matching and allocation

Habi only auto-allocates when all safety checks pass:

1. transaction is incoming;
2. amount is a positive integer VND value;
3. transaction timestamp is valid;
4. payment reference uniquely resolves an ISSUED renter invoice;
5. provider transaction id has not already produced another financial effect;
6. amount does not exceed invoice remaining amount;
7. when SePay supplies `accountNumber`, it matches the organization's active
   payment profile.

Any ambiguous/unsafe state is retained for `REVIEW_REQUIRED`; no fuzzy match
or silent overpayment allocation is allowed.

## Production checklist

- API host has valid public HTTPS;
- production host clock is NTP-synchronized;
- `SEPAY_RENTER_WEBHOOK_SECRET` stored in deployment secrets, not Git;
- SePay webhook uses HMAC-SHA256;
- payment profile account number matches the SePay-connected bank account;
- Test mode valid-signature, duplicate, wrong-code and wrong-amount cases pass;
- worker heartbeat is healthy for `RENTER_PAYMENT_WEBHOOK / SEPAY`;
- alerts exist for webhook backlog, stale worker and invalid-signature spikes.

## Recovery

If the webhook endpoint is unavailable, the enabled API-v2 sweep fetches
incoming transactions with a durable `since_id` cursor and persists each row
through the same renter-payment inbox before advancing the cursor.

Webhook numeric IDs and API-v2 UUID IDs are aliases, not the financial
identity. Habi derives a canonical identity from exact bank reference number,
destination account, transaction timestamp, direction and integer-VND amount.
A cross-channel replay therefore reuses the existing PaymentTransaction.
Missing or conflicting strong identity evidence never triggers fuzzy merge and
is routed to review.

The first enabled sweep bootstraps from a bounded lookback window (24 hours by
default). After a successful durable page, later sweeps use SePay `since_id`.
If the worker fails before cursor advance, persisted observations may be seen
again; provider-event and canonical-transaction idempotency make this safe.

If a payment is ambiguous, leave it in `REVIEW_REQUIRED` until an authorized
operator explicitly resolves it.


## Reconciliation cutover checklist

- keep `SEPAY_RECONCILIATION_ENABLED=false` until migration 0019/0020 is applied;
- verify legacy SePay provider transactions were backfilled without uniqueness errors;
- use a dedicated SePay API bearer token in deployment secrets;
- enable one reconciliation worker for a scope first;
- confirm worker heartbeat remains healthy and reconciliation observed count is visible;
- confirm a webhook-delivered transaction later seen by API v2 does not create another allocation;
- simulate worker interruption before cursor advance and confirm replay is harmless;
- alert on REVIEW_REQUIRED growth and repeated API authentication/rate failures;
- rotate the API token independently from the webhook HMAC secret.


## Webhook HMAC secret rotation

Habi supports a short overlap window so the webhook HMAC secret can be rotated
without intentionally dropping valid deliveries.

Runtime variables:

```text
SEPAY_RENTER_WEBHOOK_SECRET=<current>
SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS=<previous-or-empty>
```

Rules:

- the current secret is always required and must contain at least 16 characters;
- the previous secret is optional;
- when present, the previous secret must also contain at least 16 characters;
- current and previous must differ;
- both are checked with timing-safe HMAC comparison;
- Habi never persists which secret matched;
- signatures/secrets are never written to safe headers, audit metadata or logs.

Recommended cutover:

1. generate a new high-entropy secret;
2. deploy Habi with the new secret in `SEPAY_RENTER_WEBHOOK_SECRET` and the
   existing secret in `SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS`;
3. update the SePay webhook configuration to the new secret;
4. verify valid deliveries and watch invalid-signature metrics;
5. keep the overlap only long enough to cover delivery/retry uncertainty and
   at least the 300-second request replay window;
6. clear `SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS` and redeploy;
7. verify a request signed with the old secret is rejected.

Do not leave the previous secret configured indefinitely. A rotation is not
complete until the previous value is removed.

### API-v2 bearer-token rotation

The reconciliation bearer token is independent from the webhook HMAC secret.

To rotate `SEPAY_API_TOKEN`:

1. create a replacement API token in SePay;
2. update the worker deployment secret and restart/redeploy the renter-payment
   worker;
3. verify reconciliation heartbeat and
   `habi_renter_payment_reconciliation_last_success_age_seconds`;
4. revoke the previous API token after the new token is confirmed.

The durable reconciliation cursor means a short worker restart does not lose
bank transactions; the next sweep catches up from the stored cursor.


## Production readiness self-check

Habi exposes safe checks without returning secret/token material.

API-side webhook check:

```text
GET /api/internal/integrations/sepay/readiness
Authorization: Bearer <INTERNAL_WORKER_TOKEN>
```

The response reports only PASS/WARN/FAIL codes for:
- current webhook secret configuration;
- previous-secret overlap state;
- invalid/equal rotation configuration.

The renter-payment worker performs its own startup check because the API-v2
bearer token belongs only to the worker. When SePay reconciliation is enabled,
startup fails before polling if:
- the active renter-payment provider is not SEPAY;
- the API token is missing/too short;
- the API URL is invalid;
- production API URL is not HTTPS.

A production `default` reconciliation scope is WARN-only so an operator can
choose the final deployment scope without copying credentials into the API.

Neither self-check returns webhook secret values, API token values, signature
values or bank transaction data.


## Production cutover self-check

Before switching SePay to Live mode, run the readiness command inside the same
deployment environment that will receive webhooks:

```bash
pnpm --filter @propops/api sepay:readiness
```

The command exits non-zero when production-critical configuration is unsafe.
It validates the SePay provider selection, webhook HMAC secret/rotation overlap,
API token when reconciliation is enabled, production HTTPS API endpoint,
explicit reconciliation scope, and positive interval/lookback values.

The report never prints secret or token values. A configured previous webhook
secret is exposed only as a boolean/warning.

Recommended gate:

1. require `sepay:readiness` to return `status=ready`;
2. run SePay Test mode deliveries;
3. verify renter-payment worker and reconciliation metrics;
4. execute one low-value Live payment;
5. confirm webhook + later API-v2 replay create one financial effect.
