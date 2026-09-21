import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  BillingWebhookIngressRejectedError
} from "../billing-webhook-ingress.service.js";
import { DevJsonBankWebhookIngressAdapter } from "./dev-json-bank-webhook-ingress.adapter.js";

const originalSecret = process.env.DEV_BILLING_WEBHOOK_SECRET;

function restoreSecret(): void {
  if (originalSecret === undefined) {
    delete process.env.DEV_BILLING_WEBHOOK_SECRET;
    return;
  }
  process.env.DEV_BILLING_WEBHOOK_SECRET = originalSecret;
}

test("dev billing webhook ingress verifies raw-body HMAC and sanitizes headers", async () => {
  try {
    const secret = "0123456789abcdef0123456789abcdef";
    process.env.DEV_BILLING_WEBHOOK_SECRET = secret;
    const rawBody = Buffer.from(
      '{"transactionId":"tx-1","amountVnd":99000}',
      "utf8"
    );
    const signature = createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    const adapter = new DevJsonBankWebhookIngressAdapter();
    const result = await adapter.inspect({
      rawBody,
      headers: {
        "x-dev-event-id": "event-001",
        "x-dev-signature": signature,
        "content-type": "application/json"
      }
    });

    assert.equal(result.signatureStatus, "VERIFIED");
    assert.equal(result.providerEventId, "event-001");
    assert.deepEqual(result.safeHeaders, {
      "x-dev-event-id": "event-001",
      "content-type": "application/json"
    });
    assert.equal(
      Object.hasOwn(result.safeHeaders ?? {}, "x-dev-signature"),
      false
    );
  } finally {
    restoreSecret();
  }
});

test("dev billing webhook ingress marks bad signatures invalid", async () => {
  try {
    process.env.DEV_BILLING_WEBHOOK_SECRET =
      "0123456789abcdef0123456789abcdef";

    const adapter = new DevJsonBankWebhookIngressAdapter();
    const result = await adapter.inspect({
      rawBody: Buffer.from('{"x":1}', "utf8"),
      headers: {
        "x-dev-event-id": "event-invalid",
        "x-dev-signature": "0".repeat(64)
      }
    });

    assert.equal(result.signatureStatus, "INVALID");
  } finally {
    restoreSecret();
  }
});

test("dev billing webhook ingress reports missing verifier configuration", async () => {
  try {
    delete process.env.DEV_BILLING_WEBHOOK_SECRET;

    const adapter = new DevJsonBankWebhookIngressAdapter();
    const result = await adapter.inspect({
      rawBody: Buffer.from('{"x":1}', "utf8"),
      headers: {
        "x-dev-event-id": "event-no-secret"
      }
    });

    assert.equal(result.signatureStatus, "NOT_CONFIGURED");
  } finally {
    restoreSecret();
  }
});

test("dev billing webhook ingress requires a deterministic provider event id", async () => {
  const adapter = new DevJsonBankWebhookIngressAdapter();

  await assert.rejects(
    () =>
      adapter.inspect({
        rawBody: Buffer.from('{"x":1}', "utf8"),
        headers: {}
      }),
    BillingWebhookIngressRejectedError
  );
});
