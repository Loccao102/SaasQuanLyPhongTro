# ADR-0011: SaaS Subscription Billing Ledger and Scheduler Boundary

- Status: Accepted
- Date: 2026-09-21

## Context

PropOps needs platform-level billing for organizations that subscribe to the SaaS. This is separate from rent/utility invoices paid by residents.

The Control Plane must answer:
- which billing interval the organization uses;
- which SaaS billing period is current/next;
- how much the renewal invoice is;
- how much has actually been paid;
- whether a balance is overdue;
- whether delinquency should move the subscription through PAST_DUE, GRACE_PERIOD and SUSPENDED.

Payment providers such as SePay or future gateways must remain Edge integrations.

## Decision

### Financial model

SaaS billing uses three separate concepts:

```text
SaaS Subscription Invoice
        ^
        |
Payment Allocation
        |
        v
Payment Transaction
```

`saas_subscription_invoices` is an immutable billing-period snapshot of:
- organization/subscription;
- plan + plan version;
- MONTHLY/YEARLY interval;
- period start/end;
- integer VND amount;
- due date;
- collection status.

`saas_subscription_payments` records money movement independently from invoices. Provider identity/transaction IDs live here.

`saas_subscription_payment_allocations` applies one payment transaction to one or more invoices and allows multiple payment transactions per invoice.

Partial payment is supported from the beginning. Manual allocation currently rejects overpayment rather than silently creating credit.

### Invoice state and overdue

Invoice collection state is:
- OPEN;
- PARTIALLY_PAID;
- PAID;
- VOID.

Overdue is derived from:
- due date reached;
- invoice still has a remaining balance;
- invoice is not VOID.

It is not stored as a mutually exclusive invoice status because an invoice can be both partially paid and overdue.

### Subscription lifecycle

Billing scheduler semantics:

```text
renewal lead window
  -> create renewal invoice

period start reached + remaining balance
  -> PAST_DUE

past_due_warning_days elapsed
  -> GRACE_PERIOD

grace_period_days elapsed
  -> SUSPENDED
```

A fully paid invoice activates its billing period only when `period_start <= now`. Paying a future renewal early does not prematurely advance the current subscription period.

When an effective paid period is activated:
- subscription returns to ACTIVE;
- current period moves to that invoice period;
- trial/past-due/grace timestamps clear;
- subscription optimistic version increments.

### Runtime boundary

The same `@propops/worker` artifact supports isolated deployment roles:
- `WORKER_ROLE=NOTIFICATION`;
- `WORKER_ROLE=BILLING`.

These roles are separate processes. Playwright/browser failure therefore cannot stop SaaS billing progression.

The billing worker calls authenticated `/api/internal/billing/sweep`. It never writes PostgreSQL directly.

### CMS manual reconciliation

CMS may record a verified manual payment only through the Billing application service.

The command requires:
- `platform.billing.manage`;
- invoice ID;
- exact integer VND amount received;
- reason;
- idempotency key.

Every operator command and financial allocation is auditable.

## Consequences

- Payment-provider webhooks can later persist provider transactions without changing invoice/subscription schemas.
- Partial payments and multiple transfers are supported without migration redesign.
- A future unmatched provider transaction can remain UNALLOCATED or REVIEW_REQUIRED.
- Current manual reconciliation intentionally rejects overpayment until a credit-balance policy is defined.
- Billing scheduling is horizontally repeatable because invoice uniqueness, organization locks and explicit state transitions make duplicate sweeps safe.
