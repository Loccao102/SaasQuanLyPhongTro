# ADR-0006: CMS is an Internal Control Surface

- Status: Accepted
- Date: 2026-09-21

## Context

Prop-Ops needs an internal interface for system settings, plan configuration, organization inspection, job operations, technical logs and audit.

Treating CMS as a separate business system/database would duplicate ownership and create synchronization problems even though its scope is operational control of the existing SaaS.

## Decision

CMS is a separate Next.js product surface in the monorepo, but not a separate business source of truth.

- CMS uses platform-specific permissions.
- CMS calls dedicated `/api/cms/*` endpoints.
- SaaS application/domain services validate and execute mutations.
- SaaS module persistence remains source of truth.
- CMS has no generic direct DB access.
- CMS does not copy organizations/subscriptions/rooms/usage/jobs as authoritative data.
- Platform audit is durable structured data.
- Technical logs are owned by observability infrastructure.

## Alternatives

Separate CMS backend + business database: rejected because it creates synchronization and duplicated ownership.

CMS inside tenant Admin: rejected because platform cross-organization permissions should not share tenant navigation/scope.

## Consequences

Simpler ownership and operations, no synchronization layer, consistent domain enforcement, independently deployable frontend. Backend must expose explicit platform-authorized endpoints and Identity must distinguish platform principals.

## Non-goals

No microservice split, separate CMS business DB, SQL console, raw secret browser, or admin-impersonation decision in this ADR.
