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
- thay đổi role/scope và các thao tác quyền hạn nhạy cảm.

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
