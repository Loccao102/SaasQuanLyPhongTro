# Implementation Slice 0021 — Personalized Renter Invoice Notifications

## Goal

Let an Admin send a finalized renter billing cycle without manually copying one public invoice URL per room.

## Architecture preflight

Owning modules:
- Renter Billing owns invoice eligibility and public-link issuance.
- Notifications owns campaign/job durability, quota, worker delivery and provider abstraction.

Module boundary:
- Renter Billing calls the transactional `NotificationCampaignService` contract.
- Renter Billing does not write notification tables directly.
- Notification worker still knows nothing about invoice/payment business rules.

## Durable personalization

Migration 0018 adds:
- `notification_jobs.message_body_override`;
- `notification_campaigns.source_type/source_id`.

Worker claim resolves:

```text
job.message_body_override ?? campaign.message_body
```

This lets one campaign contain a distinct durable invoice message per recipient while keeping retry behavior deterministic.

## Public link security

The invoice public-link source table continues storing only SHA-256 token hashes.

A fresh plaintext bearer token is necessarily present inside the durable outbound notification message so the isolated worker can retry the exact same message. This is intentional delivery data, not authentication/session credential storage.

Operational follow-up should define retention for sent notification message payloads together with notification evidence/PII retention policy.

The server constructs public URLs from `PUBLIC_INVOICE_BASE_URL`; clients cannot choose the link host. Production requires HTTPS.

## Transaction flow

For a fresh finalized-cycle command:

1. lock and authorize the tenant billing cycle;
2. enforce commercial write policy;
3. select only `ISSUED` invoices with `remaining_vnd > 0`;
4. resolve the primary-tenant phone;
5. skip invoices with no usable phone and count them explicitly;
6. rotate each eligible invoice public token;
7. group invoices by recipient phone;
8. render personalized message overrides;
9. reserve notification automation quota;
10. create campaign + jobs;
11. append billing-notification audit;
12. commit.

Any failure rolls back public-link rotation and notification creation together.

## Idempotency

Campaigns record:
- `source_type = RENTER_BILLING_CYCLE`;
- `source_id = <cycle uuid>`;
- organization-scoped idempotency key.

A retry with the same key and source replays the existing campaign without rotating tokens again.

Reusing the key for another source is rejected.

## Product design preflight

Surface:
- Admin Web / Billing cycle detail.

Persona:
- OWNER / ADMIN / MANAGER with both `billing.manage` and `notification.send` in the property resource scope.

Job-to-be-done:
- send all currently outstanding finalized invoices with the correct fresh invoice links in one bulk operation.

Confirmation explicitly states:
- current public links for eligible outstanding invoices are replaced;
- paid invoices are not sent;
- invoices without a primary-tenant phone are skipped and reported.

Success feedback reports:
- invoice count;
- recipient count;
- skipped invoice count;
- link to notification operations center.

## Integration coverage

The PostgreSQL integration test verifies:
- two outstanding invoices tied to the same phone become one job;
- each invoice receives a distinct opaque link;
- personalized job message contains both links;
- replay of the same command preserves the active token hashes;
- worker claim receives the personalized message rather than campaign fallback;
- specialized campaign audit is written once.
