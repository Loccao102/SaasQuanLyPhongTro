# PropOps Notification Worker

Separate runtime for provider automation.

The worker never writes PostgreSQL directly. It claims and completes durable notification jobs through authenticated `/api/internal/notifications/*` endpoints.

## Local configuration

```text
INTERNAL_API_BASE_URL=http://localhost:4000/api
INTERNAL_WORKER_TOKEN=replace-with-a-long-random-worker-token
WORKER_PROVIDER=DEV_MANUAL_REVIEW
WORKER_POLL_INTERVAL_MS=1500
WORKER_HEARTBEAT_INTERVAL_MS=15000
WORKER_ID=local-notification-worker
```

`DEV_MANUAL_REVIEW` never sends an external message and is blocked when `NODE_ENV=production`. It exists only to exercise queue/worker plumbing safely.

A production provider adapter must:
- verify the intended recipient before sending;
- return `SENT_CONFIRMED` only after both recipient and send evidence are verified;
- classify only definitely pre-send transient failures as retryable;
- return `UNKNOWN` or `MANUAL_REVIEW` for ambiguous post-action state;
- never expose browser session secrets in evidence/logs.

The Playwright Zalo adapter is intentionally a separate follow-up from the durable queue/runtime foundation.

## Provider health

Workers heartbeat through the internal API. CMS shows worker status and last-seen time.

Fatal provider conditions such as expired authentication, captcha or known provider UI breakage may pause the provider globally. A paused provider keeps durable jobs queued and prevents new claims until an operator resumes it through CMS with an audit reason.
