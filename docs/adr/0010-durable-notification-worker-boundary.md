# ADR-0010: Durable Notification Jobs and Separate Worker Boundary

- Status: Accepted
- Date: 2026-09-21

## Context

Notification delivery can involve browser automation, provider outages, ambiguous recipient matching, retries and manual review. It must not run inside a synchronous API request and must not report ambiguous provider state as success.

Commercial plans also impose monthly automation quotas. Concurrency and retry behavior must not double-consume quota.

## Decision

Notification delivery uses durable PostgreSQL campaign/job/attempt state owned by the backend modular monolith.

```text
Tenant application command
  -> NotificationCampaignService
  -> reserve monthly automation quota
  -> notification_campaigns
  -> notification_jobs (one per recipient)

Separate worker
  -> POST /api/internal/notifications/claim
  -> provider adapter
  -> POST /api/internal/notifications/{jobId}/complete
  -> notification_attempts + durable job state
```

Workers do not write PostgreSQL directly.

Internal worker endpoints require a server-side `INTERNAL_WORKER_TOKEN` bearer token.

## Quota semantics

One campaign reserves one automation unit per unique recipient before any jobs are created.

The first claim for a recipient job consumes that recipient's reserved unit. Further attempts for the same durable job reuse the same consumption idempotently and do not consume another monthly unit.

Unused open reservation capacity can be released.

Commercial access is re-evaluated at worker claim time. Suspended/cancelled organizations are skipped by claim discovery so one blocked organization cannot starve other organizations' jobs.

## Delivery truth

Provider adapters may return:
- `SENT_CONFIRMED`;
- `TRANSIENT_FAILURE`;
- `PERMANENT_FAILURE`;
- `MANUAL_REVIEW`;
- `UNKNOWN`.

`SENT_CONFIRMED` only becomes durable `SENT` when both recipient verification and send verification are true.

Unhandled provider exceptions become `UNKNOWN`, not an automatic retry. This prevents a browser crash after a possibly-successful click from causing a blind duplicate send.

## Retry policy

Safe transient failures use bounded exponential backoff.

`FAILED` and `MANUAL_REVIEW` jobs may be manually requeued through CMS. The CMS retry command requires platform permission, reason, idempotency key and platform audit.

Manual retry changes durable state only. The worker must claim the job again and must pass current commercial policy before executing a provider attempt.

## Provider boundary

Provider automation runs in `apps/worker`.

The current repository includes a dev-only no-send adapter for plumbing verification. A production Playwright Zalo adapter or official API adapter is a separate Edge implementation and must not change Billing/Commercial/Notification core contracts.
