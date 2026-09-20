# ADR-0003: TypeScript Monorepo for Product Surfaces and API

- Status: Accepted
- Date: 2026-09-21

## Context

The product has three web surfaces plus a modular-monolith API. Shared types/design primitives and fast iteration are more valuable at this stage than polyglot specialization.

## Decision

Use:
- pnpm workspaces;
- Next.js for Admin Web, Staff PWA and Public Invoice;
- NestJS for Backend API;
- TypeScript across frontend/backend;
- a shared UI package for design primitives;
- PostgreSQL and Redis as planned infrastructure.

The repository may add specialized workers without changing the core monorepo approach.

## Consequences

Positive:
- one language and type system across product surfaces;
- shared UI/design primitives;
- easier CI and dependency management;
- simple path to dedicated workers later.

Constraints:
- domain boundaries remain conceptual/module boundaries; shared TypeScript is not permission to create cross-module persistence coupling;
- Public Invoice must not import Admin/Staff application code;
- PWA offline capability still requires explicit IndexedDB/service-worker implementation;
- provider-specific integrations remain Edge adapters.
