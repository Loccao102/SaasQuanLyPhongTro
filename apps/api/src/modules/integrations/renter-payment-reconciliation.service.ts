import { Injectable } from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";
import {
  RenterPaymentWebhookInboxService,
  type RenterPaymentWebhookEventView
} from "../renter-payments/renter-payment-webhook-inbox.service.js";

type CursorRow = QueryResultRow & {
  provider: string;
  scope_key: string;
  cursor_value: string | null;
  version: number;
  last_success_at: Date | null;
};

export interface RenterPaymentReconciliationCursorView {
  provider: string;
  scopeKey: string;
  cursor: string | null;
  version: number;
  lastSuccessAt: string | null;
}

export class RenterPaymentReconciliationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenterPaymentReconciliationConflictError";
  }
}

@Injectable()
export class RenterPaymentReconciliationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly inbox: RenterPaymentWebhookInboxService
  ) {}

  cursor(
    provider: string,
    scopeKey: string
  ): Promise<RenterPaymentReconciliationCursorView> {
    const normalizedProvider = this.required(provider, "provider", 64).toUpperCase();
    const normalizedScope = this.required(scopeKey, "scopeKey", 128);

    return this.db.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO renter_payment_reconciliation_cursors (
           provider,
           scope_key
         )
         VALUES ($1, $2)
         ON CONFLICT (provider, scope_key) DO NOTHING`,
        [normalizedProvider, normalizedScope]
      );

      const result = await client.query<CursorRow>(
        `SELECT
           provider,
           scope_key,
           cursor_value,
           version,
           last_success_at
         FROM renter_payment_reconciliation_cursors
         WHERE provider = $1
           AND scope_key = $2`,
        [normalizedProvider, normalizedScope]
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error("Reconciliation cursor could not be initialized.");
      }
      return this.mapCursor(row);
    });
  }

  persistObservation(input: {
    provider: string;
    scopeKey: string;
    providerEventId: string;
    rawBody: string;
  }): Promise<RenterPaymentWebhookEventView> {
    const provider = this.required(input.provider, "provider", 64).toUpperCase();
    const scopeKey = this.required(input.scopeKey, "scopeKey", 128);
    const providerEventId = this.required(
      input.providerEventId,
      "providerEventId",
      256
    );
    if (!input.rawBody || input.rawBody.length > 1_000_000) {
      throw new RenterPaymentReconciliationConflictError(
        "rawBody must contain between 1 and 1000000 characters."
      );
    }

    return this.inbox.persist({
      provider,
      providerEventId,
      signatureStatus: "VERIFIED",
      rawBody: input.rawBody,
      headers: {
        "x-habi-ingress-source": "RECONCILIATION",
        "x-habi-reconciliation-scope": scopeKey
      }
    });
  }

  advance(input: {
    provider: string;
    scopeKey: string;
    expectedVersion: number;
    nextCursor: string;
  }): Promise<RenterPaymentReconciliationCursorView> {
    const provider = this.required(input.provider, "provider", 64).toUpperCase();
    const scopeKey = this.required(input.scopeKey, "scopeKey", 128);
    const nextCursor = this.required(input.nextCursor, "nextCursor", 256);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new RenterPaymentReconciliationConflictError(
        "expectedVersion must be a positive integer."
      );
    }

    return this.db.withTransaction(async (client) => {
      const result = await client.query<CursorRow>(
        `UPDATE renter_payment_reconciliation_cursors
         SET cursor_value = $3,
             version = version + 1,
             last_success_at = now(),
             updated_at = now()
         WHERE provider = $1
           AND scope_key = $2
           AND version = $4
         RETURNING
           provider,
           scope_key,
           cursor_value,
           version,
           last_success_at`,
        [provider, scopeKey, nextCursor, input.expectedVersion]
      );
      const row = result.rows[0];
      if (!row) {
        throw new RenterPaymentReconciliationConflictError(
          "Reconciliation cursor changed concurrently."
        );
      }
      return this.mapCursor(row);
    });
  }

  private mapCursor(row: CursorRow): RenterPaymentReconciliationCursorView {
    return {
      provider: row.provider,
      scopeKey: row.scope_key,
      cursor: row.cursor_value,
      version: row.version,
      lastSuccessAt: row.last_success_at?.toISOString() ?? null
    };
  }

  private required(value: string, field: string, max: number): string {
    const normalized = value.trim();
    if (normalized.length < 1 || normalized.length > max) {
      throw new RenterPaymentReconciliationConflictError(
        field + " must contain between 1 and " + String(max) + " characters."
      );
    }
    return normalized;
  }
}
