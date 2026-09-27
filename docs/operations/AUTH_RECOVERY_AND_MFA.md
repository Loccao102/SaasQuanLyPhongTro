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

## Passkeys / WebAuthn

Habi supports passkeys as a phishing-resistant second factor after primary
password or Google authentication. TOTP and single-use recovery codes remain
available as fallback methods.

This release deliberately does not enable passwordless login. A passkey
authentication ceremony is only created after a valid primary-login MFA
challenge exists, so possession of a passkey does not bypass the existing
account-discovery and primary-authentication controls.

Passkey registration requires an authenticated browser session, a valid CSRF
token and WebAuthn user verification. Registration challenges are short-lived
and one-time. Authentication challenges are linked to the exact parent MFA
challenge; consuming the WebAuthn assertion, consuming the MFA challenge and
updating the authenticator counter happen in one database transaction.

Configure production relying-party values:

```env
AUTH_WEBAUTHN_RP_NAME=Habi
AUTH_WEBAUTHN_RP_ID=example.com
AUTH_WEBAUTHN_ORIGINS=https://app.example.com,https://cms.example.com
AUTH_WEBAUTHN_CHALLENGE_TTL_MINUTES=5
```

`AUTH_WEBAUTHN_RP_ID` must be the relying-party domain that legitimately
covers the frontend hosts where the passkey is used. `AUTH_WEBAUTHN_ORIGINS`
must contain the exact HTTPS origins accepted by the server. Production fails
closed when no WebAuthn origin is configured.

Stored passkey material contains the credential ID, public key, signature
counter, transports, device/back-up metadata and a user-controlled display
name. Habi never stores a passkey private key; that remains with the
authenticator/platform.

Users can add and revoke passkeys from the tenant Security modal or the
Control Plane Security screen. Login shows the passkey option only when the
browser supports WebAuthn; otherwise TOTP/recovery-code login continues to
work.

## Passkey-first / passwordless login

Habi supports discoverable passkeys as an optional primary login method.
Password and Google login remain available and are not removed by enabling this
feature.

Production rollout is explicit:

```env
AUTH_PASSKEY_PASSWORDLESS_ENABLED=true
AUTH_PASSKEY_LOGIN_RATE_WINDOW_SECONDS=900
AUTH_PASSKEY_LOGIN_RATE_MAX_PER_IP=120
```

The production Compose default keeps `AUTH_PASSKEY_PASSWORDLESS_ENABLED=false`.
Admin and CMS read the server auth config, so the passkey-first button is hidden
until rollout is enabled.

The login options endpoint does not accept an email or account identifier. It
creates a short-lived anonymous WebAuthn challenge. The browser/authenticator
selects a discoverable credential, then the verified credential ID resolves the
account server-side. Tenant and PLATFORM use separate challenge purposes and
verification routes; a tenant passkey cannot be used to enter the Control Plane.

Newly registered passkeys request `residentKey = required` and
`userVerification = required`. Passkeys created before this rollout remain
valid for MFA/step-up. If an older authenticator did not create a discoverable
credential, the user may need to register a new passkey before passkey-first
appears for that authenticator.

Anonymous passwordless challenges are:

- random and short-lived;
- identified by a random request UUID returned with the WebAuthn options;
- one-time and atomically consumed with the passkey counter update;
- rate-limited by source IP;
- cleaned after expiry.

Mandatory privileged-role policy is not bypassed. If a role currently requires
MFA enrollment and the account has not completed the required TOTP enrollment,
passkey-first refuses to create a session and the user must complete the normal
primary-login enrollment flow first. Once policy enrollment exists, a verified
passkey with user verification can create the browser session directly.

Successful passkey-first logins emit `PASSKEY_LOGIN` or
`PLATFORM_PASSKEY_LOGIN` security events and participate in the same
new-network alert rule as password, Google and MFA-completed logins.

## Recent authentication / step-up

Long-lived browser sessions are not treated as indefinitely strong proof for
sensitive writes. Each session stores `reauthenticated_at`. New sessions start
fresh; after the configured window expires, protected mutations return HTTP
`428` with `code=STEP_UP_REQUIRED`.

Configure the window with:

```env
AUTH_STEP_UP_TTL_MINUTES=10
```

Accepted step-up methods are:

- current password, when the account has a password credential;
- TOTP or a single-use recovery code;
- a registered WebAuthn/passkey with user verification.

Passkey step-up challenges are bound to the current session. Consuming the
WebAuthn challenge, updating the authenticator counter and refreshing the
session's `reauthenticated_at` happen in one transaction, so an assertion
cannot be replayed to elevate the session twice.

The Control Plane requires recent authentication for every unsafe HTTP method.
The CMS request layer keeps the original mutation pending, opens the global
recent-auth modal, and retries the original request after successful step-up.
The same `Idempotency-Key` header is reused on retry.

Tenant Admin currently applies step-up to security mutations such as MFA setup,
passkey registration/revocation and revoking other sessions. Password change
and MFA disable already prove a credential as part of the operation and refresh
the session's recent-auth timestamp when they succeed.

Existing sessions receive a migration-time `reauthenticated_at` value, giving
them one normal step-up window after rollout rather than forcing an immediate
mass interruption.

## Security alerts

Authentication events remain the raw audit source. Habi derives a separate
persistent alert stream for signals that should be easier for users and
operators to notice.

Current alert rules include:

- MFA disabled — HIGH;
- passkey registered or revoked — MEDIUM;
- password changed — MEDIUM;
- successful login from a network hash not previously seen for an account
  that already has login history — MEDIUM;
- three or more failed STEP_UP attempts within 15 minutes — HIGH, deduplicated
  for 60 minutes.

Network detection uses the existing HMAC-protected IP hash. Raw IP addresses
are not stored in the alert record and no location is inferred from them.

Alerts are written to PostgreSQL before any notification attempt. When Resend
and `AUTH_EMAIL_FROM` are configured, MEDIUM/HIGH alerts with a known account
email are delivered asynchronously. Authentication never waits for or fails
because of alert email delivery. Delivery status is recorded as
`SENT`, `FAILED` or `SKIPPED`.

Tenant users can see their own recent alerts in the Admin security modal.
PLATFORM users can see their own alerts on the Control Plane security screen,
while operators with `platform.audit.read` can see the platform-wide alert
feed alongside the raw auth event feed.

Alert retention is bounded independently from raw event retention:

```env
AUTH_SECURITY_ALERT_RETENTION_DAYS=180
```

The existing hourly opportunistic security-data cleanup removes alerts older
than this window.

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
