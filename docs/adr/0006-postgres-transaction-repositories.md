# ADR-0006: PostgreSQL Transaction Boundary and Repository Adapters

- Status: Accepted
- Date: 2026-09-21

## Context

Lease lifecycle mutations must update several durable records atomically:
- Lease state/version;
- termination orchestration;
- audit events;
- idempotency receipt.

The project already treats PostgreSQL as source of truth and relies on database constraints for tenant/correctness invariants. Introducing a large ORM at this stage would add an abstraction before query shapes and domain boundaries are mature.

## Decision

Use the `pg` driver behind a small `DatabaseService` transaction boundary.

Domain/application modules:
- do not receive a global raw Pool directly;
- execute persistence through module repository adapters;
- use explicit SQL for tenant-scoped locks and writes;
- use `SELECT ... FOR UPDATE` for serialized mutation of a Lease aggregate;
- persist state change, orchestration record, audit event and idempotency receipt in the same transaction.

A trustworthy authentication layer will later resolve the principal. Application services receive that principal/membership context and still perform domain permission + resource-scope authorization.

## Consequences

Positive:
- transaction semantics are explicit;
- PostgreSQL constraints remain visible rather than hidden behind ORM behavior;
- no provider/auth vendor is coupled into Leasing;
- repository adapters can evolve without changing domain functions;
- integration tests can verify real locking/constraint/rollback behavior.

Constraints:
- SQL mapping is handwritten and must be reviewed/tested;
- repository queries must remain tenant-scoped;
- schema/query migrations require deliberate coordination;
- if query volume/complexity later justifies a query builder or ORM, that choice needs a new ADR rather than ad-hoc introduction.
