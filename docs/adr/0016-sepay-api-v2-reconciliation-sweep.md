# ADR-0016: SePay API-v2 Reconciliation Through the Existing Payment Inbox

- Status: Accepted
- Date: 2026-09-25

## Context

Webhooks are the primary low-latency SePay delivery path, but production
operations need a periodic reconciliation sweep to recover missed deliveries.

SePay API v2 exposes transaction UUIDs and cursor polling through `since_id`.
The legacy webhook payload can use a different numeric ID for the same bank
transaction. A second payment ingestion pipeline would risk duplicate financial
effects and split operational behavior.

## Decision

Run periodic SePay API-v2 reconciliation inside the existing
`RENTER_PAYMENT_WEBHOOK` worker as an opt-in Edge capability.

The sweep:

1. reads a durable provider/scope cursor through the Internal API;
2. calls SePay API v2 for incoming transactions;
3. converts each row to a stable, provider observation JSON payload;
4. persists that observation through the existing renter-payment inbox;
5. advances the durable cursor only after all observations in the fetched work
   are persisted.

The existing renter-payment webhook worker then consumes those observations.
The SePay adapter recognizes both legacy webhook shape and the stable API-v2
observation shape, but both normalize to provider `SEPAY`.

Cross-channel identity is handled by ADR-0015 canonical provider transaction
identity. Source IDs are aliases; they are never independently authoritative
financial identities.

## Cursor

`renter_payment_reconciliation_cursors` is platform integration state keyed by:

```text
(provider, scope_key)
```

Cursor updates use optimistic `version` checks. Multiple workers therefore
cannot silently overwrite progress.

Initial enablement uses a bounded lookback window. Once a transaction UUID has
been observed, subsequent sweeps use SePay `since_id`.

## Secrets

`SEPAY_API_TOKEN` remains an environment/deployment secret. It is never stored
in the database, audit metadata, frontend bundle, or log output.

## Failure behavior

- SePay/API/internal-API failure: cursor does not advance.
- Worker crash after observation persistence but before cursor advance: next
  sweep safely replays idempotent observations.
- Missing strong canonical identity evidence: event remains processable but
  cannot be cross-channel auto-merged by guesswork.
- Conflicting canonical evidence: REVIEW_REQUIRED.
- Cursor version conflict: explicit failure/retry, no lost update.

## Consequences

Positive:
- webhook and polling share one payment processor;
- no worker direct PostgreSQL access;
- financial idempotency remains centralized;
- missed webhook deliveries can be recovered;
- operational rollout can remain disabled until production verification.

Constraint:
- API-v2 sweep availability depends on SePay API credentials/rate limits;
- one scope key should identify one upstream authenticated transaction stream.
