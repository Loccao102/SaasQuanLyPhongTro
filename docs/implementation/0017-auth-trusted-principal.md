# Implementation Slice 0017 — Authentication & Trusted Principal

## Architecture preflight

Owning module: Identity/Auth.

Tenant boundary:
- user identity/session is global;
- tenant authorization remains membership + scope based;
- browser-provided organization ID is never trusted without membership lookup;
- CMS platform role remains separate from tenant membership.

Idempotency:
- login creates a new session intentionally;
- logout is idempotent;
- owner bootstrap preserves an existing password credential instead of resetting it.

Audit:
- business/domain audit remains in owning modules;
- auth security-event audit/rate-limit telemetry is deferred to hardening.

Failure states:
- invalid credentials use one generic error;
- expired/revoked/auth-version-stale session is unauthenticated;
- unsafe cookie-authenticated mutation without CSRF is rejected;
- inactive user/membership/organization remains rejected by existing guards.

## Credential storage

Password hashing uses async scrypt:
- N = 2^17;
- r = 8;
- p = 1;
- 16-byte random salt;
- 64-byte derived key.

Passwords are never silently truncated. New passwords require at least 12 UTF-8 bytes and reject input over 1024 bytes. Unknown-email login still performs the scrypt derivation against a dummy credential before returning the generic invalid-credential error.

## Session model

`auth_sessions` stores user, auth version, token hash, CSRF hash, expiry and revocation timestamps.

The browser receives:
- HttpOnly session cookie;
- readable CSRF cookie used for `X-CSRF-Token`.

Raw session/CSRF values are not stored in PostgreSQL.

## Guard integration

`TenantPrincipalGuard` resolves session user, verifies CSRF/origin for unsafe browser mutations, then resolves selected organization membership/scopes.

`CmsPlatformGuard` resolves session user, verifies CSRF/origin for unsafe browser mutations, then verifies platform operator access.

Development env-user fallback remains only when `NODE_ENV !== production`.

## Endpoints

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

No public sign-up/reset flow is introduced.

## Bootstrap

`pnpm --filter @propops/api auth:bootstrap-owner` provisions user, organization, OWNER membership/scope and a password credential if one does not already exist.

## Verification

Unit:
- scrypt hash/verify;
- short-password rejection.

PostgreSQL integration:
- invalid password;
- session creation;
- membership discovery;
- raw token not persisted;
- CSRF verification;
- logout revocation;
- auth-version invalidation.
