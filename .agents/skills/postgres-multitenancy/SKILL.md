---
name: propops-postgres-multitenancy
description: Use when designing or changing PostgreSQL schema, migrations, indexes, queries, tenant isolation, or reporting projections for this repository.
---

1. Add organization_id to every tenant-owned aggregate and relevant child table.
2. Add composite indexes matching real query predicates; tenant scope normally leads the predicate.
3. Add foreign keys and uniqueness constraints for invariants.
4. Add unique constraints for provider event IDs and idempotency keys.
5. Do not use float for money or meter arithmetic that requires exactness.
6. Historical invoice lines must store pricing snapshots.
7. Prefer normalized source-of-truth tables; add cached/materialized projections only for measured read pressure.
8. Do not introduce partitioning/sharding until table size/query metrics justify it.
9. Write forward and rollback-safe migration notes for destructive changes.
10. Review every query path for cross-organization data leakage.
