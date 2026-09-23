import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { SePayWebhookIngressAdapter } from "./sepay-webhook-ingress.adapter.js";

test("SePay ingress verifies HMAC over timestamp dot raw body and keeps only safe headers", async () => {
  const previous = process.env.SEPAY_WEBHOOK_SECRET;
  process.env.SEPAY_WEBHOOK_SECRET = "test-sepay-webhook-secret-123456";

  try {
    const adapter = new SePayWebhookIngressAdapter();
    const rawBody = Buffer.from(
      JSON.stringify({
        id: 92704,
        gateway: "Vietcombank",
        transferType: "in",
        transferAmount: 99000
      }),
      "utf8"
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature =
      "sha256=" +
      createHmac(
        "sha256",
        process.env.SEPAY_WEBHOOK_SECRET
      )
        .update(timestamp + ".", "utf8")
        .update(rawBody)
        .digest("hex");

    const inspection = await adapter.inspect({
      rawBody,
      headers: {
        "x-sepay-timestamp": timestamp,
        "x-sepay-signature": signature,
        "content-type": "application/json",
        authorization: "must-not-be-persisted"
      }
    });

    assert.equal(inspection.providerEventId, "92704");
    assert.equal(inspection.signatureStatus, "VERIFIED");
    assert.deepEqual(inspection.safeHeaders, {
      "x-sepay-timestamp": timestamp,
      "content-type": "application/json"
    });
  } finally {
    if (previous === undefined) {
      delete process.env.SEPAY_WEBHOOK_SECRET;
    } else {
      process.env.SEPAY_WEBHOOK_SECRET = previous;
    }
  }
});

test("SePay ingress rejects stale or tampered signatures", async () => {
  const previous = process.env.SEPAY_WEBHOOK_SECRET;
  process.env.SEPAY_WEBHOOK_SECRET = "test-sepay-webhook-secret-123456";

  try {
    const adapter = new SePayWebhookIngressAdapter();
    const rawBody = Buffer.from('{"id":92704}', "utf8");
    const staleTimestamp = String(
      Math.floor(Date.now() / 1000) - 301
    );
    const validForStaleTimestamp =
      "sha256=" +
      createHmac(
        "sha256",
        process.env.SEPAY_WEBHOOK_SECRET
      )
        .update(staleTimestamp + ".", "utf8")
        .update(rawBody)
        .digest("hex");

    const stale = await adapter.inspect({
      rawBody,
      headers: {
        "x-sepay-timestamp": staleTimestamp,
        "x-sepay-signature": validForStaleTimestamp
      }
    });
    assert.equal(stale.signatureStatus, "INVALID");

    const currentTimestamp = String(
      Math.floor(Date.now() / 1000)
    );
    const tampered = await adapter.inspect({
      rawBody,
      headers: {
        "x-sepay-timestamp": currentTimestamp,
        "x-sepay-signature": "sha256=" + "0".repeat(64)
      }
    });
    assert.equal(tampered.signatureStatus, "INVALID");
  } finally {
    if (previous === undefined) {
      delete process.env.SEPAY_WEBHOOK_SECRET;
    } else {
      process.env.SEPAY_WEBHOOK_SECRET = previous;
    }
  }
});

test("SePay ingress reports missing authentication configuration without accepting unsigned data", async () => {
  const previous = process.env.SEPAY_WEBHOOK_SECRET;
  delete process.env.SEPAY_WEBHOOK_SECRET;

  try {
    const adapter = new SePayWebhookIngressAdapter();
    const inspection = await adapter.inspect({
      rawBody: Buffer.from('{"id":92704}', "utf8"),
      headers: {}
    });

    assert.equal(
      inspection.signatureStatus,
      "NOT_CONFIGURED"
    );
  } finally {
    if (previous !== undefined) {
      process.env.SEPAY_WEBHOOK_SECRET = previous;
    }
  }
});
