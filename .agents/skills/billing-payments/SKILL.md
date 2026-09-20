---
name: propops-billing-payments
description: Use when implementing pricing, billing cycles, invoices, invoice lines, VietQR/payment codes, payment webhooks, matching, allocations, partial payments, or collection status.
---

1. Treat invoice data as an immutable financial snapshot except through explicit adjustment/cancel flows.
2. Compute amounts with exact integer/fixed decimal arithmetic.
3. Separate Invoice from PaymentTransaction via PaymentAllocation.
4. Support multiple transactions per invoice from the beginning.
5. Persist raw webhook events before asynchronous processing.
6. Make webhook processing idempotent with provider event/transaction uniqueness.
7. Auto-match only when rules produce a unique, safe result; otherwise route to REVIEW_REQUIRED.
8. Recompute paid_amount/remaining_amount from allocations or a transactionally safe projection.
9. Publish payment-state changes only after DB commit.
10. Test exact payment, partial payment, overpayment policy, duplicate webhook, wrong payment code, and manual reconciliation.
