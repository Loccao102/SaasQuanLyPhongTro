import assert from "node:assert/strict";
import test from "node:test";
import type { ClaimedBillingWebhookEvent } from "../billing-webhook-types.js";
import { DevJsonBankBillingWebhookAdapter } from "./dev-json-bank-billing-webhook.provider.js";

function event(rawBody: string): ClaimedBillingWebhookEvent {
  return {
    id: "event-1",
    provider: "DEV_JSON_BANK",
    providerEventId: "provider-event-1",
    signatureStatus: "VERIFIED",
    processingStatus: "PROCESSING",
    rawBodySha256: "abc",
    headers: {},
    receivedAt: "2026-09-21T05:00:00.000Z",
    processingStartedAt: "2026-09-21T05:00:01.000Z",
    processingAttempts: 1,
    processedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    paymentId: null,
    rawBody
  };
}

test("dev billing webhook adapter normalizes deterministic payment fields", async () => {
  const adapter = new DevJsonBankBillingWebhookAdapter();
  const result = await adapter.normalize(
    event(
      JSON.stringify({
        transactionId: " tx-001 ",
        amountVnd: 99000,
        occurredAt: "2026-09-21T05:05:00+07:00",
        paymentReference: " saasabc123 "
      })
    )
  );

  assert.equal(result.kind, "PAYMENT");
  if (result.kind !== "PAYMENT") return;
  assert.deepEqual(result.payment, {
    providerTransactionId: "tx-001",
    amountVnd: 99000,
    occurredAt: "2026-09-20T22:05:00.000Z",
    paymentReference: "SAASABC123",
    metadata: {
      adapter: "DEV_JSON_BANK",
      providerEventId: "provider-event-1"
    }
  });
});

test("dev billing webhook adapter refuses missing provider occurredAt", async () => {
  const adapter = new DevJsonBankBillingWebhookAdapter();
  const result = await adapter.normalize(
    event(
      JSON.stringify({
        transactionId: "tx-001",
        amountVnd: 99000
      })
    )
  );

  assert.equal(result.kind, "REVIEW_REQUIRED");
  if (result.kind !== "REVIEW_REQUIRED") return;
  assert.equal(result.errorCode, "DEV_JSON_BANK_OCCURRED_AT_INVALID");
});
