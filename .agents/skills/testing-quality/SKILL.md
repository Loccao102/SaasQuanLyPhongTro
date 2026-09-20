---
name: propops-testing-quality
description: Use when adding tests, reviewing quality gates, debugging regressions, or defining CI for this repository.
---

For changed business behavior, derive tests from invariants, not only implementation.

Minimum relevant cases:
1. Happy path.
2. Cross-organization access denied.
3. Duplicate request/job/webhook remains idempotent.
4. Invalid state transition rejected.
5. Retry after transient failure.
6. Partial payment and allocation consistency.
7. Offline duplicate sync/conflict for metering.
8. Provider failure does not corrupt Core state.

Prefer:
- unit tests for domain rules;
- integration tests for DB constraints/repositories;
- contract tests for providers;
- end-to-end tests only for critical user journeys.

CI should fail on lint/typecheck/test/migration errors. Never fix a failing test by weakening a real business invariant.
