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

Partial payment is supported from the beginning. Payment allocations are append-only financial history; idempotency protects retries instead of a one-row-per-payment/invoice uniqueness shortcut.

Manual allocation currently rejects allocation beyond the payment's unallocated balance or the invoice's remaining balance rather than silently creating credit.

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

### Provider event inbox and matching

Provider-specific adapters do not mutate SaaS invoices directly.

Raw provider callbacks are first persisted in `saas_billing_webhook_events` with:
- provider + provider event id uniqueness;
- raw body + SHA-256 fingerprint;
- signature status;
- processing lifecycle and errors.

Only `VERIFIED` events are eligible for automatic processing. `INVALID` events are retained as IGNORED; `NOT_CONFIGURED` events are retained as REVIEW_REQUIRED.

Each SaaS invoice has a unique `payment_reference`.

A normalized provider payment becomes a PaymentTransaction before reconciliation. Safe automatic allocation requires:
- exact unique payment reference;
- invoice still has remaining balance;
- incoming amount does not exceed invoice remaining balance.

No match, paid/void target, or overpayment creates/keeps a provider PaymentTransaction in `REVIEW_REQUIRED` without changing invoice balance.

Provider transaction replay requires the same provider transaction id, amount, occurred-at instant and payment reference.

### Runtime boundary

The same `@propops/worker` artifact supports isolated deployment roles:
- `WORKER_ROLE=NOTIFICATION`;
- `WORKER_ROLE=BILLING`.

These roles are separate processes. Playwright/browser failure therefore cannot stop SaaS billing progression.

The billing worker calls authenticated `/api/internal/billing/sweep`. It never writes PostgreSQL directly.

### CMS manual reconciliation

CMS supports two explicit financial workflows through the Billing application service:

1. Record a verified manual payment directly against a known SaaS invoice.
2. Reconcile a provider PaymentTransaction in `REVIEW_REQUIRED` by allocating an explicit integer VND amount to a selected SaaS invoice.

Provider reconciliation preserves the original provider transaction and appends PaymentAllocation history. Cross-organization allocation is rejected server-side.

Manual payment recording requires:

- `platform.billing.manage`;
- invoice ID;
- exact integer VND amount received;
- reason;
- idempotency key.

Every operator command and financial allocation is auditable.

## Consequences

- Provider webhook inbox persistence and normalized PaymentTransaction ingestion are already provider-neutral.
- Partial payments, multiple transfers and append-only reconciliation allocations are supported without migration redesign.
- Unmatched/unsafe provider transactions remain REVIEW_REQUIRED until an operator reconciles them.
- Current manual reconciliation intentionally rejects overpayment until a credit-balance policy is defined.
- Billing scheduling is horizontally repeatable because invoice uniqueness, organization locks and explicit state transitions make duplicate sweeps safe.
