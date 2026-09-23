# Payment & Reconciliation

## Flow

```text
Bank transaction
 -> SePay webhook
 -> WebhookEvent persisted
 -> PaymentTransaction
 -> Matcher
 -> PaymentAllocation
 -> Invoice recalculation
 -> PAID / PARTIALLY_PAID / REVIEW_REQUIRED
```

## Idempotency

Webhook có thể được gửi lại.

Bắt buộc có unique key phù hợp, ví dụ:
```text
(provider, provider_transaction_id)
```

Một provider event chỉ tạo financial effect một lần.

## Matching

Ưu tiên mã payment/invoice có entropy và format rõ ràng.

Matcher không được tự động gạch nợ khi confidence thấp hoặc tồn tại nhiều candidate.

Không match được -> REVIEW_REQUIRED.

## Partial payment

Invoice:
- total_amount;
- paid_amount;
- remaining_amount.

Một invoice có thể nhận nhiều allocation.

## Audit

Lưu:
- raw webhook event;
- parsed transaction;
- matching decision;
- manual override;
- allocation history.

Không sửa/xóa dấu vết giao dịch gốc để "làm sạch" dữ liệu.

## Realtime

Khi invoice state thay đổi, publish internal event và SSE cho public invoice đang mở.

Realtime là presentation; source of truth vẫn là PostgreSQL.


## Implemented renter-payment baseline

The renter-payment domain now keeps financial concerns separated:

```text
RenterInvoice
  <- PaymentAllocation
      <- PaymentTransaction
```

Implemented baseline:

- manual PaymentTransaction creation with stable client UUID idempotency;
- one or more PaymentAllocations per invoice over time;
- integer-VND paid/remaining projection on renter invoices;
- UNPAID / PARTIALLY_PAID / PAID collection status;
- transactionally locked invoice allocation to prevent concurrent over-allocation;
- overpayment blocked pending an explicit excess-payment policy;
- payment.read vs payment.reconcile permission/scope enforcement;
- audited manual allocation history;
- Admin financial review/confirmation before recording a manual payment.

Provider/webhook ingestion must reuse these tables rather than attach provider transactions directly to invoices. Reversal/refund/correction is intentionally a separate explicit financial flow.


## Renter provider webhook ingestion baseline

The shared billing webhook inbox and worker now dispatch normalized payments by payment-reference namespace:

```text
SAAS... -> subscription billing
RENT... -> renter payment matcher
unknown / missing namespace -> REVIEW_REQUIRED
```

Renter provider handling:

- raw provider bytes are still persisted in the existing webhook inbox before processing;
- provider event replay remains idempotent;
- `(provider, provider_transaction_id)` is globally unique for renter provider transactions;
- multiple provider event IDs may link to the same provider transaction;
- a unique renter invoice payment reference is used for deterministic matching;
- safe matches allocate only when the invoice is ISSUED, has remaining balance, and the provider amount does not exceed remaining;
- unknown renter references persist an UNMATCHED provider transaction;
- overpayment, already-paid invoices, or non-issued invoices route to REVIEW_REQUIRED without allocation;
- unknown payment-reference namespaces do not guess a domain and leave the webhook event REVIEW_REQUIRED;
- provider allocations update the same paid/remaining projection as manual allocations.

This is provider-ingestion/matching infrastructure, not a production bank adapter. A production adapter still needs provider-specific signature verification and payload normalization.
