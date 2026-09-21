# Notification Automation

## Mục tiêu

Không đặt mục tiêu "100% người nhận chắc chắn đọc tin". Mục tiêu vận hành là:

> Mọi recipient đã đi vào notification pipeline phải có durable state và attempt history; ambiguous provider state không bao giờ được tự nhận là thành công.

## Flow

```text
Business event / campaign request
   -> reserve automation quota
   -> NotificationCampaign QUEUED
   -> one NotificationJob per recipient
   -> separate Worker
   -> Provider Adapter
   -> SENT / RETRY_WAIT / FAILED / MANUAL_REVIEW
```

API request chỉ enqueue durable work. Không gửi hàng trăm tin trong một HTTP request.

## Durable state

### NotificationCampaign

- organization_id;
- channel/provider;
- message body;
- quota reservation;
- idempotency key + request fingerprint;
- total recipients;
- aggregate operational status.

### NotificationJob

- organization_id;
- campaign_id;
- recipient_key;
- provider;
- durable status;
- attempt_count/max_attempts;
- next_attempt_at;
- idempotency key;
- verification_state;
- last error;
- diagnostic evidence.

### NotificationAttempt

Mỗi provider attempt có:
- attempt_number;
- provider;
- started/finished timestamps;
- outcome;
- error code/message;
- bounded diagnostic evidence.

Không lưu cookie/session secret vào evidence.

## Commercial quota

Campaign reserve quota trước khi tạo jobs.

Recipient job consume đúng một unit khi claim lần đầu. Retry cùng durable job dùng consumption key cũ nên không trừ quota lần hai.

Worker re-check commercial access tại execution time. Organization/subscription bị suspended không được claim cho tới khi được mở lại.

## Playwright transition provider

Playwright có thể thay thế AHK trong giai đoạn chuyển tiếp nhưng phải chạy ở `apps/worker`, không nằm trong API process.

Provider adapter phải:
1. xác định đúng recipient;
2. verify conversation/recipient trước send;
3. thực hiện send;
4. verify evidence sau send;
5. chỉ trả `SENT_CONFIRMED` khi recipient và send đều được xác nhận;
6. chỉ trả transient failure khi chắc chắn chưa xảy ra send;
7. trả `UNKNOWN`/manual review cho logout, captcha, ambiguous recipient, UI breakage hoặc trạng thái hậu-send không xác định.

Generic worker exception được coi là `UNKNOWN`, không retry mù.

## Worker boundary

Worker gọi:
- `POST /api/internal/notifications/claim`;
- `POST /api/internal/notifications/{jobId}/complete`.

Các endpoint này yêu cầu `INTERNAL_WORKER_TOKEN`. Worker không ghi PostgreSQL trực tiếp.

## CMS operations

CMS đọc durable jobs và hiển thị:
- organization/recipient;
- job/campaign status;
- attempt count;
- verification state;
- provider;
- last error.

Operator có thể requeue `FAILED` hoặc `MANUAL_REVIEW` job. Retry bắt buộc reason, idempotency và platform audit.

## Provider abstraction

Core contract:

```text
NotificationProvider
  send(job) -> ProviderResult
```

Provider có thể là:
- PlaywrightZaloProvider;
- OfficialZaloProvider;
- SmsProvider;
- EmailProvider.

Billing/Commercial domain không biết provider cụ thể.
