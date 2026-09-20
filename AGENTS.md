# Repository Engineering Instructions

## Product invariants

This repository implements a scalable multi-tenant Prop-Ops SaaS. Optimize for correctness, auditability, extensibility, and operational simplicity before cleverness.

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

### Testing

For new business logic, cover:
- happy path;
- tenant isolation;
- idempotent retry;
- duplicate webhook/job;
- invalid state transition;
- partial payment;
- offline sync conflict where relevant.

### Documentation

Update an ADR when changing:
- system boundaries;
- persistence model;
- multi-tenancy strategy;
- queue/event strategy;
- provider abstraction;
- public security model.

Use the repo skills in `.agents/skills` when the task matches their description.
