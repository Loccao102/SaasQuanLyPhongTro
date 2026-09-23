# SePay SaaS Subscription Payment Webhook

Status: production-provider baseline for the platform SaaS subscription billing flow.

This integration handles payments **to Habi for SaaS subscriptions**. It is separate from future renter-to-landlord invoice payments.

## Boundary

```text
SePay
  -> POST /api/integrations/billing-webhooks/sepay
  -> HMAC verification on exact raw body
  -> saas_billing_webhook_events inbox
  -> BILLING_WEBHOOK worker
  -> SEPAY normalizer
  -> SubscriptionBillingService
  -> PaymentTransaction / PaymentAllocation
```

The public webhook endpoint does not allocate money synchronously. PostgreSQL stores the verified raw event first; the worker processes it asynchronously.

## SePay webhook configuration

Configure the SePay webhook URL as:

```text
https://<api-host>/api/integrations/billing-webhooks/sepay
```

Use HMAC-SHA256 authentication.

Required API secret:

```bash
SEPAY_WEBHOOK_SECRET=<SePay webhook secret>
```

The API verifies:

```text
X-SePay-Timestamp
X-SePay-Signature: sha256=<hex>
```

against:

```text
HMAC-SHA256(secret, timestamp + "." + exact_raw_body)
```

Requests whose timestamp differs from server time by more than 300 seconds are not accepted as verified.

The signature header itself is never persisted in the safe webhook headers.

## Raw-body and replay behavior

Nest is started with `rawBody: true`. HMAC verification uses those exact bytes; parsed/re-serialized JSON is never used for signature calculation.

SePay transaction `id` is used as the provider event ID because SePay documents it as stable across retry/replay delivery.

Inbox uniqueness remains:

```text
(provider, provider_event_id)
```

The same event/body is idempotent.

If an identical raw event was first stored while authentication was missing/invalid and is later replayed with valid authentication, the inbox may upgrade that event to `VERIFIED/RECEIVED`. A different raw body with the same provider event ID remains a conflict.

## Worker configuration

Use:

```bash
BILLING_WEBHOOK_PROVIDER=SEPAY
SEPAY_ALLOWED_ACCOUNT_NUMBERS=0123456789,9988776655
```

At least one expected receiving account is required when the SePay worker adapter starts.

This allowlist is intentionally enforced after the raw verified event is persisted, so unexpected-account events remain inspectable but are routed to manual review rather than financial ingestion.

## Normalization

For a valid incoming transaction:

- provider = `SEPAY`;
- provider transaction ID = SePay `id`;
- amount = `transferAmount` as positive integer VND;
- occurred time = `transactionDate`, explicitly interpreted as Vietnam UTC+7;
- bank metadata = gateway/account/subAccount/referenceCode;
- payment reference = exact Habi SaaS invoice reference.

The current SaaS invoice reference format is:

```text
SAAS + 32 uppercase hex characters
```

The adapter first trusts SePay `code` only when it exactly matches that format. Otherwise it searches the original transfer `content` for exactly one format-compatible reference.

No fuzzy invoice matching is added at the provider adapter.

If no payment reference is available, the provider-neutral billing service stores the transaction for reconciliation/manual review according to existing rules.

## Transaction classification

`transferType=in` may become a payment.

`transferType=out` is ignored as an outgoing bank movement.

The following cases are routed away from automatic financial effects:

- unconfigured destination account;
- invalid/non-integer amount;
- malformed transaction date;
- malformed transaction ID;
- unknown transfer type;
- missing/unsafe payment reference when provider-neutral matching cannot uniquely identify an invoice.

A mismatch between persisted provider event ID and payload `id` is treated as a processing failure.

## HTTP behavior

Verified accepted webhook:

```json
{"success": true, "eventId": "...", "processingStatus": "RECEIVED"}
```

HTTP status is 200.

Invalid/expired HMAC returns 401.

Missing webhook authentication configuration returns 503 so the deployment is fail-closed.

Malformed webhook identity/body returns 400.

## Test mode rollout

Before production:

1. configure SePay Test mode with HMAC-SHA256;
2. point it at a staging/public API endpoint;
3. simulate an inbound transaction;
4. use an invoice `payment_reference` in the transfer content;
5. verify the raw inbox event becomes `VERIFIED`;
6. verify the worker normalizes `transactionDate` from UTC+7 correctly;
7. verify exact, partial, overpayment and unknown-reference behavior;
8. replay the same SePay event and verify there is still one provider payment effect;
9. simulate outgoing transfer and unexpected destination account;
10. test stale/tampered signatures.

## Reconciliation

Webhooks are an event delivery mechanism, not the only source for financial recovery.

Production operations still need a periodic reconciliation path against SePay/bank transaction data so prolonged endpoint/provider outages do not leave missing transactions undiscovered.

## Secret rotation

Keep `SEPAY_WEBHOOK_SECRET` in deployment secret storage, never in Git or browser-exposed environment variables.

During rotation, ensure the webhook configuration and deployment move together. If a delivery temporarily reaches the endpoint before the new secret is active, an identical later verified replay can upgrade the stored event without changing its raw payload identity.
