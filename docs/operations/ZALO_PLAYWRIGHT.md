# Zalo Playwright Notification Adapter

Status: transitional edge adapter. Zalo/Playwright stays outside Core billing, leasing and notification lifecycle logic.

## Runtime boundary

```text
NotificationJob (PostgreSQL)
  -> internal worker claim API
  -> notification worker
  -> ZALO_PLAYWRIGHT provider
  -> Zalo Web
  -> verified provider result
  -> internal worker completion API
  -> PostgreSQL
```

The worker never writes PostgreSQL directly. The API remains authoritative for quota consumption, job state, retries and final delivery state.

## Provider selection

Set:

```bash
WORKER_ROLE=NOTIFICATION
WORKER_PROVIDER=ZALO_PLAYWRIGHT
```

The worker package pins Playwright to `1.63.0`. The dedicated Dockerfile uses the matching Microsoft Playwright `v1.63.0-noble` image. Keep these versions aligned.

`WORKER_PROVIDER=ZALO_PLAYWRIGHT` is the adapter selector. The durable provider identity stored on notification jobs and heartbeats is `PLAYWRIGHT_ZALO`. The worker also drains the legacy `ZALO_PLAYWRIGHT` job alias so an older queued job is not stranded.

## Session encryption

Browser storage state is encrypted with AES-256-GCM before being written to disk.

Generate a key outside the repository:

```bash
openssl rand -base64 32
```

Provide it as:

```bash
ZALO_SESSION_KEY_BASE64=<secret>
```

The decoded key must be exactly 32 bytes.

Default local encrypted session path:

```text
.runtime-secrets/zalo/session.enc
```

This directory is gitignored.

Docker uses:

```text
/home/pwuser/.habi/zalo/session.enc
```

backed by the `habi_zalo_session` named volume.

Never commit:
- the encryption key;
- decrypted Playwright storage state;
- cookies;
- access/session tokens.

## Bootstrap / rotate the Zalo session

The bootstrap command requires a headed browser on the operator machine.

Install dependencies/browser if needed, configure `ZALO_SESSION_KEY_BASE64`, then run:

```bash
pnpm --filter @propops/worker exec playwright install chromium
pnpm --filter @propops/worker zalo:bootstrap-session
```

A browser opens. Log into the intended Zalo account manually, resolve any security prompt/CAPTCHA, verify the chat UI is usable, then return to the terminal and press Enter.

The command saves only encrypted storage state.

For rotation, run the same bootstrap command with the same target session path. Replace/rotate the encryption key only with an operational plan for re-encrypting or regenerating the session.

## Safe-send rules

The provider is deliberately conservative.

Before send it requires:
1. Zalo session is authenticated;
2. no CAPTCHA/security blocker is detected;
3. a valid Vietnamese mobile number is provided (a display name is optional);
4. a single matching search result can be verified through the searched phone or a unique contact result;
5. a conversation opens with a detectable message editor;
6. when the search result exposes a name, the conversation is checked against that name.

If Zalo does not provide enough information to verify a phone-only recipient, the job stays in `MANUAL_REVIEW` rather than choosing an arbitrary conversation.

After send it requires:
1. the editor no longer contains the unsent message;
2. an exact visible message bubble matching the body is observed.

Only then does it return `SENT_CONFIRMED`.

Ambiguous post-send state returns `UNKNOWN`. It must never be blindly retried as if no send occurred.

### Crash/retry recovery

The API treats a `RUNNING` notification attempt as stale after
`NOTIFICATION_RUNNING_TIMEOUT_SECONDS` (default 600 seconds).

When a stale attempt is recovered:

1. the abandoned attempt is closed as `UNKNOWN` with
   `STALE_ATTEMPT_RECLAIMED`;
2. quota consumption remains idempotent for the notification job;
3. a replacement attempt is created only when automatic attempts remain;
4. the replacement claim carries `deliveryReplayCheckRequired=true`;
5. Zalo opens and verifies the intended conversation, then checks for an exact
   visible copy of the message before typing or clicking Send;
6. if that exact message already exists, the job is confirmed `SENT` without
   sending another copy;
7. if the stale attempt already consumed the retry limit, the job moves to
   `MANUAL_REVIEW` instead of silently exceeding the configured limit.

The replay requirement is derived from durable `UNKNOWN` attempt history, so
it survives additional safe transient failures such as session-lock
contention.

A Playwright timeout after a send action has been attempted is classified as
`UNKNOWN / POST_SEND_TIMEOUT`, not a transient auto-retry.

## Provider pause behavior

The shared provider pauses on `PROVIDER_UI_BROKEN`. Account-specific login, expired
session and CAPTCHA errors should affect only the account that experienced them.

Recipient-specific ambiguity does not pause every Zalo job; it goes to manual review instead.

## Selector configuration

Zalo Web can change. Default selectors are only a safe baseline.

Override selector lists with environment variables; separate fallbacks with `||`:

```text
ZALO_LOGIN_INDICATORS
ZALO_CAPTCHA_INDICATORS
ZALO_SEARCH_INPUT_SELECTORS
ZALO_MESSAGE_EDITOR_SELECTORS
ZALO_SEND_BUTTON_SELECTORS
```

If a required control cannot be found, the adapter returns `PROVIDER_UI_BROKEN` instead of guessing.

Before production rollout, validate selectors against the exact Zalo account/UI used by the operation team.

## Concurrency

One encrypted Zalo account/session must have only one active browser sender at a time.

The adapter uses an exclusive session lock file to protect against accidental local/process concurrency. Deployment orchestration must additionally enforce one notification worker replica per Zalo session/account.

Do not horizontally scale one session by sharing the same cookie file across many workers.

## Evidence and privacy

The adapter sends only minimal operational evidence back to the API:
- job ID;
- attempt number;
- stage;
- message length;
- verification method/count where useful.

It does not return:
- cookie values;
- tokens;
- message body;
- recipient phone/name.

### Opt-in live browser monitor (staging)

From Admin → Thông báo, select a campaign and choose **Xem thao tác** on one job.
Click **Bật xem màn hình** before running the job. The provider captures
low-quality JPEG previews roughly every 2.5 seconds and the admin displays
the current Playwright stage and any error code. The API also shows the
provider's global PAUSED reason (for example `PROVIDER_UI_BROKEN`).

Privacy and operational boundaries:
- Only an authenticated OWNER/ADMIN of the job's organization can enable/read frames.
- The monitor is **read-only**; it cannot click Zalo or retry a notification.
- Frames remain in API process memory only, and are never written to Neon,
  application logs, worker evidence, cloud storage or the file system.
- The viewing lease expires after 15 seconds unless the browser refreshes it;
  the last frame expires within 180 seconds and is cleared on Stop.
- Only one API replica is supported by this in-memory staging implementation.
  A scaled deployment needs a shared expiring, tenant-scoped frame store.
- Screenshots may contain phone numbers and private conversation content.
  Enable only when necessary for diagnostics, disable afterward, and do not
  share captured images. Only operational stage labels and bounded input-field
  metadata are used in durable failure evidence.
- If the worker is already finished, enabling the viewer does not rerun it;
  historical job error codes remain visible without a screenshot.
- The provider must be deliberately re-enabled after a global UI failure;
  enabling the viewer never resumes a paused queue.

Before enabling monitoring in production, perform a privacy review and
consider masking unrelated chats in the captured viewport.

## Failure drills before production

Validate with a non-production/test account:

1. valid recipient + verified send;
2. recipient not found;
3. ambiguous same-name recipient;
4. expired/logged-out session;
5. CAPTCHA/security challenge;
6. Zalo DOM/selector change;
7. network timeout before send;
8. ambiguous state after clicking send;
9. worker crash and restart;
10. two worker processes contending for the same session lock.

The provider should prefer MANUAL_REVIEW/UNKNOWN over a false positive SENT state.
