import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  SePayRenterPaymentWebhookIngressAdapter,
  SePayWebhookConfigurationError
} from "./sepay-renter-payment-webhook-ingress.adapter.js";

const originalSecret = process.env.SEPAY_RENTER_WEBHOOK_SECRET;

function restoreSecret() {
  if (originalSecret === undefined) {
    delete process.env.SEPAY_RENTER_WEBHOOK_SECRET;
  } else {
    process.env.SEPAY_RENTER_WEBHOOK_SECRET = originalSecret;
  }
}

function signature(secret: string, timestamp: string, rawBody: Buffer) {
  return (
    "sha256=" +
    createHmac("sha256", secret)
      .update(timestamp + ".")
      .update(rawBody)
      .digest("hex")
  );
}

test("SePay ingress verifies raw body HMAC and uses transaction id only after verification", async () => {
  try {
    const secret = "sepay-test-secret-0123456789abcdef";
    process.env.SEPAY_RENTER_WEBHOOK_SECRET = secret;
    const rawBody = Buffer.from(
      JSON.stringify({
        id: 92704,
        transferType: "in",
        transferAmount: 100000
      }),
      "utf8"
    );
    const timestamp = String(Math.floor(Date.now() / 1000));

    const adapter = new SePayRenterPaymentWebhookIngressAdapter();
    const result = await adapter.inspect({
      rawBody,
      headers: {
        "x-sepay-timestamp": timestamp,
        "x-sepay-signature": signature(secret, timestamp, rawBody),
        "content-type": "application/json"
      }
    });

    assert.equal(result.signatureStatus, "VERIFIED");
    assert.equal(result.providerEventId, "92704");
    assert.deepEqual(result.safeHeaders, {
      "content-type": "application/json",
      "x-sepay-timestamp": timestamp
    });
    assert.equal(
      Object.hasOwn(result.safeHeaders ?? {}, "x-sepay-signature"),
      false
    );
  } finally {
    restoreSecret();
  }
});

test("SePay ingress rejects tampered signatures without reserving the real transaction id", async () => {
  try {
    const secret = "sepay-test-secret-0123456789abcdef";
    process.env.SEPAY_RENTER_WEBHOOK_SECRET = secret;
    const signedBody = Buffer.from(
      JSON.stringify({ id: 92704, transferAmount: 100000 }),
      "utf8"
    );
    const tamperedBody = Buffer.from(
      JSON.stringify({ id: 92704, transferAmount: 900000 }),
      "utf8"
    );
    const timestamp = String(Math.floor(Date.now() / 1000));

    const adapter = new SePayRenterPaymentWebhookIngressAdapter();
    const result = await adapter.inspect({
      rawBody: tamperedBody,
      headers: {
        "x-sepay-timestamp": timestamp,
        "x-sepay-signature": signature(secret, timestamp, signedBody)
      }
    });

    assert.equal(result.signatureStatus, "INVALID");
    assert.match(result.providerEventId, /^invalid:[a-f0-9]{64}$/);
    assert.notEqual(result.providerEventId, "92704");
  } finally {
    restoreSecret();
  }
});

test("SePay ingress rejects stale signed requests for replay protection", async () => {
  try {
    const secret = "sepay-test-secret-0123456789abcdef";
    process.env.SEPAY_RENTER_WEBHOOK_SECRET = secret;
    const rawBody = Buffer.from(JSON.stringify({ id: 92705 }), "utf8");
    const timestamp = String(Math.floor(Date.now() / 1000) - 301);

    const adapter = new SePayRenterPaymentWebhookIngressAdapter();
    const result = await adapter.inspect({
      rawBody,
      headers: {
        "x-sepay-timestamp": timestamp,
        "x-sepay-signature": signature(secret, timestamp, rawBody)
      }
    });

    assert.equal(result.signatureStatus, "INVALID");
    assert.match(result.providerEventId, /^invalid:/);
  } finally {
    restoreSecret();
  }
});

test("SePay ingress fails closed when production secret is not configured", async () => {
  try {
    delete process.env.SEPAY_RENTER_WEBHOOK_SECRET;
    const adapter = new SePayRenterPaymentWebhookIngressAdapter();

    await assert.rejects(
      () =>
        adapter.inspect({
          rawBody: Buffer.from(JSON.stringify({ id: 92706 }), "utf8"),
          headers: {}
        }),
      SePayWebhookConfigurationError
    );
  } finally {
    restoreSecret();
  }
});
