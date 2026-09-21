# Implementation Slice 0009 — Notification Queue & Worker Foundation

## Implemented

- migration `0005_notification_jobs_foundation.sql`;
- durable notification campaigns, jobs and attempts;
- recipient-unique campaign validation;
- campaign idempotency fingerprint;
- commercial automation quota reservation before enqueue;
- recipient-idempotent quota consumption at first worker claim;
- `FOR UPDATE ... SKIP LOCKED` worker claims;
- execution-time organization/subscription policy checks;
- bounded transient retry backoff;
- evidence-aware send completion;
- `UNKNOWN` and ambiguous confirmation -> manual review;
- CMS durable job inspection;
- audited/idempotent CMS manual retry;
- authenticated `/api/internal/notifications/*` worker boundary;
- separate `apps/worker` runtime;
- dev-only no-send provider for local plumbing tests;
- PostgreSQL integration flow from campaign enqueue through retry and final completion.

## Full-flow invariants tested

- replaying campaign creation does not duplicate campaign/jobs/quota reservation;
- first recipient claim converts one reserved unit to consumed;
- retrying the same job does not consume quota again;
- confirmed delivery requires recipient + send verification;
- unknown provider state never becomes SENT;
- manual review can be requeued;
- suspended subscription is skipped by worker claim;
- reactivated subscription resumes queued work;
- final two-recipient campaign consumes exactly two quota units;
- all attempts remain durable for diagnostics.

## Runtime boundary

`apps/worker` talks only to the internal API. It does not import backend repositories and does not connect to PostgreSQL.

The worker catches unhandled provider exceptions and completes them as `UNKNOWN` so the backend can route them to manual review rather than risk duplicate delivery.

## Pending

- production Playwright Zalo adapter;
- provider session/credential storage and rotation;
- worker heartbeat/provider-health reporting;
- campaign pause/cancel commands;
- bulk manual-review tooling;
- official provider adapters;
- tenant-facing authenticated campaign HTTP endpoint once tenant session middleware is connected.
