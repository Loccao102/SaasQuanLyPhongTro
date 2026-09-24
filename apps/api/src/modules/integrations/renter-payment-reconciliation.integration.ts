import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { DatabaseService } from "../database/database.service.js";
import { RenterPaymentWebhookInboxService } from "../renter-payments/renter-payment-webhook-inbox.service.js";
import {
  RenterPaymentReconciliationConflictError,
  RenterPaymentReconciliationService
} from "./renter-payment-reconciliation.service.js";

const provider = "SEPAY_RECON_TEST";
const scopeKey = "integration";

async function cleanup(pool: Pool) {
  await pool.query(
    "DELETE FROM renter_payment_webhook_events WHERE provider = $1",
    [provider]
  );
  await pool.query(
    "DELETE FROM renter_payment_reconciliation_cursors WHERE provider = $1",
    [provider]
  );
}

test("reconciliation cursor uses optimistic advance and observations are durable/idempotent", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const pool = new Pool({ connectionString });
  const database = new DatabaseService();
  const inbox = new RenterPaymentWebhookInboxService(database);
  const service = new RenterPaymentReconciliationService(database, inbox);

  try {
    await cleanup(pool);

    const initial = await service.cursor(provider, scopeKey);
    assert.equal(initial.cursor, null);
    assert.equal(initial.version, 1);

    const observationInput = {
      provider,
      scopeKey,
      providerEventId: "api-v2:a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      rawBody: JSON.stringify({
        _habiSource: "SEPAY_API_V2",
        id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
      })
    };

    const first = await service.persistObservation(observationInput);
    const replay = await service.persistObservation(observationInput);
    assert.equal(replay.id, first.id);
    assert.equal(first.signatureStatus, "VERIFIED");
    assert.equal(first.processingStatus, "RECEIVED");

    const advanced = await service.advance({
      provider,
      scopeKey,
      expectedVersion: initial.version,
      nextCursor: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    });
    assert.equal(
      advanced.cursor,
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    );
    assert.equal(advanced.version, 2);
    assert.ok(advanced.lastSuccessAt);

    await assert.rejects(
      () =>
        service.advance({
          provider,
          scopeKey,
          expectedVersion: initial.version,
          nextCursor: "b1b2c3d4-e5f6-7890-abcd-ef1234567890"
        }),
      RenterPaymentReconciliationConflictError
    );

    const row = await pool.query<{
      cursor_value: string | null;
      version: number;
    }>(
      `SELECT cursor_value, version
       FROM renter_payment_reconciliation_cursors
       WHERE provider = $1 AND scope_key = $2`,
      [provider, scopeKey]
    );
    assert.equal(
      row.rows[0]?.cursor_value,
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    );
    assert.equal(row.rows[0]?.version, 2);
  } finally {
    await database.onModuleDestroy();
    await cleanup(pool);
    await pool.end();
  }
});
