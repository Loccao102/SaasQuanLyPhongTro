import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { DatabaseService } from "../database/database.service.js";
import { RenterPaymentWebhookInboxService } from "../renter-payments/renter-payment-webhook-inbox.service.js";
import { RenterPaymentWebhookIngressService } from "./renter-payment-webhook-ingress.service.js";
import { SePayRenterPaymentWebhookIngressAdapter } from "./providers/sepay-renter-payment-webhook-ingress.adapter.js";

const originalSecret = process.env.SEPAY_RENTER_WEBHOOK_SECRET;
const secret = "sepay-integration-secret-0123456789";

function restoreSecret() {
  if (originalSecret === undefined) {
    delete process.env.SEPAY_RENTER_WEBHOOK_SECRET;
  } else {
    process.env.SEPAY_RENTER_WEBHOOK_SECRET = originalSecret;
  }
}

function signature(timestamp: string, rawBody: Buffer) {
  return (
    "sha256=" +
    createHmac("sha256", secret)
      .update(timestamp + ".")
      .update(rawBody)
      .digest("hex")
  );
}

test("invalid SePay delivery cannot poison the verified transaction event id", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const pool = new Pool({ connectionString });
  const database = new DatabaseService();
  const inbox = new RenterPaymentWebhookInboxService(database);
  const ingress = new RenterPaymentWebhookIngressService(inbox);
  const adapter = new SePayRenterPaymentWebhookIngressAdapter();

  try {
    process.env.SEPAY_RENTER_WEBHOOK_SECRET = secret;
    await pool.query(
      "DELETE FROM renter_payment_webhook_events WHERE provider = 'SEPAY'"
    );

    const rawBody = Buffer.from(
      JSON.stringify({
        id: 92704,
        transactionDate: "2026-09-24 16:20:00",
        accountNumber: "0123456789",
        code: "RENT0123456789ABCDEF0123456789ABCDEF",
        content: "RENT0123456789ABCDEF0123456789ABCDEF",
        transferType: "in",
        transferAmount: 100000,
        referenceCode: "FT260924ABC"
      }),
      "utf8"
    );
    const timestamp = String(Math.floor(Date.now() / 1000));

    const forged = await ingress.accept(adapter, rawBody, {
      "x-sepay-timestamp": timestamp,
      "x-sepay-signature": "sha256=" + "0".repeat(64)
    });
    assert.equal(forged.signatureStatus, "INVALID");
    assert.match(forged.providerEventId, /^invalid:/);

    const verified = await ingress.accept(adapter, rawBody, {
      "x-sepay-timestamp": timestamp,
      "x-sepay-signature": signature(timestamp, rawBody)
    });
    assert.equal(verified.signatureStatus, "VERIFIED");
    assert.equal(verified.providerEventId, "92704");
    assert.notEqual(verified.id, forged.id);

    const rows = await pool.query<{
      provider_event_id: string;
      signature_status: string;
      processing_status: string;
    }>(
      `SELECT provider_event_id, signature_status, processing_status
       FROM renter_payment_webhook_events
       WHERE provider = 'SEPAY'
       ORDER BY created_at, id`
    );
    assert.equal(rows.rows.length, 2);
    assert.equal(rows.rows[0]?.signature_status, "INVALID");
    assert.equal(rows.rows[0]?.processing_status, "IGNORED");
    assert.equal(rows.rows[1]?.provider_event_id, "92704");
    assert.equal(rows.rows[1]?.signature_status, "VERIFIED");
    assert.equal(rows.rows[1]?.processing_status, "RECEIVED");
  } finally {
    await database.onModuleDestroy();
    await pool.query(
      "DELETE FROM renter_payment_webhook_events WHERE provider = 'SEPAY'"
    );
    await pool.end();
    restoreSecret();
  }
});
