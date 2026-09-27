# Account verification, recovery and MFA

Habi browser authentication now has three layers:

1. password registrations remain pending until email verification;
2. forgot/reset password uses one-time hashed reset tokens;
3. enrolled accounts complete a TOTP/recovery-code challenge before a browser session is issued.

## Production email delivery

Configure the API with:

```env
AUTH_PUBLIC_APP_URL=https://app.example.com
AUTH_EMAIL_FROM=Habi <no-reply@example.com>
RESEND_API_KEY=...
AUTH_EMAIL_VERIFICATION_TTL_HOURS=24
AUTH_PASSWORD_RESET_TTL_MINUTES=30
```

`AUTH_PUBLIC_APP_URL` is the tenant Admin origin used in verification and
password-reset links. It must be HTTPS in production.

Password registration is not exposed by `GET /api/auth/config` in production
unless the email delivery settings above are available.

Development without Resend logs the verification/reset URL to the API console.
Never use that fallback in production.

## TOTP MFA

Generate a stable random 32-byte encryption key and encode it as base64:

```bash
openssl rand -base64 32
```

Configure:

```env
AUTH_TOTP_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
AUTH_MFA_CHALLENGE_TTL_MINUTES=5
AUTH_MFA_VERIFY_WINDOW_SECONDS=900
AUTH_MFA_VERIFY_MAX_PER_IP=60
AUTH_MFA_SETUP_WINDOW_SECONDS=3600
AUTH_MFA_SETUP_MAX_PER_USER=10
```

The encryption key protects TOTP secrets at rest with AES-256-GCM. Keep the key
in the deployment secret store and back it up. Replacing or losing it makes
existing TOTP enrollments unreadable.

The database stores recovery codes only as SHA-256 hashes. Recovery codes are
shown once after enrollment and each code is single-use.

A confirmed MFA secret cannot be replaced through the setup endpoint. The user
must prove possession of the existing TOTP/recovery code and disable MFA before
starting a new enrollment.

## Mandatory MFA role policy

The database seeds two editable system settings:

```json
mfa_required_tenant_roles   = ["OWNER"]
mfa_required_platform_roles = ["PLATFORM_ADMIN"]
```

They are ordinary CMS system settings and can be edited without a code deploy.
An empty array disables mandatory enrollment for that account class. Invalid
non-array values fail back to the secure defaults above.

When a matching role passes primary authentication without an enrolled TOTP
credential, Habi creates a short-lived `ENROLL` challenge. No browser session,
CSRF cookie, tenant features or Control Plane principal is issued yet. The
enrollment endpoints accept only that challenge, create the TOTP secret, verify
the first TOTP code, generate recovery codes, consume the challenge and then
issue the normal session.

A user whose current role remains in the mandatory policy cannot disable MFA.
Change the policy/role first if MFA must be removed as part of an audited
account-recovery process.

Existing sessions created before policy rollout are not force-revoked by the
migration. They age out or can be revoked from the session screen. This avoids
an unplanned mass logout during deployment.

## Local QR enrollment

Admin and CMS render the `otpauth://` provisioning URI into an SVG QR code
locally in the browser. No Google Chart, QRServer or other third-party QR
endpoint receives the TOTP secret. The manual Base32 secret remains available
behind a fallback disclosure for authenticator apps that cannot scan the QR.

## Login behavior

Tenant browser login:

```text
POST /api/auth/login
  -> primary credentials valid
  -> role not covered by policy and no MFA: session + CSRF cookies
  -> MFA enrolled: short-lived VERIFY challenge, no session
  -> MFA required by role but not enrolled: short-lived ENROLL challenge, no session

POST /api/auth/mfa/verify
  -> TOTP or one recovery code
  -> consumes challenge
  -> session + CSRF cookies
```

Platform/CMS login uses `POST /api/auth/platform/login`. The server enforces
`account_type = PLATFORM`; normal `/auth/login` enforces
`account_type = TENANT`.

## Session security

New sessions store a bounded User-Agent and a derived display label such as
`Chrome · Windows` or `Safari · iPhone`. The label is informational only and
is never an authentication factor.

Password reset increments `auth_version` and revokes all existing sessions.
Disabling MFA preserves the current authenticated session and revokes other
sessions.

## Control Plane deployment

The production image has a dedicated `cms` target on port 3003. The supplied
nginx configuration routes hosts beginning with `cms.` or `control.` to the
CMS frontend. Add the final CMS HTTPS origin to `CORS_ORIGINS` and configure
DNS/TLS for that hostname.

The CMS frontend has a global platform-session gate, a dedicated platform login
screen, MFA challenge handling, a security/session screen and logout control.

## Release verification

Before enabling public password registration or privileged MFA:

- verify a new password registration creates no tenant before email verification;
- verify the email token is one-time and expires;
- verify forgot-password gives the same outward response for existing and missing accounts;
- verify resetting a password invalidates prior sessions and reset tokens;
- verify tenant credentials fail at `/auth/platform/login`;
- verify platform credentials fail at tenant `/auth/login`;
- enable MFA, log out, and verify a session is not issued before second factor;
- verify a recovery code works once and fails on replay;
- verify a second MFA setup cannot overwrite a confirmed secret;
- verify session device labels and revoke-other-sessions behavior;
- keep at least one tested recovery path before enforcing mandatory MFA policy.
