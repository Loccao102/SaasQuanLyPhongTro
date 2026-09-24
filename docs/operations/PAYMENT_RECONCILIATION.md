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


## SePay renter-payment production adapter

Habi now has a production SePay edge adapter for renter payments.

Runtime contract:

```text
SePay
 -> POST /api/integrations/renter-payment-webhooks/sepay
 -> verify HMAC against the exact raw request body
 -> persist renter_payment_webhook_events
 -> RENTER_PAYMENT_WEBHOOK worker
 -> normalize SePay transaction
 -> provider-neutral renter payment processor
 -> PaymentTransaction / PaymentAllocation
```

Deployment configuration:

- configure the SePay webhook with JSON request content;
- use HMAC-SHA256 authentication;
- configure the same secret in `SEPAY_RENTER_WEBHOOK_SECRET`;
- set the renter-payment worker to `RENTER_PAYMENT_WEBHOOK_PROVIDER=SEPAY`;
- use a public HTTPS endpoint in Live mode;
- configure incoming transactions only when possible;
- configure SePay payment-code extraction for the `RENT` prefix so `code`
  can carry Habi's immutable renter invoice payment reference.

Ingress rules:

- verify `X-SePay-Signature` against `{timestamp}.{raw_body}`;
- reject timestamps more than 300 seconds from server time;
- never reserialize parsed JSON before HMAC verification;
- invalid signatures are persisted under a raw-body-derived event key and
  never reserve the genuine SePay transaction id;
- verified SePay `id` is the provider event / transaction id;
- successful verified ingress responds HTTP 200 with `{"success":true}`;
- raw signature/secret values are not persisted as safe headers.

Normalization rules:

- only `transferType=in` is treated as a payment;
- `transferAmount` stays integer VND;
- `transactionDate` is interpreted as Vietnam time for SePay's
  `YYYY-MM-DD HH:mm:ss` payload;
- payment reference prefers `code`, then a strict Habi `RENT...` token in
  `content`;
- no fuzzy reference guess is allowed;
- SePay `accountNumber` is normalized as `destinationAccountNo`.

Automatic allocation additionally checks the destination account when a
provider supplies one. If it does not match the organization's active payment
profile, the provider transaction is retained but reconciliation becomes
`REVIEW_REQUIRED` and the invoice is not changed.

Operational follow-up still required:

- configure NTP on production hosts because timestamp validation is time based;
- alert on repeated invalid signatures and REVIEW_REQUIRED growth;
- run periodic SePay transaction reconciliation to recover webhook gaps;
- exercise SePay Test mode and Live delivery logs before enabling a real bank
  account;
- define secret rotation procedure with an overlap/cutover plan.
