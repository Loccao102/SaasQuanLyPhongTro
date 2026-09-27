# ADR-0017: Tenant-scoped Accounts, Self-service Onboarding and Feature Entitlements

- Status: Accepted
- Date: 2026-09-27

## Context

Habi originally modeled a user as a global identity that could hold memberships in multiple organizations, with the browser selecting the active organization using `X-Organization-Id`.

The product direction is now different:

- one tenant account belongs to exactly one customer organization;
- a new customer must be able to register and start a trial without a platform operator manually provisioning the tenant;
- OWNER can create additional accounts only inside that tenant and only within the account quota;
- CMS/platform operators are a separate control-plane identity class;
- CMS must be able to control both plan-level and tenant-specific feature availability;
- disabling a tenant feature must be enforced by the backend, not only hidden in the UI.

## Decision

### Identity classes

`users` carries:

- `account_type = TENANT | PLATFORM`;
- `organization_id` for tenant accounts;
- platform accounts have no tenant organization.

A tenant user may have membership only in the same organization as `users.organization_id`. A database trigger binds legacy/fixture tenant users that are created before their membership and rejects cross-tenant membership.

Email remains globally unique. A tenant account therefore cannot be reused by another tenant.

### Browser session tenant binding

`auth_sessions` stores `organization_id`.

For an authenticated tenant session, the organization in the session is authoritative. If a browser sends a different `X-Organization-Id`, the request is rejected. The header remains temporarily accepted as a development/backward-compatible selector only when the authenticated session does not already carry a tenant.

### Self-service registration

`POST /api/auth/register` creates, in one transaction:

1. organization;
2. TENANT user;
3. password credential;
4. ACTIVE OWNER membership;
5. ORGANIZATION scope;
6. STARTER subscription in TRIALING state;
7. audit event.

Registration is controlled by the CMS `registration_enabled` system setting.

### Google authentication

Google Identity Services is an additional credential source.

The browser submits the Google ID token to `POST /api/auth/google`. The API verifies:

- RS256 signature from Google's published JWKS;
- issuer;
- audience against `GOOGLE_CLIENT_ID`;
- expiry;
- subject;
- verified email.

The stable Google `sub` is stored in `user_auth_identities`. The Habi opaque database session remains the application session after Google authentication.

Google auth can be disabled through the CMS `google_auth_enabled` setting.

### Tenant account quota

The existing commercial `staff_limit` is treated as the current account-seat limit for backward-compatible storage. All tenant memberships, including reserved/inactive states, consume a seat unless explicitly removed by a future archival flow.

OWNER/Admin account creation and CMS account creation both enforce this limit server-side.

### Feature entitlements

Plan versions store feature booleans in `saas_plan_versions.features`.

Baseline tenant feature keys:

- properties;
- leases;
- metering;
- billing;
- payments;
- maintenance;
- notifications;
- reports;
- team_management;
- advanced_reports;
- audit_log.

CMS can configure feature availability in a new plan version or apply an organization-specific entitlement override with optional expiry.

Tenant controllers declare the feature they require. `TenantPrincipalGuard` resolves the effective commercial policy and returns 403 when the feature is disabled.

Admin receives effective feature state in the authenticated session so disabled features can also be hidden from navigation. Frontend visibility remains UX only; backend enforcement is authoritative.

### Platform account management

CMS platform operators can inspect and manage tenant accounts through explicit `/api/cms/organizations/:organizationId/accounts/*` endpoints.

Sensitive actions include audit records:

- account creation;
- suspension/reactivation;
- password reset;
- session revocation.

CMS account creation is also subject to tenant account quota.

## Consequences

Positive:

- tenant isolation is simpler and server-authoritative;
- a stolen/modified organization header cannot switch an authenticated tenant session;
- new customers can try Habi without platform operator intervention;
- Google sign-in does not replace or weaken Habi session/CSRF controls;
- plan and tenant feature control use one commercial entitlement mechanism;
- CMS has an explicit, auditable tenant-account control surface.

Trade-offs:

- an email cannot participate in multiple tenants;
- customers that truly need cross-tenant identities would require a future explicit platform/account-linking model;
- `staff_limit` remains the legacy storage name for account-seat quota until a dedicated schema rename is justified;
- email verification, password recovery, invite-email delivery and MFA remain separate hardening slices.
