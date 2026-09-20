# CMS Product Workflows

## Surface and persona

Surface: internal CMS, desktop/tablet-first.

Primary personas: PLATFORM_ADMIN, SUPPORT_OPERATOR, OPS_OPERATOR, READ_ONLY_AUDITOR.

Permissions are server-side capabilities, not only UI roles.

## Primary job

Understand system/customer state, safely change configuration, recover operational failures, and leave an audit trail.

## Navigation

1. Tổng quan
2. Cấu hình
3. Gói & giới hạn
4. Organizations
5. Jobs / Queue
6. Technical logs
7. Audit log

## Settings

Flow: find setting -> inspect -> edit -> review impact -> provide reason -> submit -> success/audit receipt.

Production states include invalid value, permission denied, optimistic/version conflict, error before commit, and error after commit with receipt lookup.

## Plans

Show current/proposed values, affected dimension, effective-date/price-version policy and reason. Pricing changes are not generic CRUD saves.

## Organization inspection

Show identity, subscription, plan, usage vs limits, operational alerts and audit/activity. Over-limit never deletes existing rooms.

## Jobs

Manual retry: inspect error/prior attempts -> verify retryable -> reason -> idempotent command -> resulting state. Bulk retry must show target count and partial-success summary.

## Technical logs

Read-only from observability. Future filters: time, service, level, safe organization correlation id, job/request correlation id. Never expose secrets/cookies/raw credentials.

## Audit

Read-only: actor, action, target, before/after, reason, timestamp.

## Foundation limitation

Current slice implements loaded/mock interaction paths. Real loading/empty/error/permission/conflict handling arrives with API integration and must be implemented before production release.

## Responsive/accessibility

Desktop/tablet uses sidebar + tables. Narrow screens use horizontally scrollable navigation and contained tables. Use persistent labels, visible focus, semantic controls, modal semantics and text status rather than color alone.
