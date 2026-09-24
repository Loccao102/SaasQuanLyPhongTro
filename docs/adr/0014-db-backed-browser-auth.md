# ADR-0014: DB-backed Browser Sessions and Trusted Principals

- Status: Accepted
- Date: 2026-09-25

## Context

Tenant and CMS guards already understand trusted `authenticatedUserId`, but development currently falls back to environment user IDs. The product needs real browser authentication before production tenant/CMS mutations can rely on those guards.

The product also has multiple organizations per user, so the browser-selected organization cannot itself be trusted as authorization.

## Decision

Use first-party database-backed opaque sessions.

Password credentials:
- scrypt with unique random salt;
- baseline `N=2^17, r=8, p=1`;
- asynchronous derivation;
- no plaintext/reversible password storage.

Session:
- 256-bit CSPRNG token returned only to the browser;
- only SHA-256 token hash is persisted;
- session carries the user's current auth version;
- changing `users.auth_version` invalidates all previous sessions;
- server-side expiry and revocation.

Browser transport:
- session token in HttpOnly SameSite=Lax cookie;
- CSRF token in a separate readable SameSite=Lax cookie;
- unsafe tenant/CMS requests require matching `X-CSRF-Token`;
- unsafe browser requests with an Origin header must come from configured CORS origins;
- production cookies are Secure and use host-only `__Host-` defaults.

Organization selection:
- client sends `X-Organization-Id`;
- server treats it only as a selector;
- `TenantPrincipalGuard` loads membership/scopes from PostgreSQL before authorization.

Platform access:
- CMS session resolves user identity first;
- `CmsPlatformGuard` separately verifies ACTIVE platform operator role;
- tenant OWNER/ADMIN does not imply platform access.

Public invoice/internal worker endpoints remain outside browser session auth and keep their dedicated security model.

## Consequences

Positive:
- immediate session revocation is possible;
- no long-lived bearer JWT claims can go stale;
- memberships/scopes remain source-of-truth in PostgreSQL;
- auth vendor/OIDC can be added later behind the same trusted-principal seam.

Constraints:
- authenticated requests perform session + membership lookup;
- deployment-level abuse/rate controls are still required before public launch;
- password reset, MFA and external identity providers remain separate hardening slices;
- dev fallback IDs remain temporarily available outside production only.
