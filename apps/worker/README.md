# PropOps Async Workers

`@propops/worker` is one code artifact deployed as isolated worker roles. Workers never write PostgreSQL directly; they call authenticated `/api/internal/*` application boundaries.

## Roles

### Notification

```text
WORKER_ROLE=NOTIFICATION
INTERNAL_API_BASE_URL=http://localhost:4000/api
INTERNAL_WORKER_TOKEN=replace-with-a-long-random-worker-token
WORKER_PROVIDER=DEV_MANUAL_REVIEW
WORKER_POLL_INTERVAL_MS=1500
WORKER_HEARTBEAT_INTERVAL_MS=15000
WORKER_ID=local-notification-worker
```

The notification worker claims and completes durable jobs through `/api/internal/notifications/*`.

`DEV_MANUAL_REVIEW` never sends an external message and is blocked when `NODE_ENV=production`. It exists only to exercise queue/worker plumbing safely.

A production provider adapter must:
- verify the intended recipient before sending;
- return `SENT_CONFIRMED` only after both recipient and send evidence are verified;
- classify only definitely pre-send transient failures as retryable;
- return `UNKNOWN` or `MANUAL_REVIEW` for ambiguous post-action state;
- never expose browser session secrets in evidence/logs.

Fatal provider conditions such as expired authentication, captcha or known provider UI breakage may pause the provider globally. A paused provider keeps durable jobs queued and prevents new claims until an operator resumes it through CMS with an audit reason.

### Billing

```text
WORKER_ROLE=BILLING
INTERNAL_API_BASE_URL=http://localhost:4000/api
INTERNAL_WORKER_TOKEN=replace-with-a-long-random-worker-token
BILLING_SWEEP_INTERVAL_MS=60000
BILLING_SWEEP_LIMIT=100
```

The billing worker calls `/api/internal/billing/sweep` on a bounded cadence.

A sweep may:
- create an idempotent renewal invoice inside the configured lead window;
- activate a fully paid period when it becomes effective;
- move unpaid subscriptions through PAST_DUE / GRACE_PERIOD / SUSPENDED.

Duplicate sweeps are safe because the backend owns unique invoice constraints, organization locking and lifecycle transitions.

### Billing webhook

```text
WORKER_ROLE=BILLING_WEBHOOK
INTERNAL_API_BASE_URL=http://localhost:4000/api
INTERNAL_WORKER_TOKEN=replace-with-a-long-random-worker-token
BILLING_WEBHOOK_PROVIDER=DEV_JSON_BANK
BILLING_WEBHOOK_POLL_INTERVAL_MS=1500
DEV_BILLING_WEBHOOK_SECRET=replace-with-at-least-16-random-characters
```

This role claims already-persisted, signature-verified raw provider events through `/api/internal/billing-webhooks/*`.

The worker:
- never writes PostgreSQL directly;
- loads exactly one provider adapter per process;
- converts the provider payload into either a normalized payment or an explicit REVIEW_REQUIRED / IGNORED / FAILED outcome;
- never invents `occurredAt` from worker clock time;
- sends normalized payment data back to the backend, where PaymentTransaction creation/allocation and webhook PROCESSED state commit atomically;
- safely replays a lost response through backend payment/event fingerprints.

`DEV_JSON_BANK` is local-development plumbing only and is blocked when `NODE_ENV=production`. The API dev ingress is `POST /api/integrations/billing-webhooks/dev-json-bank`; it requires `x-dev-event-id` plus a lowercase/uppercase hex HMAC-SHA256 in `x-dev-signature`, computed over the exact raw request body with `DEV_BILLING_WEBHOOK_SECRET`.

A production provider such as SePay requires its own signature verification + raw-event persistence adapter and its own deterministic normalization adapter.

## Deployment invariant

Run NOTIFICATION, BILLING and BILLING_WEBHOOK as separate processes/containers even though they use the same package. Do not run browser automation, subscription scheduling and payment-webhook parsing in the same process.

The Playwright Zalo adapter remains a separate follow-up from the durable notification runtime foundation.
