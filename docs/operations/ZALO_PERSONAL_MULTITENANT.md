# Zalo Personal multi-tenant connection (experimental)

Each Habi organization connects its own **personal** Zalo Web session from
**Admin → Zalo 1 Chạm** (`/zalo-personal`). This is unofficial browser
automation, NOT an official Zalo OA/ZBS API. Zalo may require additional
confirmation or change its UI at any time. Never promise uninterrupted
delivery, and do not bypass CAPTCHA or provider security checks.

## Design

- `zalo_personal_accounts.organization_id` is the primary key.
- The browser worker AES-256-GCM encrypts Playwright `storageState` before
  sending it to the API. Only ciphertext is kept in PostgreSQL.
- A different derived encryption key and authenticated associated data (AAD)
  are used for each organization. A session from organization A cannot be
  decrypted as organization B.
- The master encryption key is provided to **worker processes only**,
  never to the Admin UI/API or their request responses.
- The notification worker obtains the encrypted session by the *claimed
  notification job ID*, not by a client-supplied organization ID, and verifies
  the returned organization against the claimed job.
- The database notification claim is limited to organizations with an active
  session, serializing Zalo sends per organization. No shared/global browser
  login is used.
- OWNER or ADMIN may link/relink/disconnect. The role must also have the
  `notification.send` permission for the organization scope.
- A separate headless `ZALO_LOGIN` worker captures the Zalo Web login screen
  every ~5 seconds and the authenticated tenant UI polls the QR/screenshot.
  Requests expire in three minutes. Only up to three requests per 15 minutes
  can be created for an organization.

## Configuration

Generate a random key **once** and keep it unchanged across restarts:

```bash
openssl rand -base64 32
```

Set these in the root `.env` / secret manager:

```dotenv
# Same stable secret on both Zalo workers. NEVER expose as NEXT_PUBLIC_*.
ZALO_SESSION_MASTER_KEY_BASE64=GENERATED_BASE64_VALUE
WORKER_PROVIDER=PLAYWRIGHT_ZALO
```

For Docker Compose (API/database/notifications and the opt-in QR worker):

```bash
docker compose -f infra/docker-compose.yml --profile zalo-personal up -d --build
```

Migration `9999_zalo_personal_multi_tenant.sql` is applied by the project's
existing `pnpm db:setup` command. The encrypted session is in PostgreSQL,
so no shared browser profile volume is required for persistence. The
notification container retains a per-org local lock as defense in depth.

**Deployment requirement:** Run these workers on an always-running container
host/VPS capable of launching Chromium. A serverless frontend alone cannot
host the interactive QR/login worker reliably. Configure protected
`INTERNAL_WORKER_TOKEN` and private API-to-worker transport as normal.

## How to use

1. Log in to the Habi Admin portal as OWNER/ADMIN, open **Zalo 1 Chạm**.
2. Click **Kết nối Zalo**. The dedicated login worker opens Zalo Web on
   the server; its QR login screen appears in the Admin page.
3. Scan the QR using your Zalo phone app and confirm login if prompted.
4. After chat UI is detected, Habi encrypts and saves this organization's
   browser session. The page shows **Đã kết nối**.
5. Go to **Thông báo** and send a test message to a consenting recipient.
6. Use **Ngắt kết nối** to immediately remove the session ciphertext
   from Habi. This blocks subsequent job claims for that organization.
   A message *already being sent* cannot be recalled.
7. Disconnecting from Habi does not necessarily revoke an existing Zalo Web
   authorization on Zalo's own servers. Use Zalo's device/session controls
   if you must revoke those sessions there too.

## Verification checklist

- `pnpm --filter @propops/worker test` (includes AES-GCM tenant isolation)
- `pnpm --filter @propops/worker typecheck`
- `pnpm --filter @propops/api typecheck`
- `pnpm --filter @propops/admin typecheck`
- `pnpm build`
- Sign in as organization A and B; use **different** Zalo accounts, verify
  messages are sent from the intended account on both.
- Disconnect A, verify A jobs do not get claimed, B messages still work.
- Reconnect A, reload and restart containers, verify session persists.
- Expire a QR request; verify old QR is no longer exposed.
- Verify MANAGER cannot link or disconnect the account; an authorized
  MANAGER can send using an existing tenant connection.
- Verify incorrect/expired sessions and CAPTCHA go to manual review without
  accidentally retrying uncertain deliveries.

## Limitations

- The initial QR implementation uses a compact JPEG screenshot of Zalo Web
  instead of provider QR HTML extraction. Login detection relies on UI
  selectors and needs live testing against current Zalo Web.
- A pending campaign remains queued if its organization has no connected
  account; it is **never** routed to a global fallback account.
- Key rotation needs an explicit re-encryption migration. Replacing the
  master key without migrating stored ciphertext invalidates old sessions.
- Use only for legitimate transactional messages to intended/consenting
  recipients, obey Zalo's terms and platform message limits. Prefer an
  official OA/ZBS adapter for scalable production messaging.
