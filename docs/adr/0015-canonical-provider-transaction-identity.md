# ADR-0015: Canonical Provider Transaction Identity Across Ingestion Channels

- Status: Accepted
- Date: 2026-09-25

## Context

SePay webhook delivery and SePay API v2 do not use the same transaction identifier shape:

- webhook delivery exposes the legacy numeric transaction id;
- API v2 exposes a UUID transaction id/cursor.

Treating either identifier as the sole financial identity would allow the same bank transaction to be inserted twice when periodic API reconciliation is added.

Provider documentation exposes shared business evidence such as bank reference, destination account, transaction time, direction and exact amount, but does not guarantee that the bank reference alone is a globally unique immutable cross-channel key.

## Decision

Keep provider channel identifiers as aliases and introduce a provider-neutral canonical identity registry.

Canonical fingerprint inputs:

```text
provider
reference_number
destination_account_no
occurred_at (normalized ISO instant)
direction
amount_vnd
```

The channel alias is deliberately excluded from the fingerprint.

Examples:

```text
SEPAY_WEBHOOK_NUMERIC_ID -> 92704
SEPAY_API_V2_UUID        -> 5a03e3d5-...
                         \
                          -> one canonical identity
                             -> one renter PaymentTransaction
```

Rules:

1. Canonical matching is used only when all required evidence is present.
2. Reference number alone never authorizes an automatic financial effect.
3. Alias reuse with different canonical evidence is a conflict.
4. Canonical identity linked to different financial content routes to REVIEW_REQUIRED.
5. Identity may exist without a tenant/payment link when a provider transaction was observed but the renter invoice cannot yet be attributed.
6. Existing `provider_transaction_id` remains for backward compatibility and first-channel diagnostics; it is not the cross-channel source of truth.
7. API v2 sweep must resolve/register canonical identity before creating any renter payment transaction or allocation.

## Consequences

Positive:
- webhook and future polling can deduplicate one bank transaction;
- provider aliases remain queryable for operations;
- un-attributable provider observations can still be remembered globally;
- collisions fail safely instead of duplicating money.

Constraints:
- provider adapters must emit sufficiently strong canonical evidence;
- polling cannot auto-ingest rows missing canonical evidence;
- identity conflicts require operational review;
- periodic sweep is intentionally blocked until API v2 adapter tests reuse this contract.
