import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { DatabaseService } from "../database/database.service.js";
import {
  BillingWebhookConflictError,
  SaasBillingWebhookInboxService
} from "./saas-billing-webhook-inbox.service.js";

const provider = "TEST_SIGNATURE_UPGRADE";

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    "DELETE FROM saas_billing_webhook_events WHERE provider = $1",
    [provider]
  );
}

test("billing webhook inbox upgrades the same raw event from invalid to verified without allowing content mutation", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const pool = new Pool({ connectionString });
  const database = new DatabaseService();
  const inbox = new SaasBillingWebhookInboxService(database);

  try {
    await cleanup(pool);

    const first = await inbox.persist({
      provider,
      providerEventId: "92704",
      signatureStatus: "INVALID",
      rawBody: '{"id":92704,"amount":99000}',
      headers: { "x-safe": "first" }
    });
    assert.equal(first.processingStatus, "IGNORED");
    assert.equal(first.signatureStatus, "INVALID");

    const upgraded = await inbox.persist({
      provider,
      providerEventId: "92704",
      signatureStatus: "VERIFIED",
      rawBody: '{"id":92704,"amount":99000}',
      headers: { "x-safe": "verified" }
    });
    assert.equal(upgraded.id, first.id);
    assert.equal(upgraded.signatureStatus, "VERIFIED");
    assert.equal(upgraded.processingStatus, "RECEIVED");
    assert.deepEqual(upgraded.headers, {
      "x-safe": "verified"
    });

    const invalidReplay = await inbox.persist({
      provider,
      providerEventId: "92704",
      signatureStatus: "INVALID",
      rawBody: '{"id":92704,"amount":99000}'
    });
    assert.equal(
      invalidReplay.signatureStatus,
      "VERIFIED"
    );

    await assert.rejects(
      () =>
        inbox.persist({
          provider,
          providerEventId: "92704",
          signatureStatus: "VERIFIED",
          rawBody: '{"id":92704,"amount":100000}'
        }),
      BillingWebhookConflictError
    );
  } finally {
    await database.onModuleDestroy();
    await cleanup(pool);
    await pool.end();
  }
});
