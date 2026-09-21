# Implementation Slice 0011 — SaaS Subscription Billing Foundation

## Implemented

- migration `0007_saas_subscription_billing.sql`;
- MONTHLY/YEARLY subscription billing interval;
- current billing period and `past_due_at`;
- versioned SaaS renewal invoice snapshots;
- independent payment transactions;
- append-only payment allocations;
- partial payment support;
- derived paid/remaining balance;
- derived overdue state;
- idempotent manual CMS payment reconciliation;
- dedicated `platform.billing.read` / `platform.billing.manage` permissions;
- CMS billing inspection per organization;
- migration `0008_saas_billing_provider_inbox.sql`;
- unique invoice payment references;
- raw provider webhook inbox with payload fingerprinting;
- signature gating before processing;
- normalized provider PaymentTransaction ingestion;
- safe exact-reference auto-match;
- REVIEW_REQUIRED routing for unmatched/overpay/unsafe cases;
- CMS SaaS Billing reconciliation queue;
- audited/idempotent provider payment allocation;
- cross-organization allocation rejection;
- delinquency transitions:
  - TRIALING/ACTIVE -> PAST_DUE;
  - PAST_DUE -> GRACE_PERIOD;
  - GRACE_PERIOD -> SUSPENDED;
- paid-period activation and recovery to ACTIVE;
- bounded `processDueBatch()` scheduler;
- authenticated internal billing sweep endpoint;
- separate BILLING worker role;
- isolated BILLING_WEBHOOK worker role;
- provider-neutral webhook adapter contract;
- transaction-safe raw-event -> normalized payment processing;
- stale PROCESSING reclaim with attempt history;
- replay-safe event/payment fingerprint linkage;
- CMS webhook inbox observability and audited requeue;
- raw-body capture for signature verification;
- dev-only HMAC ingress adapter + endpoint for end-to-end plumbing tests.

## Financial invariants

- all VND amounts are integer values;
- invoice amount/period/plan-version snapshot is not rewritten by current plan edits;
- a payment transaction is not an invoice mutation;
- allocations are the source for invoice paid/remaining balance;
- multiple transactions can fund one invoice;
- one transaction can fund multiple invoices through append-only allocations;
- allocation cannot exceed payment unallocated balance or invoice remaining balance;
- duplicate manual command/payment idempotency does not create another transaction/allocation;
- fully paying a future period does not advance subscription before the period starts.

## CMS workflow

Organizations show:
- subscription status/version;
- billing interval;
- current/trial period;
- latest SaaS invoice;
- total / allocated / remaining;
- derived overdue state;
- paid timestamp.

For OPEN/PARTIALLY_PAID invoices with remaining balance, PLATFORM_ADMIN can use “Ghi nhận thanh toán”.

The confirmation shows exact organization, invoice, period, balances and consequence, requires the real amount received plus audit reason, then calls the Billing service.

## Pending

- production provider-specific public webhook adapter/signature verifier (for example SePay);
- production provider-specific normalization adapter;
- refund/credit-balance policy;
- provider transaction search;
- scheduled cancellation-at-period-end;
- payment reminder notifications;
- external invoice/tax/legal document requirements.
