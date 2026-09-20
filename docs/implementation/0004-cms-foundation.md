# Implementation Slice 0004 — CMS Foundation

Status: interactive frontend prototype with mock data. No real CMS authorization or persistence is claimed.

## Architecture preflight

Owning concerns: CMS product surface, platform operator authorization boundary, settings/plan contracts, job operations, observability/audit read surfaces.

Tenant boundary: CMS is cross-organization only for explicit platform principals; tenant roles do not imply CMS access.

Idempotency: future settings/plan/retry commands include Idempotency-Key; local mock actions do not claim durable idempotency.

Audit: settings/plan/retry changes require reason and durable audit in production.

Failure: provider/job errors remain explicit; UNKNOWN is never success; real loading/error/permission/conflict states arrive with API integration.

## Product design preflight

Surface: CMS. Persona: PLATFORM_ADMIN for this slice.

Primary job: configure SaaS safely, inspect customer/system health, recover operational failures with auditability.

Main flow: sidebar -> target area -> inspect -> explicit action -> impact/reason modal -> mock success/audit.

Risks: plan/settings can affect commercial/availability behavior; retries can duplicate effects unless idempotent. Confirmation + reason is baseline.

Responsive: desktop/tablet first; narrow screens use horizontal nav/contained tables.

Reuse: MetricCard, ProgressBar, SectionHeader, StatusBadge.

## Verification target

CI: lint, CMS typecheck, CMS production build, existing apps/API build.
