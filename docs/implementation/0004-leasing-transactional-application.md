# Implementation Slice 0004 — Transactional Leasing Application Service

## Goal

Turn the Lease state machine into a durable application workflow without prematurely choosing an authentication vendor or exposing unsafe mutation endpoints.

## Boundaries

Authentication:
- not implemented here;
- future auth resolves a trustworthy principal + membership;
- Leasing receives `LeaseActor` and always re-checks permission/resource scope.

Persistence:
- PostgreSQL through `DatabaseService` and `PostgresLeaseRepository`;
- no repository access leaks into domain functions.

## Transaction order

For each retryable lease command:

1. start PostgreSQL transaction;
2. load tenant-scoped Lease `FOR UPDATE`;
3. resolve Property + OperationalGroup resource context;
4. authorize requested permission;
5. check persisted idempotency receipt;
6. apply domain transition;
7. update Lease with optimistic version;
8. update/create termination orchestration when relevant;
9. append audit/domain event;
10. persist command receipt;
11. commit.

Any failure rolls the entire transaction back.

## Commands implemented

- activate draft lease;
- cancel draft lease;
- schedule termination;
- cancel scheduled termination;
- finalize termination.

Finalization reads the locked open termination readiness record and remains blocked while Metering, financial or deposit readiness is PENDING.

## Integration verification

Real PostgreSQL integration test covers:
- property-scope authorization denial;
- cross-organization lookup isolation;
- idempotent duplicate activation;
- exactly one activation audit event;
- database rejection of a second current lease for one room;
- termination scheduling;
- failed finalization while readiness is pending;
- rollback means failed command receipt is not persisted;
- same idempotency key can be retried after readiness changes;
- idempotent finalization retry;
- exactly one termination audit event.
