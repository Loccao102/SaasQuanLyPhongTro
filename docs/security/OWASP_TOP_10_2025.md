# OWASP Top 10:2025 Security Baseline

Status: implementation baseline, not a certification.

OWASP Top 10 is an awareness/risk-prioritization document. Habi uses it as a minimum review lens together with the repository's architecture/security invariants. Passing this checklist does not mean the application is fully secure or ASVS-compliant.

## A01 — Broken Access Control

Implemented controls:

- every tenant-owned request resolves an authenticated tenant principal server-side;
- tenant sessions persist the authoritative `organization_id`;
- a conflicting browser `X-Organization-Id` is rejected;
- tenant guards require `users.account_type = TENANT` and matching `users.organization_id`;
- CMS guards require `users.account_type = PLATFORM` with no tenant binding;
- role, membership status and resource scopes are resolved from PostgreSQL;
- every tenant controller is protected by a tenant feature entitlement where applicable;
- CMS cross-tenant actions require explicit platform permissions;
- the database enforces tenant user/membership binding.

Verification target: integration tests must include cross-tenant IDs, wrong account type, disabled feature and insufficient role/scope.

## A02 — Security Misconfiguration

Implemented controls:

- production requires explicit HTTPS `CORS_ORIGINS`;
- wildcard credentialed CORS is forbidden;
- production auth cookies must use the `__Host-` prefix;
- Secure/HttpOnly/session and CSRF cookie semantics are centralized;
- dev principal fallbacks are rejected in production;
- reverse-proxy trust is explicit and bounded;
- API/frontend responses carry anti-framing, no-sniff, referrer and permissions policies;
- HSTS is enabled in production;
- auth/CMS API responses are no-store;
- Express technology disclosure is disabled.

Residual work: deployment/CDN/WAF/TLS configuration must be reviewed separately from application code.

## A03 — Software Supply Chain Failures

Implemented controls:

- CI uses the committed pnpm lockfile with `--frozen-lockfile`;
- CI runs production dependency audit and blocks critical advisories;
- dependency versions are pinned/locked by pnpm.

Residual work:

- review high-severity advisories that are not critical;
- pin third-party CI actions to immutable commit SHAs where operationally practical;
- add SBOM/provenance signing before production release if Habi distribution requires it.

## A04 — Cryptographic Failures

Implemented controls:

- passwords use salted asynchronous scrypt;
- password compare uses timing-safe comparison;
- oversized password inputs are rejected before expensive verification;
- browser sessions use high-entropy opaque tokens;
- only SHA-256 session-token hashes are stored;
- CSRF tokens are hashed in session storage;
- auth abuse identifiers/IPs are HMAC-derived rather than stored raw;
- production requires a dedicated auth-security HMAC secret;
- Google ID token signatures are verified against Google's rotating JWKS.

Residual work: deployment secret storage, backup encryption and database transport encryption are infrastructure responsibilities and must be verified per environment.

## A05 — Injection

Implemented controls:

- PostgreSQL application queries use parameter binding for user/domain values;
- entitlement, role, status and other enumerated inputs are validated before persistence;
- CMS does not expose a generic SQL editor;
- public resource lookup never authorizes by raw ID alone.

Verification target: security review must reject string-built SQL containing request-controlled values and untrusted shell/process execution.

## A06 — Insecure Design

Implemented controls:

- tenant identity is single-tenant by design;
- CMS/platform identity is separated from tenant identity;
- feature quotas and entitlement overrides are domain data and enforced server-side;
- the last active tenant OWNER cannot be accidentally removed/demoted/suspended;
- self-service registration creates organization/OWNER/subscription atomically;
- Staff offline authorization is bounded to 24 hours after online verification;
- financial/webhook flows retain idempotency/audit requirements.

Residual work: threat-model new high-impact workflows before implementation, especially impersonation, bulk export and future payment automation.

## A07 — Authentication Failures

Implemented controls:

- generic password-login failure response;
- distributed auth rate limiting by normalized identifier and client IP;
- registration and Google authentication are separately rate-limited;
- password-change attempts are rate-limited;
- opaque server-side sessions support expiry/revocation/auth-version invalidation;
- password change invalidates previous sessions through `auth_version`;
- Google ID tokens validate signature, issuer, audience, authorized party for multi-audience tokens, expiry, verified email, stable subject and nonce;
- Google tenant auth cannot authenticate/link platform accounts;
- users can list active sessions, revoke an individual session or revoke all other sessions;
- Google provider identity is keyed by stable `sub`;
- password self-registration remains pending until a one-time email token is verified;
- verification tokens are stored only as SHA-256 hashes and create the tenant only after successful verification;
- forgot-password responses are generic to avoid account enumeration;
- password reset tokens are one-time, expire, and revoke every existing session by advancing `auth_version`;
- auth email delivery uses server-side Resend credentials and is hidden from production UI when not configured;
- enrolled accounts complete password/Google primary authentication with a short-lived one-time MFA challenge before a browser session is issued;
- TOTP secrets are encrypted with AES-256-GCM, recovery codes are stored only as hashes and are single-use;
- tenant and platform password login are separated by authoritative account type;
- active-session UX includes a bounded User-Agent-derived device label and supports revoking other sessions;
- the CMS Control Plane uses real PLATFORM browser sessions instead of a production dev-principal fallback;
- MFA enrollment policy is role-based and configurable through system settings;
- OWNER and PLATFORM_ADMIN are required to enroll by default before a new browser session is issued;
- mandatory enrollment uses a short-lived ENROLL challenge and never grants a temporary business session;
- Authenticator QR codes are rendered locally in the Habi frontend, so the TOTP provisioning secret is not sent to a third-party QR service;
- accounts whose role is still covered by MFA policy cannot disable MFA.

Residual work before public launch:

- decide whether additional roles should be added to the mandatory MFA policy;
- decide whether already-active pre-policy sessions should be force-revoked at rollout or allowed to age out;
- add WebAuthn/passkeys if phishing-resistant MFA is required;
- connect production authentication alerts to the chosen incident channel.

## A08 — Software or Data Integrity Failures

Implemented controls:

- pnpm lockfile is immutable in CI;
- webhook/provider events use verification/idempotency rules;
- CMS high-impact mutations require platform permission and audit reason;
- plan/entitlement changes preserve version/history semantics;
- Google identity accepts only cryptographically verified tokens.

Residual work: artifact signing/provenance and deployment promotion controls belong in CI/CD hardening.

## A09 — Security Logging and Alerting Failures

Implemented controls:

- dedicated `auth_security_events` storage;
- successful/failed password login, Google auth, registration, password changes and rate-limit blocks are recorded;
- identifiers and IPs are stored as HMAC-derived values instead of plaintext;
- CMS operators with audit permission can inspect the recent auth-security event stream;
- platform/tenant business audit trails remain separate from security telemetry.

Residual work: production alert routing/thresholds (SIEM, email, Slack, PagerDuty or equivalent) must be connected to meaningful blocked/failure spikes.

## A10 — Mishandling of Exceptional Conditions

Implemented controls:

- transaction helpers roll back on exceptions;
- worker internal API client distinguishes empty success bodies, invalid JSON and HTTP failures;
- auth failures do not return session cookies;
- Google nonce is cleared after use;
- production startup fails closed when critical security configuration is invalid;
- API request IDs support incident correlation;
- invalid tenant/platform state is rejected rather than silently falling back in production.

Verification target: error-path tests must cover partial failure, invalid external responses, duplicate/retry behavior and safe recovery.

## Release security gate

Before a production release:

1. run lint/typecheck/tests/build/migration smoke tests;
2. run dependency audit;
3. verify production security config boots successfully;
4. verify all tenant features return 403 when disabled;
5. test tenant A cannot read/write tenant B resources;
6. test CMS permission boundaries;
7. test password/Google auth rate limits and nonce replay rejection;
8. test session revocation and Staff offline-lease expiry;
9. inspect security/audit events for secret/token leakage;
10. perform an ASVS-based review or penetration test for public launch.
