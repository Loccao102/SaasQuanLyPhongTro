# Implementation Slice 0022 — Canonical Provider Transaction Identity

## Goal

Prepare renter-payment ingestion for safe multi-channel SePay reconciliation before enabling API v2 polling.

## Invariants

- webhook provider event id remains delivery-dedup identity;
- channel transaction ids are aliases, not canonical financial identity;
- canonical fingerprint excludes channel alias;
- strong business evidence is required;
- one canonical identity links to at most one internal renter PaymentTransaction;
- aliases cannot be reused across different canonical identities;
- identity conflict never creates an allocation.

## Current SePay webhook integration

When SePay webhook payload provides both:
- `referenceCode`;
- destination `accountNumber`;

the worker emits canonical evidence with alias type `SEPAY_WEBHOOK_NUMERIC_ID`.

API recomputes and validates the canonical fingerprint rather than trusting a worker-supplied hash.

If evidence is incomplete, the existing webhook path still works using legacy provider transaction id deduplication, but it does not claim cross-channel canonical identity.

## Future API v2 sweep contract

The API v2 adapter must emit the same evidence fields and use alias type `SEPAY_API_V2_UUID`.

Before any financial insert it must:
1. resolve alias/canonical fingerprint;
2. reuse an already-linked PaymentTransaction when evidence matches;
3. route collision to review;
4. create/bind a new identity only when no linked transaction exists.

This slice does not enable polling yet.
