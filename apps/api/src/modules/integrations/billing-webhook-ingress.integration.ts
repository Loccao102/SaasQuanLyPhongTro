import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { DatabaseService } from "../database/database.service.js";
import {
  BillingWebhookIngressService,
  type BillingWebhookIngressAdapter
} from "./billing-webhook-ingress.service.js";
import {
  BillingWebhookConflictError,
  SaasBillingWebhookInboxService
} from "./saas-billing-webhook-inbox.service.js";

const provider = "TEST_INGRESS_BANK";

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    "DELETE FROM saas_billing_webhook_events WHERE provider = $1",
    [provider]
  );
}

test("billing webhook ingress persists exact raw-byte fingerprint and safe headers idempotently", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const inbox = new SaasBillingWebhookInboxService(database);
  const ingress = new BillingWebhookIngressService(inbox);
  const adapter: BillingWebhookIngressAdapter = {
    provider,
    async inspect() {
      return {
        providerEventId: "provider-event-001",
        signatureStatus: "VERIFIED",
        safeHeaders: {
          "x-safe-correlation-id": "safe-001"
        }
      };
    }
  };

  try {
    await cleanup(fixturePool);

    const rawBody = Buffer.from(
      '{"message":"thanh toán ✓","amount":99000}',
      "utf8"
    );
    const expectedHash = createHash("sha256")
      .update(rawBody)
      .digest("hex");

    const first = await ingress.accept(adapter, rawBody, {
      authorization: "must-not-be-persisted",
      "x-provider-signature": "must-not-be-persisted"
    });
    const replayed = await ingress.accept(adapter, rawBody, {
      authorization: "different-secret",
      "x-provider-signature": "different-signature"
    });

    assert.equal(replayed.id, first.id);
    assert.equal(first.signatureStatus, "VERIFIED");
    assert.equal(first.processingStatus, "RECEIVED");

    const stored = await fixturePool.query<{
      raw_body: string;
      raw_body_sha256: string;
      headers: Record<string, string>;
    }>(
      `SELECT raw_body, raw_body_sha256, headers
       FROM saas_billing_webhook_events
       WHERE id = $1`,
      [first.id]
    );

    assert.equal(stored.rows[0]?.raw_body, rawBody.toString("utf8"));
    assert.equal(stored.rows[0]?.raw_body_sha256, expectedHash);
    assert.deepEqual(stored.rows[0]?.headers, {
      "x-safe-correlation-id": "safe-001"
    });

    await assert.rejects(
      () =>
        ingress.accept(
          adapter,
          Buffer.from('{"message":"different"}', "utf8"),
          {}
        ),
      BillingWebhookConflictError
    );
  } finally {
    await database.onModuleDestroy();
    await cleanup(fixturePool);
    await fixturePool.end();
  }
});
