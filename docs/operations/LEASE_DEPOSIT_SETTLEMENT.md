# Lease Deposit Collection & Settlement

## Boundary

The lease keeps the contractual requirement in `leases.deposit_required_vnd`.
Actual money movement is stored separately in `lease_deposit_entries`.

```text
Lease contract term
  -> deposit_required_vnd

Financial ledger
  -> COLLECTION
  -> REFUND
  -> DEDUCTION
```

Do not mutate the contractual deposit amount to represent money received,
returned, or deducted.

## Permissions

- reading the deposit ledger requires `payment.read` within the lease property scope;
- recording collection or settlement requires `payment.reconcile`;
- commercial write restrictions still apply;
- every financial command is idempotent through `lease_command_receipts`.

## Collection

Collection is allowed while a lease is `DRAFT` or `ACTIVE`.

Safety rules:

- amount is positive integer VND;
- cumulative collection cannot exceed `deposit_required_vnd`;
- retries reuse the same idempotency key;
- every collection writes `LEASE_DEPOSIT_COLLECTED` audit metadata.

## Settlement

Settlement is allowed only while the lease is
`TERMINATION_SCHEDULED` and an open termination record exists.

The operator supplies:

- amount refunded to the tenant;
- amount deducted;
- settlement timestamp;
- an audit note/reason.

The invariant is:

```text
refund + deduction == currently held deposit
```

A zero-held settlement is also supported so an authorized operator can
explicitly confirm that no deposit liability remains.

After settlement:

- `deposit_readiness` becomes `READY`;
- when no deposit was required and none was ever collected it becomes
  `NOT_REQUIRED`;
- the termination workflow itself becomes `READY` only when meter,
  financial, and deposit readiness are all non-pending;
- audit action `LEASE_DEPOSIT_SETTLED` records the financial outcome.

## Derived state

The API derives, rather than stores, the current deposit state:

```text
collected = sum(COLLECTION)
refunded  = sum(REFUND)
deducted  = sum(DEDUCTION)
held      = collected - refunded - deducted
outstanding = max(required - collected, 0)
```

UI states are `NOT_REQUIRED`, `UNPAID`, `PARTIALLY_HELD`, `HELD`,
and `SETTLED`.

## Operational rule

Never delete or rewrite historical deposit entries to "fix" a settlement.
If a correction workflow is needed later, add an explicit compensating
financial operation with its own audit trail.
