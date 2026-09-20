# Notification Automation

## Mục tiêu

Không đặt mục tiêu "100% người nhận chắc chắn đọc tin". Mục tiêu vận hành là:

> 100% invoice đi vào notification pipeline phải có trạng thái cuối cùng rõ ràng; không có invoice thất lạc âm thầm.

## Flow

```text
Invoice ISSUED
   -> NotificationJob PENDING
   -> Provider Adapter
   -> SENT / RETRY / NEEDS_ATTENTION
```

## Playwright transition provider

Playwright có thể thay thế AHK trong giai đoạn chuyển tiếp nhưng phải là Edge worker riêng.

Không gọi browser automation trực tiếp từ API request.

### Worker responsibilities

1. Nhận một job.
2. Mở đúng conversation.
3. Verify recipient bằng dữ liệu nhận diện khả dụng.
4. Gửi nội dung/link.
5. Verify message xuất hiện trong conversation.
6. Ghi attempt result.
7. Retry có giới hạn nếu lỗi kỹ thuật.
8. Dừng/đánh dấu NEEDS_ATTENTION khi logout/captcha/UI bất thường.

## Data model

NotificationJob:
- id;
- organization_id;
- invoice_id;
- recipient_id;
- channel;
- provider;
- status;
- idempotency_key;
- attempt_count;
- next_attempt_at;
- last_error_code;
- last_error_message;
- created_at;
- completed_at.

NotificationAttempt:
- job_id;
- attempt_no;
- started_at;
- finished_at;
- result;
- diagnostic reference.

Screenshot/trace có thể lưu phục vụ debug nhưng phải tránh chứa secrets quá mức cần thiết.

## Provider abstraction

```text
NotificationProvider
  send(job) -> DeliveryResult
```

Implementations có thể gồm:
- PlaywrightZaloProvider;
- OfficialZaloProvider;
- SmsProvider;
- EmailProvider.

Billing domain không biết provider cụ thể.

## Reliability

- idempotency key ngăn gửi trùng do retry;
- exponential backoff cho transient error;
- circuit breaker/pause khi provider bất thường;
- manual review queue cho lỗi không tự xử lý được;
- dashboard luôn hiển thị UNKNOWN = 0 như một invariant vận hành.
