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
