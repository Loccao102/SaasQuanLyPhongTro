---
name: propops-notification-automation
description: Use when implementing notification queues, Zalo/Playwright automation, provider adapters, retries, delivery tracking, or manual review workflows.
---

1. Model notifications as durable jobs; never send 200 messages inside one HTTP request.
2. Use NotificationProvider contracts so business code does not depend on Playwright or any provider.
3. Playwright must run in a separate worker/process.
4. Each job needs status, attempt_count, timestamps, idempotency_key, and last error.
5. Verify recipient and post-send evidence before marking SENT when the provider allows it.
6. Retry transient failures with bounded backoff.
7. Stop and escalate on logout, captcha, ambiguous recipient, provider UI breakage, or repeated failure.
8. Never report UNKNOWN as success.
9. Preserve diagnostic evidence without storing unnecessary secrets/session data.
10. Design migration so a future official API provider can replace Playwright without changing Billing.
