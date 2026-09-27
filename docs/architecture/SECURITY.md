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

Tenant user là identity của đúng một organization. `users.organization_id` là tenant binding của account; `OrganizationMembership` giữ role, trạng thái và scope trong chính organization đó. Platform/CMS user là `account_type=PLATFORM` và không có tenant organization.

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


## Browser authentication

Browser authentication uses opaque database-backed sessions.

Rules:
- password credentials use salted asynchronous scrypt; never plaintext or reversible encryption;
- only a SHA-256 hash of the session token is persisted;
- session expiry/revocation and `users.auth_version` are checked server-side;
- production session cookies are HttpOnly, Secure and host-only;
- unsafe cookie-authenticated tenant/CMS mutations require `X-CSRF-Token`;
- browser `Origin` must match configured CORS origins when present;
- tenant sessions persist `organization_id`; this session tenant is authoritative;
- if `X-Organization-Id` disagrees with the authenticated session tenant, the request is rejected;
- `TenantPrincipalGuard` resolves ACTIVE membership/scopes from PostgreSQL and enforces required commercial feature entitlements;
- `CmsPlatformGuard` separately resolves ACTIVE platform-operator access.

Development env user-ID fallbacks are forbidden in production and exist only as a temporary local migration aid.

Google Identity Services is supported as an external credential source, but successful Google verification is converted into the same opaque Habi session. Google ID tokens are verified server-side for signature, issuer, audience, authorized party when multiple audiences are present, expiry, stable subject, verified email and a short-lived browser-bound nonce.

Before public launch, email verification/password recovery and an MFA policy for privileged OWNER/PLATFORM identities must be completed. Login abuse controls and self-service session management are implemented.

## Authentication abuse protection

Public authentication endpoints are protected by database-backed, horizontally safe rate-limit buckets:

- password login is limited by both normalized email and client IP;
- tenant registration is limited by client IP;
- Google challenge/token exchange is limited by client IP;
- password-change attempts are rate-limited as authentication attempts.

Rate-limit and authentication security telemetry stores HMAC-derived identifier/IP hashes instead of raw email/IP values. CMS operators with `platform.audit.read` can inspect recent authentication security events.

Staff offline authorization is intentionally shorter than the browser session. A cached Staff authorization may be used offline for at most 24 hours after the last successful online verification. A reconnect refreshes account, tenant, membership and feature state before continuing online operations.

## Google identity security

Google Identity Services is used only as a federated identity source for tenant authentication.

Rules:

- Habi does not persist Google access or refresh tokens for sign-in;
- every Google button flow first obtains a short-lived Habi nonce challenge;
- the nonce is stored in a host-bound HttpOnly cookie and included in the Google ID token request;
- backend verification requires signature, `iss`, `aud`, `exp`, verified email, stable `sub` and the expected nonce;
- the nonce cookie is cleared after the Google authentication attempt;
- Google identities are linked using the stable provider `sub`, never email as the provider primary key;
- automatic email linking is allowed only when Google is authoritative for the email and only for `TENANT` accounts;
- the public tenant Google flow cannot authenticate or link `PLATFORM`/CMS identities.

If Habi later needs Google APIs, OAuth authorization for those scopes must be a separate consent/token-storage integration rather than expanding the login credential flow.

## HTTP/browser security baseline

Production startup fails closed when required security configuration is missing or unsafe:

- `CORS_ORIGINS` is mandatory and must contain explicit HTTPS origins;
- credentialed CORS never accepts wildcard origins;
- authentication cookies use `__Host-` names, Secure, host-only Path=/ semantics;
- development principal fallbacks are forbidden;
- internal worker/metrics tokens and auth-security HMAC key must be non-placeholder secrets;
- reverse-proxy trust is explicit through `TRUST_PROXY_HOPS`.

API and browser surfaces send baseline anti-clickjacking/content-sniffing/referrer/permissions headers. Production enables HSTS. Sensitive auth/CMS API responses are marked `no-store`.

## Supply-chain baseline

CI installs exactly the committed pnpm lockfile with `--frozen-lockfile` and performs a production dependency audit that fails on critical advisories.

Dependency scanning is one control, not proof that the software supply chain is safe. Changes to build actions, registries, lockfiles and deployment artifacts still require review.

## Security events and exceptional conditions

Authentication failures, successful authentication, rate limiting and password changes emit dedicated security events without raw credentials, tokens, email addresses or IP addresses.

Unexpected errors must not cause the client to infer success. Worker/API integrations must treat empty or malformed responses explicitly, preserve durable failure state where relevant and avoid logging secrets.

