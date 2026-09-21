# Implementation Slice 0010 — Notification Provider Operations

## Implemented

- migration `0006_notification_provider_operations.sql`;
- per-worker heartbeat persistence;
- provider-level ACTIVE/PAUSED control;
- internal worker heartbeat endpoint protected by worker bearer token;
- claim filtering that skips paused providers;
- claim filtering that skips commercially blocked organizations;
- CMS provider health summary;
- CMS individual worker heartbeat/error visibility;
- audited/idempotent provider Pause/Resume;
- worker auto-pause request for fatal provider conditions;
- unit-tested fatal classifications.

## Fatal provider conditions

The generic worker requests provider pause for:
- AUTH_REQUIRED;
- SESSION_EXPIRED;
- CAPTCHA;
- PROVIDER_UI_BROKEN.

A single-recipient ambiguous send state does not globally pause the provider. It remains a job-level MANUAL_REVIEW/UNKNOWN outcome.

## Operational semantics

PAUSED provider:
- keeps queued jobs durable;
- accepts worker heartbeats;
- does not allow new job claims;
- requires CMS resume with operator reason.

A stale/degraded worker is visible separately from provider control. This lets operators distinguish a global intentional pause from process/provider-health failure.

## Pending

- production Playwright Zalo adapter;
- encrypted browser session persistence/rotation;
- deployment-level worker autoscaling;
- alerting on stale heartbeats/degraded workers;
- provider-specific health probes.
