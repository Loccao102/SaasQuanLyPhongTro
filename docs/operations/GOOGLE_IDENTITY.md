# Google Identity / OIDC Setup

Habi uses Google Identity Services for authentication only. The browser receives a signed Google ID token, the API verifies it, then Habi creates its own opaque database-backed session.

Habi does **not** store Google access tokens or refresh tokens for sign-in.

## 1. Create the Google client

In Google Cloud Console:

1. configure the OAuth consent/branding screen;
2. create an OAuth 2.0 Client ID of type **Web application**;
3. add every browser origin that renders the Google button under **Authorized JavaScript origins**.

Local baseline:

```text
http://localhost:3000
http://localhost:3001
```

Production example:

```text
https://app.example.com
https://staff.example.com
```

The current popup/callback integration does not use a Google redirect URI for the Habi login callback.

## 2. Configure Habi

API environment:

```env
GOOGLE_CLIENT_ID=<web-client-id>.apps.googleusercontent.com
```

The browser obtains this public client ID through `GET /api/auth/config`.

CMS system settings:

- `google_auth_enabled = true`;
- `registration_enabled = true` when self-service Google registration is allowed.

Also configure explicit browser origins:

```env
CORS_ORIGINS=https://app.example.com,https://staff.example.com,https://cms.example.com,https://invoice.example.com
```

## 3. Security flow

```text
Browser
  -> POST /api/auth/google/challenge
  <- random nonce + host-bound HttpOnly nonce cookie

Browser
  -> Google Identity Services
     client_id + nonce
  <- signed ID token

Browser
  -> POST /api/auth/google
     credential + LOGIN/REGISTER

API
  -> verify Google JWKS signature
  -> verify iss
  -> verify aud == GOOGLE_CLIENT_ID
  -> verify exp / iat
  -> verify email_verified
  -> verify stable sub
  -> verify nonce against browser challenge
  -> enforce tenant/platform identity boundary
  -> issue Habi opaque session + CSRF cookie
```

The Google nonce cookie is cleared after the authentication attempt.

## 4. Account linking rules

- Existing Google `sub` -> use the linked Habi tenant account.
- Existing Habi tenant email without a Google identity -> automatic linking is allowed only when Google is authoritative for that email.
- A third-party-domain email that Google cannot authoritatively vouch for must authenticate with its existing Habi method before a future explicit linking flow.
- Public Google tenant auth never links or authenticates `PLATFORM` CMS accounts.
- Provider identity uniqueness is based on Google `sub`, not email.

## 5. Production auth secrets

Production startup requires:

```env
AUTH_SECURITY_HMAC_KEY=<32+ random characters>
INTERNAL_WORKER_TOKEN=<32+ random characters>
OBSERVABILITY_METRICS_TOKEN=<32+ random characters>
```

Leave auth cookie-name variables empty unless there is a specific reason to override them. Production defaults use the `__Host-` prefix.

When the API is behind a trusted reverse proxy, set the exact hop count:

```env
TRUST_PROXY_HOPS=1
```

Do not set a larger value than the actual trusted proxy chain; client IP is used for authentication abuse controls.

## 6. Verification checklist

- password login works;
- Google LOGIN works for a linked/existing tenant account;
- Google REGISTER creates a new tenant OWNER and trial;
- replaying the same Google ID token after the nonce is consumed fails;
- wrong Google audience fails;
- tenant Google auth cannot sign in a PLATFORM account;
- excessive password/Google/register attempts return HTTP 429;
- CMS Audit shows authentication security events;
- production cookies are Secure and `__Host-`;
- requests from non-allowlisted origins are rejected;
- Staff offline auth expires 24 hours after the last online verification.

If Habi later needs Drive/Gmail/Calendar APIs, implement a separate OAuth authorization-code integration with explicit scopes, consent, encrypted token storage and revocation. Do not reuse the sign-in ID token as a Google API access token.
