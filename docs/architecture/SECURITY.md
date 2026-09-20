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

## CMS / Platform operators

CMS có cross-organization visibility nên không dùng tenant role thông thường.

Baseline platform capabilities:
- `platform.cms.read`;
- `platform.settings.manage`;
- `platform.plans.manage`;
- `platform.organizations.inspect`;
- `platform.jobs.manage`;
- `platform.audit.read`;
- `platform.logs.read`.

Rules:
- UI visibility is not authorization; backend always enforces platform permission.
- CMS never writes PostgreSQL directly.
- No generic SQL editor or raw secret viewer.
- Settings/plan/job retry mutations require audit with actor, target, before/after, reason and timestamp.
- Cross-organization reads exist only through explicit `/api/cms/*` endpoints/application services.

## Public invoice

Public invoice không yêu cầu account nhưng phải dùng token:
- opaque;
- entropy cao;
- không tuần tự;
- có thể revoke/rotate;
- chỉ expose dữ liệu cần thiết.

Không đưa internal numeric IDs vào URL công khai nếu không cần.

## Roles

Tenant baseline:
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
- CMS settings/plan/job retry mutations;
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
