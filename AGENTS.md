# Repository Engineering Instructions

## Product invariants

This repository implements a scalable multi-tenant Prop-Ops SaaS. Optimize for correctness, auditability, extensibility, operational simplicity, and coherent product design before cleverness.

## Mandatory preflight

### Architecture preflight

BEFORE designing or implementing any feature that changes domain behavior, system boundaries, persistence, integrations, background jobs, permissions, or security:

1. MUST read `.agents/skills/project-architecture/SKILL.md`.
2. MUST read the relevant files in `docs/architecture/`.
3. MUST identify the owning domain/module.
4. MUST identify tenant boundary, idempotency needs, audit requirements, and failure states.
5. MUST read any domain-specific skill that matches the feature.

Do not begin implementation until this preflight is complete.

### Product design preflight

BEFORE designing or implementing any user-facing screen, workflow, form, navigation, destructive action, financial action, responsive behavior, or frontend feature:

1. MUST read `.agents/skills/product-design/SKILL.md`.
2. MUST read `.agents/skills/frontend-pwa/SKILL.md`.
3. MUST read `docs/design/DESIGN_SYSTEM.md`.
4. MUST identify:
   - target surface: Admin / Staff / Public Invoice;
   - primary persona and role;
   - permission and resource scope;
   - primary job-to-be-done;
   - happy path;
   - loading, empty, error, validation, and success states;
   - offline/reconnect/conflict behavior when relevant;
   - destructive/financial confirmation requirements;
   - responsive/mobile behavior;
   - reusable component candidates.
5. For financial, lease/contract, payment, deposit, permission, or destructive workflows, MUST also read the matching domain skill/docs before proposing UI.

Do not write UI code first and justify the design afterward. Design the workflow first, then implement it.

### Design review invariant

A user-facing feature is not complete unless:
- the relevant design preflight was performed;
- all critical states are represented;
- permissions/scopes are enforced server-side and reflected in UI;
- destructive/financial actions have explicit confirmation and audit behavior;
- the implementation reuses the design system instead of inventing one-off patterns without reason.

### Architecture

- Default to a **modular monolith**.
- Keep domain modules independent through explicit interfaces.
- Do not introduce microservices without measurable scaling, isolation, or deployment requirements.
- Keep external integrations behind provider/adapter interfaces.
- Never put Playwright, browser automation, SePay-specific parsing, or Telegram-specific code inside core billing/property domains.
- Long-running or retryable work must execute through jobs/workers, not synchronous request handlers.

### Multi-tenancy

- Every tenant-owned aggregate must be scoped by `organization_id`.
- Never trust a resource ID alone for authorization.
- Tenant isolation must be enforced server-side.
- Public resources use opaque, revocable tokens and expose the minimum required data.

### Data correctness

- Financial amounts use integer VND or fixed decimal types; never floating point.
- Meter readings, pricing snapshots, invoice lines, payments, allocations, and webhook events must be auditable.
- Retryable commands and webhook processing must be idempotent.
- Provider event IDs must have uniqueness constraints where available.
- Historical invoices must not change when current pricing changes.

### Jobs & integrations

- Jobs have explicit lifecycle states, retry count, last error, timestamps, and idempotency key.
- No silent failures.
- Playwright notification automation is a transitional edge adapter only.
- The core system must remain usable if a notification provider is unavailable.

### Frontend

- Admin: desktop/tablet-first web.
- Staff: mobile PWA, thumb-first, offline-first.
- Resident/public invoice: zero-install mobile web.
- Accessibility, fast load time, explicit loading/error states, and resumable workflows are required.
- Read the nearest nested `AGENTS.md` before working inside an app directory.

### Testing

For new business logic, cover:
- happy path;
- tenant isolation;
- idempotent retry;
- duplicate webhook/job;
- invalid state transition;
- partial payment;
- offline sync conflict where relevant.

For user-facing workflows, also test relevant:
- loading/empty/error states;
- permission denied/hidden actions;
- destructive confirmation;
- mobile/responsive behavior;
- offline/reconnect flows.

### Documentation

Update an ADR when changing:
- system boundaries;
- persistence model;
- multi-tenancy strategy;
- queue/event strategy;
- provider abstraction;
- public security model.

Update design docs when introducing a reusable interaction pattern or changing a product-wide UX rule.

Use the repo skills in `.agents/skills` when the task matches their description.
