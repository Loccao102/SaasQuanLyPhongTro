---
name: propops-backend-domain-development
description: Use when implementing or reviewing backend domain logic, APIs, jobs, state transitions, repositories, or application services for this Prop-Ops SaaS.
---

1. Determine the owning module before writing code.
2. Keep controllers/transport thin; business rules belong in domain/application services.
3. Never access another module's persistence directly when an explicit module contract can be used.
4. Scope tenant-owned reads/writes by organization_id server-side.
5. Model state transitions explicitly and reject invalid transitions.
6. Use idempotency keys for commands that may be retried.
7. Enqueue long-running/retryable work and return from HTTP quickly.
8. Store financial values with integer/fixed decimal semantics, never floating point.
9. Emit audit/domain events after committed state changes where downstream work depends on them.
10. Add tests for duplicate delivery, invalid transitions, authorization isolation, and retry behavior.
