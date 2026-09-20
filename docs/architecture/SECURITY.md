# Security & Multi-tenancy

## Tenant isolation

Mọi aggregate thuộc khách hàng phải có `organization_id`.

Truy vấn phải scope theo organization của principal hiện tại, ví dụ về logic:

```text
find room where
  id = requested_room_id
  AND organization_id = current_organization_id
```

Không bao giờ authorize chỉ bằng room_id/invoice_id.

## Public invoice

Public invoice không yêu cầu account nhưng phải dùng token:
- opaque;
- entropy cao;
- không tuần tự;
- có thể revoke/rotate;
- chỉ expose dữ liệu cần thiết.

Không đưa internal numeric IDs vào URL công khai nếu không cần.

## Roles

Baseline:
- OWNER/ADMIN;
- MANAGER;
- STAFF;
- READ_ONLY.

Authorization nên dùng permission/capability ở domain layer thay vì chỉ ẩn nút frontend.

## Secrets

Không commit:
- DB password;
- SePay token;
- banking credentials;
- Playwright session/cookie;
- Telegram token.

Dùng environment/secrets manager.

## Audit

Ghi audit cho:
- thay đổi pricing;
- chỉnh meter reading;
- issue/cancel invoice;
- manual payment allocation;
- thay đổi bank/integration config;
- admin impersonation nếu có.

## Webhooks

- verify provider signature/secret nếu provider hỗ trợ;
- lưu raw payload;
- unique provider_event_id;
- xử lý async;
- endpoint trả nhanh;
- retry idempotent.

## Browser automation

Playwright session là credential nhạy cảm:
- mã hóa khi lưu;
- giới hạn quyền truy cập;
- tách worker;
- không log cookie/token;
- invalidate khi nghi ngờ lộ.
