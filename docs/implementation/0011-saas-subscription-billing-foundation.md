# Implementation Slice 0011 — SaaS Subscription Billing Foundation

## Implemented

- migration `0007_saas_subscription_billing.sql`;
- MONTHLY/YEARLY subscription billing interval;
- current billing period and `past_due_at`;
- versioned SaaS renewal invoice snapshots;
- independent payment transactions;
- payment allocations;
- partial payment support;
- derived paid/remaining balance;
- derived overdue state;
- idempotent manual CMS payment reconciliation;
- dedicated `platform.billing.manage` permission;
- CMS billing inspection per organization;
- delinquency transitions:
  - TRIALING/ACTIVE -> PAST_DUE;
  - PAST_DUE -> GRACE_PERIOD;
  - GRACE_PERIOD -> SUSPENDED;
- paid-period activation and recovery to ACTIVE;
- bounded `processDueBatch()` scheduler;
- authenticated internal billing sweep endpoint;
- separate BILLING worker role.

## Financial invariants

- all VND amounts are integer values;
- invoice amount/period/plan-version snapshot is not rewritten by current plan edits;
- a payment transaction is not an invoice mutation;
- allocations are the source for invoice paid/remaining balance;
- multiple transactions can fund one invoice;
- one transaction can support future multi-invoice allocation;
- manual overpayment is rejected until credit policy exists;
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

- provider webhook/event inbox;
- provider PaymentTransaction ingestion;
- unique auto-matching rules;
- REVIEW_REQUIRED reconciliation UI;
- refund/credit-balance policy;
- provider transaction search;
- scheduled cancellation-at-period-end;
- payment reminder notifications;
- external invoice/tax/legal document requirements.
