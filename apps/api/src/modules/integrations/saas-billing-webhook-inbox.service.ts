import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";

type WebhookEventRow = QueryResultRow & {
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
  received_at: Date;
  processing_started_at: Date | null;
  processing_attempts: number;
  processed_at: Date | null;
  last_error_code: string | null;
  last_error_message: string | null;
  payment_id: string | null;
  normalized_payment_fingerprint: string | null;
};

export interface SaasBillingWebhookEventView {
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
  receivedAt: string;
  processingStartedAt: string | null;
  processingAttempts: number;
  processedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  paymentId: string | null;
}

export class BillingWebhookConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingWebhookConflictError";
  }
}

@Injectable()
export class SaasBillingWebhookInboxService {
  constructor(private readonly database: DatabaseService) {}

  persist(input: {
    provider: string;
    providerEventId: string;
    signatureStatus: "VERIFIED" | "INVALID" | "NOT_CONFIGURED";
    rawBody: string;
    rawBodySha256?: string;
    headers?: unknown;
  }): Promise<SaasBillingWebhookEventView> {
    return this.database.withTransaction((client) =>
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
      headers?: unknown;
    }
  ): Promise<SaasBillingWebhookEventView> {
    const provider = this.requireValue(input.provider, "provider");
    const providerEventId = this.requireValue(
      input.providerEventId,
      "providerEventId"
    );
    if (input.rawBody.length === 0) {
      throw new BillingWebhookConflictError("rawBody is required.");
    }

    const rawBodySha256 =
      input.rawBodySha256 ??
      createHash("sha256").update(input.rawBody).digest("hex");

    if (!/^[a-f0-9]{64}$/i.test(rawBodySha256)) {
      throw new BillingWebhookConflictError(
        "rawBodySha256 must be a SHA-256 hex digest."
      );
    }

    const inserted = await client.query<WebhookEventRow>(
      `INSERT INTO saas_billing_webhook_events (
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
       RETURNING
         id::text,
         provider,
         provider_event_id,
         signature_status,
         processing_status,
         raw_body,
         raw_body_sha256,
         headers,
         received_at,
         processing_started_at,
         processing_attempts,
         processed_at,
         last_error_code,
         last_error_message,
         payment_id::text,
         normalized_payment_fingerprint`,
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
      return this.mapEvent(inserted.rows[0]);
    }

    const existingResult = await client.query<WebhookEventRow>(
      this.eventSelectSql(
        "WHERE provider = $1 AND provider_event_id = $2 FOR UPDATE"
      ),
      [provider, providerEventId]
    );
    const existing = existingResult.rows[0];
    if (!existing) {
      throw new BillingWebhookConflictError(
        "Webhook event could not be read after duplicate insert."
      );
    }

    if (
      existing.raw_body_sha256 !== rawBodySha256 ||
      existing.signature_status !== input.signatureStatus
    ) {
      throw new BillingWebhookConflictError(
        "Provider event id was reused with different webhook content."
      );
    }

    return this.mapEvent(existing);
  }

  async claimNext(
    provider?: string
  ): Promise<
    | (SaasBillingWebhookEventView & { rawBody: string })
    | null
  > {
    return this.database.withTransaction(async (client) => {
      const result = await client.query<WebhookEventRow>(
        `SELECT
           id::text,
           provider,
           provider_event_id,
           signature_status,
           processing_status,
           raw_body,
           raw_body_sha256,
           headers,
           received_at,
           processing_started_at,
           processing_attempts,
           processed_at,
           last_error_code,
           last_error_message,
           payment_id::text,
           normalized_payment_fingerprint
         FROM saas_billing_webhook_events
         CROSS JOIN LATERAL (
           SELECT (value #>> '{}')::int AS timeout_seconds
           FROM system_settings
           WHERE key = 'billing_webhook_processing_timeout_seconds'
         ) timeout_config
         WHERE signature_status = 'VERIFIED'
           AND (
             processing_status = 'RECEIVED'
             OR (
               processing_status = 'PROCESSING'
               AND processing_started_at IS NOT NULL
               AND processing_started_at <=
                 now() - make_interval(
                   secs => timeout_config.timeout_seconds
                 )
             )
           )
           AND ($1::text IS NULL OR provider = $1)
         ORDER BY received_at, id
         FOR UPDATE OF saas_billing_webhook_events SKIP LOCKED
         LIMIT 1`,
        [provider?.trim() || null]
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }

      await client.query(
        `UPDATE saas_billing_webhook_events
         SET processing_status = 'PROCESSING',
             processing_started_at = now(),
             processing_attempts = processing_attempts + 1,
             last_error_code = NULL,
             last_error_message = NULL,
             updated_at = now()
         WHERE id = $1`,
        [row.id]
      );

      return {
        ...this.mapEvent({
          ...row,
          processing_status: "PROCESSING",
          processing_started_at: new Date(),
          processing_attempts: row.processing_attempts + 1
        }),
        rawBody: row.raw_body
      };
    });
  }

  async requeueInTransaction(
    client: PoolClient,
    eventId: string
  ): Promise<{
    before: SaasBillingWebhookEventView;
    after: SaasBillingWebhookEventView;
  }> {
    const result = await client.query<WebhookEventRow>(
      this.eventSelectSql("WHERE id = $1 FOR UPDATE"),
      [eventId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new BillingWebhookConflictError(
        "Billing webhook event was not found."
      );
    }

    if (row.signature_status !== "VERIFIED") {
      throw new BillingWebhookConflictError(
        "Only signature-verified billing webhooks can be requeued."
      );
    }
    if (
      row.processing_status !== "FAILED" &&
      row.processing_status !== "REVIEW_REQUIRED"
    ) {
      throw new BillingWebhookConflictError(
        "Only FAILED or REVIEW_REQUIRED billing webhooks can be requeued."
      );
    }
    if (row.payment_id !== null) {
      throw new BillingWebhookConflictError(
        "Webhook event already has a linked payment and cannot be requeued."
      );
    }

    const before = this.mapEvent(row);
    const updated = await client.query<WebhookEventRow>(
      `UPDATE saas_billing_webhook_events
       SET processing_status = 'RECEIVED',
           processing_started_at = NULL,
           processed_at = NULL,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = now()
       WHERE id = $1
       RETURNING
         id::text,
         provider,
         provider_event_id,
         signature_status,
         processing_status,
         raw_body,
         raw_body_sha256,
         headers,
         received_at,
         processing_started_at,
         processing_attempts,
         processed_at,
         last_error_code,
         last_error_message,
         payment_id::text,
         normalized_payment_fingerprint`,
      [eventId]
    );

    return {
      before,
      after: this.mapEvent(updated.rows[0]!)
    };
  }

  complete(input: {
    eventId: string;
    outcome: "PROCESSED" | "REVIEW_REQUIRED" | "IGNORED" | "FAILED";
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<SaasBillingWebhookEventView> {
    return this.database.withTransaction((client) =>
      this.completeInTransaction(client, input)
    );
  }

  async completeInTransaction(
    client: PoolClient,
    input: {
      eventId: string;
      outcome: "PROCESSED" | "REVIEW_REQUIRED" | "IGNORED" | "FAILED";
      errorCode?: string | null;
      errorMessage?: string | null;
    }
  ): Promise<SaasBillingWebhookEventView> {
    const result = await client.query<WebhookEventRow>(
      this.eventSelectSql("WHERE id = $1 FOR UPDATE"),
      [input.eventId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new BillingWebhookConflictError(
        "Billing webhook event was not found."
      );
    }

    if (
      row.processing_status !== "PROCESSING" &&
      row.processing_status !== input.outcome
    ) {
      throw new BillingWebhookConflictError(
        "Webhook event is not in PROCESSING state."
      );
    }

    if (row.processing_status === input.outcome) {
      return this.mapEvent(row);
    }

    const updated = await client.query<WebhookEventRow>(
      `UPDATE saas_billing_webhook_events
       SET processing_status = $2,
           processed_at = now(),
           last_error_code = $3,
           last_error_message = $4,
           updated_at = now()
       WHERE id = $1
       RETURNING
         id::text,
         provider,
         provider_event_id,
         signature_status,
         processing_status,
         raw_body,
         raw_body_sha256,
         headers,
         received_at,
         processing_started_at,
         processing_attempts,
         processed_at,
         last_error_code,
         last_error_message,
         payment_id::text,
         normalized_payment_fingerprint`,
      [
        row.id,
        input.outcome,
        input.errorCode ?? null,
        input.errorMessage ?? null
      ]
    );

    return this.mapEvent(updated.rows[0]!);
  }

  async getPaymentProcessingEventInTransaction(
    client: PoolClient,
    eventId: string
  ): Promise<
    | (SaasBillingWebhookEventView & {
        rawBody: string;
        normalizedPaymentFingerprint: string | null;
      })
    | null
  > {
    const result = await client.query<WebhookEventRow>(
      this.eventSelectSql("WHERE id = $1 FOR UPDATE"),
      [eventId]
    );
    const row = result.rows[0];
    if (!row) return null;
    if (
      row.signature_status !== "VERIFIED" ||
      (
        row.processing_status !== "PROCESSING" &&
        row.processing_status !== "PROCESSED"
      )
    ) {
      throw new BillingWebhookConflictError(
        "Webhook event is not a verified payment-processing event."
      );
    }

    return {
      ...this.mapEvent(row),
      rawBody: row.raw_body,
      normalizedPaymentFingerprint:
        row.normalized_payment_fingerprint
    };
  }

  async completePaymentInTransaction(
    client: PoolClient,
    input: {
      eventId: string;
      paymentId: string;
      normalizedPaymentFingerprint: string;
    }
  ): Promise<SaasBillingWebhookEventView> {
    const result = await client.query<WebhookEventRow>(
      this.eventSelectSql("WHERE id = $1 FOR UPDATE"),
      [input.eventId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new BillingWebhookConflictError(
        "Billing webhook event was not found."
      );
    }

    if (row.processing_status === "PROCESSED") {
      if (
        row.payment_id !== input.paymentId ||
        row.normalized_payment_fingerprint !==
          input.normalizedPaymentFingerprint
      ) {
        throw new BillingWebhookConflictError(
          "Processed webhook event was replayed with different normalized payment content."
        );
      }
      return this.mapEvent(row);
    }

    if (
      row.processing_status !== "PROCESSING" ||
      row.signature_status !== "VERIFIED"
    ) {
      throw new BillingWebhookConflictError(
        "Webhook event is not a verified PROCESSING event."
      );
    }

    const updated = await client.query<WebhookEventRow>(
      `UPDATE saas_billing_webhook_events
       SET processing_status = 'PROCESSED',
           processed_at = now(),
           payment_id = $2,
           normalized_payment_fingerprint = $3,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = now()
       WHERE id = $1
       RETURNING
         id::text,
         provider,
         provider_event_id,
         signature_status,
         processing_status,
         raw_body,
         raw_body_sha256,
         headers,
         received_at,
         processing_started_at,
         processing_attempts,
         processed_at,
         last_error_code,
         last_error_message,
         payment_id::text,
         normalized_payment_fingerprint`,
      [
        row.id,
        input.paymentId,
        input.normalizedPaymentFingerprint
      ]
    );

    return this.mapEvent(updated.rows[0]!);
  }

  private eventSelectSql(whereClause: string): string {
    return `SELECT
       id::text,
       provider,
       provider_event_id,
       signature_status,
       processing_status,
       raw_body,
       raw_body_sha256,
       headers,
       received_at,
       processing_started_at,
       processing_attempts,
       processed_at,
       last_error_code,
       last_error_message,
       payment_id::text,
       normalized_payment_fingerprint
     FROM saas_billing_webhook_events
     ${whereClause}`;
  }

  private mapEvent(row: WebhookEventRow): SaasBillingWebhookEventView {
    return {
      id: row.id,
      provider: row.provider,
      providerEventId: row.provider_event_id,
      signatureStatus: row.signature_status,
      processingStatus: row.processing_status,
      rawBodySha256: row.raw_body_sha256,
      headers: row.headers,
      receivedAt: row.received_at.toISOString(),
      processingStartedAt:
        row.processing_started_at?.toISOString() ?? null,
      processingAttempts: row.processing_attempts,
      processedAt: row.processed_at?.toISOString() ?? null,
      lastErrorCode: row.last_error_code,
      lastErrorMessage: row.last_error_message,
      paymentId: row.payment_id
    };
  }

  private requireValue(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new BillingWebhookConflictError(field + " is required.");
    }
    return normalized;
  }
}
