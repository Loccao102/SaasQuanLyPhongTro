import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { DatabaseService } from "../database/database.service.js";
import {
  BillingWebhookConflictError,
  SaasBillingWebhookInboxService
} from "./saas-billing-webhook-inbox.service.js";

const provider = "TEST_BANK";

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    "DELETE FROM saas_billing_webhook_events WHERE provider = $1",
    [provider]
  );
}

test("billing webhook inbox persists raw events idempotently and gates processing", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const inbox = new SaasBillingWebhookInboxService(database);

  try {
    await cleanup(fixturePool);

    const first = await inbox.persist({
      provider,
      providerEventId: "event-001",
      signatureStatus: "VERIFIED",
      rawBody: '{"transaction":"tx-001","amount":99000}',
      headers: { "x-test-signature": "verified" }
    });

    const replayed = await inbox.persist({
      provider,
      providerEventId: "event-001",
      signatureStatus: "VERIFIED",
      rawBody: '{"transaction":"tx-001","amount":99000}',
      headers: { "x-test-signature": "verified" }
    });

    assert.deepEqual(replayed, first);
    assert.equal(first.processingStatus, "RECEIVED");

    await assert.rejects(
      () =>
        inbox.persist({
          provider,
          providerEventId: "event-001",
          signatureStatus: "VERIFIED",
          rawBody: '{"transaction":"tx-001","amount":100000}'
        }),
      BillingWebhookConflictError
    );

    const invalid = await inbox.persist({
      provider,
      providerEventId: "event-invalid",
      signatureStatus: "INVALID",
      rawBody: '{"transaction":"tx-invalid"}'
    });
    assert.equal(invalid.processingStatus, "IGNORED");

    const unconfigured = await inbox.persist({
      provider,
      providerEventId: "event-unconfigured",
      signatureStatus: "NOT_CONFIGURED",
      rawBody: '{"transaction":"tx-unconfigured"}'
    });
    assert.equal(unconfigured.processingStatus, "REVIEW_REQUIRED");

    const claimed = await inbox.claimNext(provider);
    assert.ok(claimed);
    assert.equal(claimed.id, first.id);
    assert.equal(claimed.processingStatus, "PROCESSING");
    assert.equal(claimed.processingAttempts, 1);
    assert.equal(
      claimed.rawBody,
      '{"transaction":"tx-001","amount":99000}'
    );

    const noSecondClaim = await inbox.claimNext(provider);
    assert.equal(noSecondClaim, null);

    await fixturePool.query(
      `UPDATE saas_billing_webhook_events
       SET processing_started_at = now() - interval '10 minutes'
       WHERE id = $1`,
      [claimed.id]
    );

    const reclaimed = await inbox.claimNext(provider);
    assert.ok(reclaimed);
    assert.equal(reclaimed.id, claimed.id);
    assert.equal(reclaimed.processingAttempts, 2);

    const completed = await inbox.complete({
      eventId: claimed.id,
      outcome: "PROCESSED"
    });
    assert.equal(completed.processingStatus, "PROCESSED");
    assert.ok(completed.processedAt);

    const replayedCompletion = await inbox.complete({
      eventId: claimed.id,
      outcome: "PROCESSED"
    });
    assert.equal(replayedCompletion.id, completed.id);
    assert.equal(replayedCompletion.processingStatus, "PROCESSED");

    const counts = await fixturePool.query<{
      processing_status: string;
      count: number;
    }>(
      `SELECT processing_status, count(*)::int AS count
       FROM saas_billing_webhook_events
       WHERE provider = $1
       GROUP BY processing_status
       ORDER BY processing_status`,
      [provider]
    );

    assert.deepEqual(
      counts.rows.map((row) => [row.processing_status, row.count]),
      [
        ["IGNORED", 1],
        ["PROCESSED", 1],
        ["REVIEW_REQUIRED", 1]
      ]
    );
  } finally {
    await database.onModuleDestroy();
    await cleanup(fixturePool);
    await fixturePool.end();
  }
});
