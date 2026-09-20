---
name: propops-project-architecture
description: Apply the repository's system architecture rules when designing modules, adding major features, changing boundaries, choosing sync vs async flows, or proposing infrastructure. Do not use for tiny local refactors with no architectural impact.
---

1. Read AGENTS.md and the relevant docs/architecture files first.
2. Default to modular monolith; do not introduce a service boundary without a measured reason.
3. Identify the owning domain for every new entity and business rule.
4. Keep Core domains independent from Zalo, Playwright, SePay, Telegram, SMS, Excel, and other providers.
5. Put retryable/long work behind jobs and workers.
6. Require tenant scoping, idempotency, auditability, and observable failure states.
7. Prefer the simplest design that can scale horizontally later.
8. If the proposal changes a system boundary or persistence/integration strategy, create or update an ADR in the same change.
