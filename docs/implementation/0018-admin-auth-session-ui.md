# Implementation Slice 0018 — Admin Authentication Session UI

## Product design preflight

Surface:
- Admin Web.

Primary personas:
- OWNER / ADMIN / MANAGER / STAFF / ACCOUNTANT / VIEWER with an ACTIVE organization membership.

Permission and scope:
- login itself is global user authentication;
- workspace selection chooses an organization only;
- every tenant endpoint still resolves membership + scopes server-side;
- switching workspace never grants access by itself.

Job-to-be-done:
- sign in once, choose an authorized workspace, and continue all Admin operations with the same trusted browser session.

Main flow:
1. open Admin;
2. auth provider checks `GET /api/auth/me`;
3. unauthenticated users are routed to `/login`;
4. successful login receives opaque HttpOnly session + CSRF cookies;
5. first ACTIVE membership is selected, or the previous valid workspace is restored;
6. tenant requests carry `X-Organization-Id`;
7. unsafe requests also carry `X-CSRF-Token`;
8. workspace switch persists selection and reloads tenant data;
9. logout revokes the server session and clears browser selection.

Critical states:
- session loading;
- login validation/network/auth error;
- authenticated;
- authenticated with zero ACTIVE workspaces;
- session expired -> redirect to login;
- workspace switch;
- auth backend unavailable -> retry state.

Responsive:
- login is phone-safe but optimized for desktop/tablet Admin;
- workspace selector remains in sidebar and disappears with the existing compact mobile sidebar behavior.

Reusable patterns:
- `AdminAuthProvider`;
- shared `adminApiRequest`;
- existing buttons/brand/state-card visual language.

## Same-origin API transport

Admin browser calls default to `/api`.

Next.js rewrites that path to `ADMIN_API_PROXY_TARGET` (default local Nest API). This keeps browser cookies host-only to the Admin origin, including production `__Host-` session/CSRF cookies.

Other surfaces keep their existing API transport until their own auth/public-security slices are migrated.

## Security notes

- readable CSRF cookie is used only to echo the random CSRF token in the header;
- session cookie remains HttpOnly and is never read by frontend JavaScript;
- organization ID persisted in localStorage is a selector, not a credential;
- backend membership/scope checks remain authoritative;
- 401 responses broadcast an auth-expired event so the shell redirects to login.

## Follow-up

- Staff PWA session UX should reuse the auth/session contract with offline-aware behavior.
- Account security screen (active sessions, password change, MFA) remains hardening work.
