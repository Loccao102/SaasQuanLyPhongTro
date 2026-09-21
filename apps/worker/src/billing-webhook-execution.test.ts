import assert from "node:assert/strict";
import test from "node:test";
import type {
  BillingWebhookAdapter,
  ClaimedBillingWebhookEvent
} from "./billing-webhook-types.js";
import { executeBillingWebhookAdapterSafely } from "./billing-webhook-execution.js";

function event(provider = "TEST_BANK"): ClaimedBillingWebhookEvent {
  return {
    id: "event-1",
    provider,
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
    rawBody: "{}"
  };
}

test("billing webhook adapter exceptions become manual review", async () => {
  const adapter: BillingWebhookAdapter = {
    provider: "TEST_BANK",
    async normalize() {
      throw new Error("parser exploded");
    }
  };

  const result = await executeBillingWebhookAdapterSafely(
    adapter,
    event()
  );

  assert.equal(result.kind, "REVIEW_REQUIRED");
  if (result.kind !== "REVIEW_REQUIRED") return;
  assert.equal(result.errorCode, "BILLING_WEBHOOK_ADAPTER_ERROR");
  assert.match(result.errorMessage ?? "", /parser exploded/);
});

test("billing webhook adapter provider mismatch never parses", async () => {
  let called = false;
  const adapter: BillingWebhookAdapter = {
    provider: "OTHER_BANK",
    async normalize() {
      called = true;
      return { kind: "IGNORED" };
    }
  };

  const result = await executeBillingWebhookAdapterSafely(
    adapter,
    event("TEST_BANK")
  );

  assert.equal(result.kind, "REVIEW_REQUIRED");
  assert.equal(called, false);
});
