# Implementation Roadmap

## Phase 0 — Foundation

- Repository conventions + AGENTS/skills/docs.
- Modular monolith skeleton.
- PostgreSQL migrations.
- Organization + roles.
- Administrative areas + operational groups.
- Property/floor/room model.
- CI: lint, typecheck, unit tests, migration checks.

## Phase 1 — Metering

- Billing cycles.
- Staff assignments.
- Staff PWA checklist.
- IndexedDB offline queue.
- Meter validation and anomaly warning.
- Admin progress tracking.

## Phase 2 — Billing

- Pricing policies.
- Invoice + invoice lines.
- Public invoice token.
- VietQR/deeplink abstraction.
- Excel import/export.

## Phase 3 — Notifications

- Notification job/attempt model.
- Queue worker.
- Playwright adapter as transitional provider.
- Retry/manual review dashboard.
- Provider abstraction for future official APIs.

## Phase 4 — Payments

- SePay webhook receiver.
- Idempotent webhook event processing.
- Transaction parser/matcher.
- Partial payment/allocation.
- SSE payment status.
- Collection dashboard.

## Phase 5 — Hardening

- Audit log.
- Security review.
- Backup/restore test.
- Load test.
- Observability/alerts.
- Pilot runbook.
- DR/incident procedures.

## Definition of scale readiness

Không tính năng nào được coi là hoàn thành nếu:
- query không tenant-scoped;
- job không retry/idempotent;
- financial mutation không audit;
- provider-specific logic rò vào core;
- failure không có trạng thái quan sát được.
