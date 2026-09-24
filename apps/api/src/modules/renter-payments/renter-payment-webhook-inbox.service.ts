import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";

type EventRow = QueryResultRow & {
  id: string;
  provider: string;
  provider_event_id: string;
  signature_status: "VERIFIED" | "INVALID" | "NOT_CONFIGURED";
  processing_status:
    | "RECEIVED"
    | "PROCESSING"
    | "PROCESSED"
    | "REVIEW_REQUIRED"
    | "IGNORED"
    | "FAILED";
  raw_body: string;
  raw_body_sha256: string;
  headers: unknown;
  provider_transaction_id: string | null;
  amount_vnd: string | null;
  occurred_at: Date | null;
  payment_reference: string | null;
  payer_name: string | null;
  note: string | null;
  normalized_payment_fingerprint: string | null;
  organization_id: string | null;
  payment_transaction_id: string | null;
  received_at: Date;
  processing_started_at: Date | null;
  processing_attempts: number;
  processed_at: Date | null;
  last_error_code: string | null;
  last_error_message: string | null;
};

export interface RenterPaymentWebhookEventView {
  id: string;
  provider: string;
  providerEventId: string;
  signatureStatus: "VERIFIED" | "INVALID" | "NOT_CONFIGURED";
  processingStatus:
    | "RECEIVED"
    | "PROCESSING"
    | "PROCESSED"
    | "REVIEW_REQUIRED"
    | "IGNORED"
    | "FAILED";
  rawBodySha256: string;
  headers: unknown;
  providerTransactionId: string | null;
  amountVnd: number | null;
  occurredAt: string | null;
  paymentReference: string | null;
  payerName: string | null;
  note: string | null;
  organizationId: string | null;
  paymentTransactionId: string | null;
  receivedAt: string;
  processingStartedAt: string | null;
  processingAttempts: number;
  processedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

export class RenterPaymentWebhookConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenterPaymentWebhookConflictError";
  }
}

@Injectable()
export class RenterPaymentWebhookInboxService {
  constructor(private readonly db: DatabaseService) {}

  persist(input: {
    provider: string;
    providerEventId: string;
    signatureStatus: "VERIFIED" | "INVALID" | "NOT_CONFIGURED";
    rawBody: string;
    rawBodySha256?: string;
    headers?: unknown;
  }): Promise<RenterPaymentWebhookEventView> {
    return this.db.withTransaction((client) =>
      this.persistInTransaction(client, input)
    );
  }

  async persistInTransaction(
    client: PoolClient,
    input: {
      provider: string;
      providerEventId: string;
      signatureStatus: "VERIFIED" | "INVALID" | "NOT_CONFIGURED";
      rawBody: string;
      rawBodySha256?: string;
      headers?: unknown;
    }
  ): Promise<RenterPaymentWebhookEventView> {
    const provider = this.require(input.provider, "provider");
    const providerEventId = this.require(input.providerEventId, "providerEventId");
    if (!input.rawBody) {
      throw new RenterPaymentWebhookConflictError("rawBody is required.");
    }
    const rawBodySha256 =
      input.rawBodySha256 ??
      createHash("sha256").update(input.rawBody).digest("hex");
    if (!/^[a-f0-9]{64}$/i.test(rawBodySha256)) {
      throw new RenterPaymentWebhookConflictError(
        "rawBodySha256 must be a SHA-256 hex digest."
      );
    }

    const inserted = await client.query<EventRow>(
      `INSERT INTO renter_payment_webhook_events (
         provider,
         provider_event_id,
         signature_status,
         processing_status,
         raw_body,
         raw_body_sha256,
         headers
       )
       VALUES (
         $1,
         $2,
         $3,
         CASE
           WHEN $3 = 'INVALID' THEN 'IGNORED'
           WHEN $3 = 'NOT_CONFIGURED' THEN 'REVIEW_REQUIRED'
           ELSE 'RECEIVED'
         END,
         $4,
         $5,
         $6::jsonb
       )
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING ${this.columns()}`,
      [
        provider,
        providerEventId,
        input.signatureStatus,
        input.rawBody,
        rawBodySha256,
        JSON.stringify(input.headers ?? {})
      ]
    );
    if (inserted.rows[0]) {
      return this.map(inserted.rows[0]);
    }

    const existing = await client.query<EventRow>(
      `SELECT ${this.columns()}
       FROM renter_payment_webhook_events
       WHERE provider = $1
         AND provider_event_id = $2
       FOR UPDATE`,
      [provider, providerEventId]
    );
    const row = existing.rows[0];
    if (!row) {
      throw new RenterPaymentWebhookConflictError(
        "Webhook could not be read after duplicate insert."
      );
    }
    if (
      row.raw_body_sha256 !== rawBodySha256 ||
      row.signature_status !== input.signatureStatus
    ) {
      throw new RenterPaymentWebhookConflictError(
        "Provider event id was reused with different content."
      );
    }
    return this.map(row);
  }

  claim(provider?: string) {
    return this.db.withTransaction(async (client) => {
      const result = await client.query<EventRow>(
        `SELECT ${this.columns()}
         FROM renter_payment_webhook_events
         CROSS JOIN LATERAL (
           SELECT (value #>> '{}')::int AS timeout_seconds
           FROM system_settings
           WHERE key = 'renter_payment_webhook_processing_timeout_seconds'
         ) timeout_config
         WHERE signature_status = 'VERIFIED'
           AND (
             processing_status = 'RECEIVED'
             OR (
               processing_status = 'PROCESSING'
               AND processing_started_at IS NOT NULL
               AND processing_started_at <=
                 now() - make_interval(secs => timeout_config.timeout_seconds)
             )
           )
           AND ($1::text IS NULL OR provider = $1)
         ORDER BY received_at, id
         FOR UPDATE OF renter_payment_webhook_events SKIP LOCKED
         LIMIT 1`,
        [provider?.trim() || null]
      );
      const row = result.rows[0];
      if (!row) return null;

      const updated = await client.query<EventRow>(
        `UPDATE renter_payment_webhook_events
         SET processing_status = 'PROCESSING',
             processing_started_at = now(),
             processing_attempts = processing_attempts + 1,
             last_error_code = NULL,
             last_error_message = NULL,
             updated_at = now()
         WHERE id = $1
         RETURNING ${this.columns()}`,
        [row.id]
      );
      const claimed = updated.rows[0]!;
      return {
        ...this.map(claimed),
        rawBody: claimed.raw_body
      };
    });
  }

  async getForProcessingInTransaction(
    client: PoolClient,
    eventId: string
  ): Promise<
    | (RenterPaymentWebhookEventView & {
        rawBody: string;
        normalizedPaymentFingerprint: string | null;
      })
    | null
  > {
    const result = await client.query<EventRow>(
      `SELECT ${this.columns()}
       FROM renter_payment_webhook_events
       WHERE id = $1
       FOR UPDATE`,
      [eventId]
    );
    const row = result.rows[0];
    if (!row) return null;
    if (
      row.signature_status !== "VERIFIED" ||
      !["PROCESSING", "PROCESSED", "REVIEW_REQUIRED"].includes(
        row.processing_status
      )
    ) {
      throw new RenterPaymentWebhookConflictError(
        "Webhook is not a verified payment-processing event."
      );
    }
    return {
      ...this.map(row),
      rawBody: row.raw_body,
      normalizedPaymentFingerprint: row.normalized_payment_fingerprint
    };
  }

  async completeNormalizedInTransaction(
    client: PoolClient,
    input: {
      eventId: string;
      outcome: "PROCESSED" | "REVIEW_REQUIRED";
      providerTransactionId: string;
      amountVnd: number;
      occurredAt: string;
      paymentReference: string | null;
      payerName: string | null;
      note: string | null;
      fingerprint: string;
      organizationId?: string | null;
      paymentTransactionId?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    }
  ) {
    const currentResult = await client.query<EventRow>(
      `SELECT ${this.columns()}
       FROM renter_payment_webhook_events
       WHERE id = $1
       FOR UPDATE`,
      [input.eventId]
    );
    const current = currentResult.rows[0];
    if (!current) {
      throw new RenterPaymentWebhookConflictError("Webhook was not found.");
    }

    if (
      current.processing_status === "PROCESSED" ||
      current.processing_status === "REVIEW_REQUIRED"
    ) {
      if (current.normalized_payment_fingerprint !== input.fingerprint) {
        throw new RenterPaymentWebhookConflictError(
          "Completed webhook was replayed with different normalized payment content."
        );
      }
      return this.map(current);
    }
    if (
      current.processing_status !== "PROCESSING" ||
      current.signature_status !== "VERIFIED"
    ) {
      throw new RenterPaymentWebhookConflictError(
        "Webhook is not a verified PROCESSING event."
      );
    }

    const updated = await client.query<EventRow>(
      `UPDATE renter_payment_webhook_events
       SET processing_status = $2,
           provider_transaction_id = $3,
           amount_vnd = $4,
           occurred_at = $5::timestamptz,
           payment_reference = $6,
           payer_name = $7,
           note = $8,
           normalized_payment_fingerprint = $9,
           organization_id = $10,
           payment_transaction_id = $11,
           processed_at = now(),
           last_error_code = $12,
           last_error_message = $13,
           updated_at = now()
       WHERE id = $1
       RETURNING ${this.columns()}`,
      [
        input.eventId,
        input.outcome,
        input.providerTransactionId,
        input.amountVnd,
        input.occurredAt,
        input.paymentReference,
        input.payerName,
        input.note,
        input.fingerprint,
        input.organizationId ?? null,
        input.paymentTransactionId ?? null,
        input.errorCode ?? null,
        input.errorMessage ?? null
      ]
    );
    return this.map(updated.rows[0]!);
  }

  completeWithoutPayment(input: {
    eventId: string;
    outcome: "REVIEW_REQUIRED" | "IGNORED" | "FAILED";
    errorCode?: string | null;
    errorMessage?: string | null;
  }) {
    return this.db.withTransaction(async (client) => {
      const result = await client.query<EventRow>(
        `SELECT ${this.columns()}
         FROM renter_payment_webhook_events
         WHERE id = $1
         FOR UPDATE`,
        [input.eventId]
      );
      const row = result.rows[0];
      if (!row) {
        throw new RenterPaymentWebhookConflictError("Webhook was not found.");
      }
      if (row.processing_status === input.outcome) {
        return this.map(row);
      }
      if (row.processing_status !== "PROCESSING") {
        throw new RenterPaymentWebhookConflictError(
          "Webhook is not in PROCESSING state."
        );
      }
      const updated = await client.query<EventRow>(
        `UPDATE renter_payment_webhook_events
         SET processing_status = $2,
             processed_at = now(),
             last_error_code = $3,
             last_error_message = $4,
             updated_at = now()
         WHERE id = $1
         RETURNING ${this.columns()}`,
        [
          input.eventId,
          input.outcome,
          input.errorCode ?? null,
          input.errorMessage ?? null
        ]
      );
      return this.map(updated.rows[0]!);
    });
  }

  private columns() {
    return `
      id::text,
      provider,
      provider_event_id,
      signature_status,
      processing_status,
      raw_body,
      raw_body_sha256,
      headers,
      provider_transaction_id,
      amount_vnd::text,
      occurred_at,
      payment_reference,
      payer_name,
      note,
      normalized_payment_fingerprint,
      organization_id::text,
      payment_transaction_id::text,
      received_at,
      processing_started_at,
      processing_attempts,
      processed_at,
      last_error_code,
      last_error_message
    `;
  }

  private map(row: EventRow): RenterPaymentWebhookEventView {
    return {
      id: row.id,
      provider: row.provider,
      providerEventId: row.provider_event_id,
      signatureStatus: row.signature_status,
      processingStatus: row.processing_status,
      rawBodySha256: row.raw_body_sha256,
      headers: row.headers,
      providerTransactionId: row.provider_transaction_id,
      amountVnd: row.amount_vnd === null ? null : Number(row.amount_vnd),
      occurredAt: row.occurred_at?.toISOString() ?? null,
      paymentReference: row.payment_reference,
      payerName: row.payer_name,
      note: row.note,
      organizationId: row.organization_id,
      paymentTransactionId: row.payment_transaction_id,
      receivedAt: row.received_at.toISOString(),
      processingStartedAt: row.processing_started_at?.toISOString() ?? null,
      processingAttempts: row.processing_attempts,
      processedAt: row.processed_at?.toISOString() ?? null,
      lastErrorCode: row.last_error_code,
      lastErrorMessage: row.last_error_message
    };
  }

  private require(value: string, field: string) {
    const normalized = value.trim();
    if (!normalized) {
      throw new RenterPaymentWebhookConflictError(field + " is required.");
    }
    return normalized;
  }
}
