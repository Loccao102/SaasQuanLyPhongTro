import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  SePayRenterPaymentWebhookIngressAdapter,
  SePayWebhookConfigurationError
} from "./sepay-renter-payment-webhook-ingress.adapter.js";

const originalSecret = process.env.SEPAY_RENTER_WEBHOOK_SECRET;
const originalPreviousSecret =
  process.env.SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS;

function restoreSecret() {
  if (originalSecret === undefined) {
    delete process.env.SEPAY_RENTER_WEBHOOK_SECRET;
  } else {
    process.env.SEPAY_RENTER_WEBHOOK_SECRET = originalSecret;
  }

  if (originalPreviousSecret === undefined) {
    delete process.env.SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS;
  } else {
    process.env.SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS =
      originalPreviousSecret;
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
    delete process.env.SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS;
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
    delete process.env.SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS;
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
    delete process.env.SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS;
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
    delete process.env.SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS;
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


test("SePay ingress accepts the previous secret only during the configured overlap window", async () => {
  try {
    const current = "sepay-current-secret-0123456789abcdef";
    const previous = "sepay-previous-secret-0123456789abc";
    process.env.SEPAY_RENTER_WEBHOOK_SECRET = current;
    process.env.SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS = previous;

    const rawBody = Buffer.from(
      JSON.stringify({
        id: 92707,
        transferType: "in",
        transferAmount: 100000
      }),
      "utf8"
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const adapter = new SePayRenterPaymentWebhookIngressAdapter();

    const oldSecretResult = await adapter.inspect({
      rawBody,
      headers: {
        "x-sepay-timestamp": timestamp,
        "x-sepay-signature": signature(previous, timestamp, rawBody)
      }
    });
    assert.equal(oldSecretResult.signatureStatus, "VERIFIED");
    assert.equal(oldSecretResult.providerEventId, "92707");

    const currentSecretResult = await adapter.inspect({
      rawBody,
      headers: {
        "x-sepay-timestamp": timestamp,
        "x-sepay-signature": signature(current, timestamp, rawBody)
      }
    });
    assert.equal(currentSecretResult.signatureStatus, "VERIFIED");

    delete process.env.SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS;

    const removedPreviousResult = await adapter.inspect({
      rawBody,
      headers: {
        "x-sepay-timestamp": timestamp,
        "x-sepay-signature": signature(previous, timestamp, rawBody)
      }
    });
    assert.equal(removedPreviousResult.signatureStatus, "INVALID");
  } finally {
    restoreSecret();
  }
});

test("SePay ingress fails closed for unsafe previous-secret rotation config", async () => {
  try {
    const current = "sepay-current-secret-0123456789abcdef";
    process.env.SEPAY_RENTER_WEBHOOK_SECRET = current;
    process.env.SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS = "too-short";
    const adapter = new SePayRenterPaymentWebhookIngressAdapter();

    await assert.rejects(
      () =>
        adapter.inspect({
          rawBody: Buffer.from(JSON.stringify({ id: 92708 }), "utf8"),
          headers: {}
        }),
      SePayWebhookConfigurationError
    );

    process.env.SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS = current;
    await assert.rejects(
      () =>
        adapter.inspect({
          rawBody: Buffer.from(JSON.stringify({ id: 92709 }), "utf8"),
          headers: {}
        }),
      SePayWebhookConfigurationError
    );
  } finally {
    restoreSecret();
  }
});
