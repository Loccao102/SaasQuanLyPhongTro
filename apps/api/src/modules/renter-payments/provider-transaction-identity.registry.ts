import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import {
  normalizeProviderTransactionIdentity,
  type ProviderTransactionIdentityEvidence
} from "./provider-transaction-identity.js";

type IdentityRow = QueryResultRow & {
  id: string;
  provider: string;
  canonical_fingerprint: string;
  reference_number: string;
  destination_account_no: string;
  occurred_at: Date;
  direction: "IN" | "OUT";
  amount_vnd: string;
  payment_transaction_id: string | null;
};

type AliasRow = QueryResultRow & {
  identity_id: string;
  canonical_fingerprint: string;
  payment_transaction_id: string | null;
};

export type ProviderIdentityClaim =
  | {
      kind: "MATCHED";
      identityId: string;
      canonicalFingerprint: string;
      paymentTransactionId: string | null;
    }
  | {
      kind: "CONFLICT";
      canonicalFingerprint: string;
      reason: "ALIAS_REUSED" | "CANONICAL_EVIDENCE_CONFLICT";
    };

export class ProviderTransactionIdentityRegistry {
  async claimInTransaction(
    client: PoolClient,
    input: {
      provider: string;
      evidence: ProviderTransactionIdentityEvidence;
    }
  ): Promise<ProviderIdentityClaim> {
    const normalized = normalizeProviderTransactionIdentity(
      input.provider,
      input.evidence
    );
    const provider = input.provider.trim().toUpperCase();

    const alias = await client.query<AliasRow>(
      `SELECT
         a.identity_id::text,
         i.canonical_fingerprint,
         i.payment_transaction_id::text
       FROM renter_provider_transaction_aliases a
       JOIN renter_provider_transaction_identities i
         ON i.provider = a.provider
        AND i.id = a.identity_id
       WHERE a.provider = $1
         AND a.alias_type = $2
         AND a.alias_value = $3
       FOR UPDATE OF i`,
      [provider, normalized.aliasType, normalized.aliasValue]
    );
    const existingAlias = alias.rows[0];
    if (
      existingAlias &&
      existingAlias.canonical_fingerprint !==
        normalized.canonicalFingerprint
    ) {
      return {
        kind: "CONFLICT",
        canonicalFingerprint: normalized.canonicalFingerprint,
        reason: "ALIAS_REUSED"
      };
    }

    await client.query(
      `INSERT INTO renter_provider_transaction_identities (
         id,
         provider,
         canonical_fingerprint,
         reference_number,
         destination_account_no,
         occurred_at,
         direction,
         amount_vnd
       )
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8)
       ON CONFLICT (provider, canonical_fingerprint) DO NOTHING`,
      [
        randomUUID(),
        provider,
        normalized.canonicalFingerprint,
        normalized.referenceNumber,
        normalized.destinationAccountNo,
        normalized.occurredAt,
        normalized.direction,
        normalized.amountVnd
      ]
    );

    const identityResult = await client.query<IdentityRow>(
      `SELECT
         id::text,
         provider,
         canonical_fingerprint,
         reference_number,
         destination_account_no,
         occurred_at,
         direction,
         amount_vnd::text,
         payment_transaction_id::text
       FROM renter_provider_transaction_identities
       WHERE provider = $1
         AND canonical_fingerprint = $2
       FOR UPDATE`,
      [provider, normalized.canonicalFingerprint]
    );
    const identity = identityResult.rows[0];
    if (!identity) {
      throw new Error("Provider transaction identity could not be claimed.");
    }

    const evidenceMatches =
      identity.reference_number === normalized.referenceNumber &&
      identity.destination_account_no ===
        normalized.destinationAccountNo &&
      identity.occurred_at.toISOString() === normalized.occurredAt &&
      identity.direction === normalized.direction &&
      Number(identity.amount_vnd) === normalized.amountVnd;

    if (!evidenceMatches) {
      return {
        kind: "CONFLICT",
        canonicalFingerprint: normalized.canonicalFingerprint,
        reason: "CANONICAL_EVIDENCE_CONFLICT"
      };
    }

    await client.query(
      `INSERT INTO renter_provider_transaction_aliases (
         provider,
         identity_id,
         alias_type,
         alias_value
       )
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider, alias_type, alias_value) DO NOTHING`,
      [
        provider,
        identity.id,
        normalized.aliasType,
        normalized.aliasValue
      ]
    );

    const aliasCheck = await client.query<AliasRow>(
      `SELECT
         a.identity_id::text,
         i.canonical_fingerprint,
         i.payment_transaction_id::text
       FROM renter_provider_transaction_aliases a
       JOIN renter_provider_transaction_identities i
         ON i.provider = a.provider
        AND i.id = a.identity_id
       WHERE a.provider = $1
         AND a.alias_type = $2
         AND a.alias_value = $3
       FOR UPDATE OF i`,
      [provider, normalized.aliasType, normalized.aliasValue]
    );
    const claimedAlias = aliasCheck.rows[0];
    if (
      !claimedAlias ||
      claimedAlias.identity_id !== identity.id
    ) {
      return {
        kind: "CONFLICT",
        canonicalFingerprint: normalized.canonicalFingerprint,
        reason: "ALIAS_REUSED"
      };
    }

    return {
      kind: "MATCHED",
      identityId: identity.id,
      canonicalFingerprint: normalized.canonicalFingerprint,
      paymentTransactionId: identity.payment_transaction_id
    };
  }

  async bindPaymentTransactionInTransaction(
    client: PoolClient,
    input: {
      identityId: string;
      paymentTransactionId: string;
    }
  ): Promise<void> {
    const result = await client.query<QueryResultRow & {
      payment_transaction_id: string | null;
    }>(
      `SELECT payment_transaction_id::text
       FROM renter_provider_transaction_identities
       WHERE id = $1
       FOR UPDATE`,
      [input.identityId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Provider transaction identity was not found.");
    }
    if (
      row.payment_transaction_id !== null &&
      row.payment_transaction_id !== input.paymentTransactionId
    ) {
      throw new Error(
        "Provider transaction identity is already linked to another financial transaction."
      );
    }
    if (row.payment_transaction_id === input.paymentTransactionId) {
      return;
    }

    await client.query(
      `UPDATE renter_provider_transaction_identities
       SET payment_transaction_id = $2,
           updated_at = now()
       WHERE id = $1`,
      [input.identityId, input.paymentTransactionId]
    );
  }
}
