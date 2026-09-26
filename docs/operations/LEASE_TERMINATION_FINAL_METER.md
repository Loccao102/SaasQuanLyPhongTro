# Lease Termination Final Meter Readiness

## Source of truth

Final electricity/water values stay in the existing `meter_readings` table.
The termination workflow does not create a second copy of meter data.

For an open lease termination:

```text
final reading date = lease_terminations.effective_date
```

An active meter is ready only when it has a reading exactly on that date.

## Readiness derivation

For the lease room:

- no active meters -> `NOT_REQUIRED`;
- every active meter has a reading on the termination effective date -> `READY`;
- otherwise -> `PENDING`.

When a termination is scheduled, the initial meter readiness is derived
immediately from existing meter configuration/readings.

When Metering creates a new active meter or records a reading, it recomputes
any open termination for that room in the same database transaction.

This means a newly added meter can safely move a previously ready termination
back to `PENDING` until its final reading exists.

## Admin workflow

The lease termination page exposes every active meter and the final reading
expected on the effective date.

For missing readings, an authorized operator can record the reading directly
from the termination workflow. The write still goes through the normal
Metering endpoint and therefore keeps:

- meter.write authorization;
- monotonic reading validation;
- same-date conflict protection;
- client UUID idempotency;
- standard meter-reading audit.

After the reading is durable, Metering automatically updates the lease
termination readiness.

## Ownership

Meter readiness is owned by Metering and deposit readiness is owned by the
deposit ledger. Manual readiness override is therefore no longer accepted for
those two kinds.

Financial readiness remains manually overridable until the final
invoice/debt settlement integration owns it.

## Audit

Whenever a Metering change actually changes an open termination meter state,
the system writes:

`LEASE_TERMINATION_METER_READINESS_SYNCED`

The audit metadata includes the room, resulting readiness, trigger, and
`source=METERING`.
