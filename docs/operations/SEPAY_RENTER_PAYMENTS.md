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

If the webhook endpoint is unavailable, do not invent transactions from
application logs. Reconcile against SePay's transaction API and insert missing
provider events through a controlled reconciliation path using the same
provider transaction idempotency rules.

If a payment is ambiguous, leave it in `REVIEW_REQUIRED` until an authorized
operator explicitly resolves it.
