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
5. SaaS Billing
6. Entitlement overrides
7. Jobs / Queue
8. Technical logs
9. Audit log

## Settings

Flow: find setting -> inspect -> edit -> review impact -> provide reason -> submit -> success/audit receipt.

Production states include invalid value, permission denied, optimistic/version conflict, error before commit, and error after commit with receipt lookup.

## Plans

Show current/proposed values, affected dimension, effective-date/price-version policy and reason. Pricing changes are not generic CRUD saves.

## Organization inspection

Primary flow: open Organizations -> search by name/slug/owner/UUID -> filter by plan, subscription status, tenant status, delinquency or over-limit -> inspect cursor-paginated results -> open a direct organization detail route.

Filters are preserved in the URL so operators can refresh/share a working view without loading the full tenant population. Detail shows identity, subscription, plan, latest SaaS billing snapshot, usage vs limits and commercial flags. Over-limit never deletes existing rooms.

Required states: loading, empty filtered result, API error + retry, loaded page, next-page loading, end-of-list and detail not-found/permission failure.

## Subscription cancellation

For ACTIVE/TRIALING organizations, platform admins have two distinct controls:
- immediate status transition to CANCELLED for forced termination;
- **Cancel at period end** for normal non-renewal.

Scheduled cancellation keeps access through the current period, suppresses renewal invoice creation, and voids only unpaid renewal invoices with `void_reason=SCHEDULED_CANCELLATION`. Undo reopens only those cancellation-voided invoices. A future billing period with allocated money blocks scheduling until refund/credit handling is resolved.

The command requires optimistic subscription version, audit reason and idempotency key.

## SaaS Billing

Primary job: understand subscription collection exposure and safely reconcile provider money without rewriting provider transactions.

Review queue flow: inspect provider/transaction/reference/amount -> inspect exact-reference suggestion if present -> choose target SaaS invoice -> enter explicit allocation amount -> review payment/invoice balances -> provide audit reason -> Allocate payment -> observe updated balances and audit receipt.

Financial safeguards:
- only `platform.billing.read` may inspect reconciliation data;
- only `platform.billing.manage` may allocate;
- original provider PaymentTransaction is preserved;
- PaymentAllocation is append-only;
- allocation cannot exceed payment unallocated balance or invoice remaining balance;
- payment already assigned to organization A cannot be allocated to organization B;
- unsafe or ambiguous matches remain REVIEW_REQUIRED;
- duplicate operator submit is idempotent.

Loaded states include empty review queue, no open invoices, exact reference suggestion, unmatched reference, partially allocated payment, overdue invoice, server validation error and successful reconciliation.

Provider transaction search flow: enter payment UUID/provider transaction ID/payment reference -> optionally filter provider and reconciliation status -> inspect cursor-paginated results -> copy safe identifiers/reference -> open transaction detail -> inspect allocation history, linked webhook events and audit history when authorized. Search/detail responses intentionally omit raw provider metadata, idempotency keys, raw webhook bodies and headers.

Transaction detail states include loading, not found/error, unassigned payment, no allocations, partial allocation, fully allocated payment, webhook linkage and audit-permission unavailable. Allocation history is append-only and shows target invoice, amount, actor id/system source, reason and timestamp.

Provider-payment search/detail links assigned organizations directly to `/organizations/:organizationId` and allocation targets directly to `/billing/invoices/:invoiceId`. SaaS invoice detail is read-only and shows the immutable invoice snapshot, derived paid/remaining balance, payment allocations, safe payment/provider identifiers, allocation actor display name when permitted, and permission-aware audit history. It never exposes payment metadata, idempotency keys, raw webhook bodies or headers.

Webhook inbox shows operational state only: provider event id, signature state, processing state, attempts/stale flag, sanitized last error and linked payment id. Raw provider body and headers are not rendered.

Webhook recovery flow: inspect FAILED/REVIEW_REQUIRED event -> confirm signature is VERIFIED -> fix the parser/provider cause -> Requeue with audit reason -> event returns to RECEIVED while attempt history remains. Backend rejects requeue for unverified signatures, linked payments or unsupported states.

## Jobs

Manual retry: inspect error/prior attempts -> verify retryable -> reason -> idempotent command -> resulting state. Bulk retry must show target count and partial-success summary.

## Technical logs

Read-only from observability. Future filters: time, service, level, safe organization correlation id, job/request correlation id. Never expose secrets/cookies/raw credentials.

## Audit

Read-only: actor, action, target, before/after, reason, timestamp.

## Foundation limitation

CMS is API-backed. Remaining production gaps are real login/session middleware, finer UI permission gates, observability integration and provider-specific payment/notification adapters.

## Responsive/accessibility

Desktop/tablet uses sidebar + tables. Narrow screens use horizontally scrollable navigation and contained tables. Use persistent labels, visible focus, semantic controls, modal semantics and text status rather than color alone.


## Operational observability

Platform operators with `platform.logs.read` use the Observability surface to inspect current runtime health without exposing raw provider payloads or secrets.

The surface shows API 5xx/error rate, max observed latency, DB pool pressure, slow DatabaseService operations, notification queue age/state, billing webhook backlog/staleness and unified worker heartbeats for notification, billing scheduler and billing webhook workers.

The public monitoring integration is not an anonymous endpoint: Prometheus-compatible scraping uses `/api/metrics` with a dedicated bearer token. Central log aggregation remains a separate infrastructure concern.
