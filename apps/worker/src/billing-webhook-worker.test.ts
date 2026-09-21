import assert from "node:assert/strict";
import test from "node:test";
import type {
  BillingWebhookAdapter,
  ClaimedBillingWebhookEvent
} from "./billing-webhook-types.js";
import {
  type BillingWebhookWorkerApi,
  processBillingWebhookOnce
} from "./billing-webhook-worker.js";

function event(): ClaimedBillingWebhookEvent {
  return {
    id: "event-1",
    provider: "TEST_BANK",
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

test("billing webhook worker completes normalized payments", async () => {
  const calls: string[] = [];
  const api: BillingWebhookWorkerApi = {
    async claimBillingWebhook(provider) {
      calls.push("claim:" + provider);
      return event();
    },
    async completeBillingWebhookPayment(eventId, payment) {
      calls.push(
        "payment:" + eventId + ":" + payment.providerTransactionId
      );
    },
    async completeBillingWebhookOutcome() {
      calls.push("unexpected-outcome");
    }
  };
  const adapter: BillingWebhookAdapter = {
    provider: "TEST_BANK",
    async normalize() {
      return {
        kind: "PAYMENT",
        payment: {
          providerTransactionId: "tx-1",
          amountVnd: 1000,
          occurredAt: "2026-09-21T05:00:00.000Z",
          paymentReference: "SAAS1"
        }
      };
    }
  };

  assert.equal(
    await processBillingWebhookOnce(api, adapter),
    true
  );
  assert.deepEqual(calls, [
    "claim:TEST_BANK",
    "payment:event-1:tx-1"
  ]);
});

test("billing webhook worker completes review outcomes without payment", async () => {
  const calls: string[] = [];
  const api: BillingWebhookWorkerApi = {
    async claimBillingWebhook() {
      return event();
    },
    async completeBillingWebhookPayment() {
      calls.push("unexpected-payment");
    },
    async completeBillingWebhookOutcome(eventId, input) {
      calls.push(eventId + ":" + input.outcome);
    }
  };
  const adapter: BillingWebhookAdapter = {
    provider: "TEST_BANK",
    async normalize() {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "NO_REFERENCE"
      };
    }
  };

  assert.equal(
    await processBillingWebhookOnce(api, adapter),
    true
  );
  assert.deepEqual(calls, ["event-1:REVIEW_REQUIRED"]);
});

test("billing webhook worker returns false when no event is claimable", async () => {
  const api: BillingWebhookWorkerApi = {
    async claimBillingWebhook() {
      return null;
    },
    async completeBillingWebhookPayment() {},
    async completeBillingWebhookOutcome() {}
  };
  const adapter: BillingWebhookAdapter = {
    provider: "TEST_BANK",
    async normalize() {
      throw new Error("should not be called");
    }
  };

  assert.equal(
    await processBillingWebhookOnce(api, adapter),
    false
  );
});
