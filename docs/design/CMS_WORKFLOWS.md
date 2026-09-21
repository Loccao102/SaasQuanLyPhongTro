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

Show identity, subscription, plan, usage vs limits, operational alerts and audit/activity. Over-limit never deletes existing rooms.

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
