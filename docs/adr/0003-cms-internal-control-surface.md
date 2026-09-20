# ADR 0003 — CMS is an Internal Control Surface, Not a Separate Business System

- Status: Accepted
- Date: 2026-09-21

## Context

The SaaS needs an internal interface for system settings, plan configuration, customer inspection, job operations and logs/audit.

A previous design direction considered treating CMS as a separate platform business system with its own commercial database. That adds duplicated ownership and synchronization without matching the intended product scope.

## Decision

CMS is a separate **frontend/product surface**, but it is not a separate business source of truth.

- CMS has its own navigation and platform permissions.
- CMS calls dedicated `/api/cms/*` endpoints.
- SaaS backend/domain services validate and execute every mutation.
- SaaS-owned persistence remains the source of truth.
- CMS has no generic direct database access.
- CMS does not maintain copies of organizations, subscriptions, rooms, usage or jobs as authoritative data.
- Platform audit is durable and structured.
- Technical logs are handled by observability infrastructure and may be surfaced in CMS through an API.

## Alternatives

### Separate CMS backend + business database

Rejected for current scope. It creates synchronization, consistency and duplicated ownership problems while CMS only needs configuration/inspection/operations.

### Put CMS screens inside tenant Admin

Rejected. Platform cross-organization permissions and operator workflows should not share the tenant navigation/surface.

## Consequences

Positive:
- simple ownership model;
- no CMS/SaaS data synchronization;
- lower operational complexity;
- safer domain enforcement;
- CMS can still deploy independently as a frontend.

Tradeoffs:
- backend must expose explicit platform-authorized APIs;
- authorization model must distinguish tenant principals from platform principals;
- observability integration is needed to surface technical logs cleanly.

## Non-goals

- no microservice split;
- no separate CMS business DB;
- no SQL console;
- no secret browser;
- no admin impersonation decision in this ADR.
