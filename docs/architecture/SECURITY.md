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

Các foreign key giữa những bảng tenant-owned quan trọng nên mang cả `organization_id` khi thực tế cho phép, để DB cũng từ chối tham chiếu chéo organization thay vì chỉ dựa vào application code.

## Membership, roles và scopes

User là identity toàn cục. Quyền của user trong từng organization nằm ở `OrganizationMembership`.

Baseline roles:
- `OWNER`;
- `ADMIN`;
- `MANAGER`;
- `STAFF`;
- `ACCOUNTANT`;
- `VIEWER`.

Business code authorize theo permission/capability, không rải `if role === ...` khắp code.

Một membership có một hoặc nhiều resource scopes:
- `ORGANIZATION`;
- `OPERATIONAL_GROUP`;
- `PROPERTY`.

Authorization phải thỏa cả:
1. membership đang ACTIVE;
2. đúng organization;
3. role có permission;
4. ít nhất một scope bao phủ resource.

Frontend chỉ phản ánh quyền để UX rõ ràng; enforcement bắt buộc nằm server-side.

## CMS / Platform operators

CMS là cross-organization surface dành cho platform operator và không được cấp quyền chỉ dựa trên tenant membership.

Baseline platform capabilities:
- `platform.cms.read`;
- `platform.settings.manage`;
- `platform.plans.manage`;
- `platform.entitlements.manage`;
- `platform.subscriptions.manage`;
- `platform.organizations.inspect`;
- `platform.jobs.manage`;
- `platform.audit.read`;
- `platform.logs.read`.

Rules:
- UI visibility is not authorization; backend always enforces platform permission.
- CMS never writes PostgreSQL directly.
- No generic SQL editor or raw secret viewer.
- Settings/plan/subscription/entitlement/job retry mutations require audit with actor, target, before/after, reason and timestamp.
- Cross-organization reads exist only through explicit `/api/cms/*` endpoints/application services.
- Tenant OWNER/ADMIN does not automatically become a CMS/platform principal.

## Public invoice

Public invoice không yêu cầu account nhưng phải dùng token:
- opaque;
- entropy cao;
- không tuần tự;
- có thể revoke/rotate;
- chỉ expose dữ liệu cần thiết.

Không đưa internal numeric IDs vào URL công khai nếu không cần.

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
- admin impersonation nếu có;
- thay đổi role/scope và các thao tác quyền hạn nhạy cảm;
- CMS settings/plan/subscription/entitlement/job retry mutations.

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

## Internal worker API

Notification workers never receive tenant/platform browser credentials and do not write PostgreSQL directly.

Worker execution endpoints live under `/api/internal/notifications/*` and require an `INTERNAL_WORKER_TOKEN` bearer token. The token is server-side only and must be stored in deployment secrets.

The API remains the authority for:
- commercial execution checks;
- quota consumption;
- durable job/attempt state;
- final send verification state.

A worker retry that already consumed quota may reuse the same consumption idempotently, but it must still pass the current subscription/organization write policy before a new provider attempt starts.
