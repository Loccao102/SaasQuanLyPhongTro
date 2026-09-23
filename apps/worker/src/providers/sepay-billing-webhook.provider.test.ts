import assert from "node:assert/strict";
import test from "node:test";
import { SePayBillingWebhookAdapter } from "./sepay-billing-webhook.provider.js";
import type { ClaimedBillingWebhookEvent } from "../billing-webhook-types.js";

function event(
  payload: Record<string, unknown>,
  overrides: Partial<ClaimedBillingWebhookEvent> = {}
): ClaimedBillingWebhookEvent {
  return {
    id: "81000000-0000-4000-8000-000000000001",
    provider: "SEPAY",
    providerEventId: String(payload.id ?? "12345"),
    signatureStatus: "VERIFIED",
    processingStatus: "PROCESSING",
    rawBodySha256: "a".repeat(64),
    headers: {},
    receivedAt: new Date().toISOString(),
    processingStartedAt: new Date().toISOString(),
    processingAttempts: 1,
    processedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    paymentId: null,
    rawBody: JSON.stringify(payload),
    ...overrides
  };
}

const basePayload = {
  id: 12345,
  gateway: "MBBank",
  transactionDate: "2026-09-23 15:30:45",
  accountNumber: "0123456789",
  subAccount: "",
  code: "SAAS0123456789ABCDEF0123456789ABCDEF",
  content: "SAAS0123456789ABCDEF0123456789ABCDEF thanh toan",
  transferType: "in",
  description: "NGUYEN VAN A chuyen tien",
  transferAmount: 99000,
  accumulated: 5000000,
  referenceCode: "FT260923ABC123"
};

test("SePay webhook adapter normalizes an inbound payment using Vietnam timezone", async () => {
  const adapter = new SePayBillingWebhookAdapter(
    new Set(["0123456789"])
  );
  const result = await adapter.normalize(event(basePayload));

  assert.equal(result.kind, "PAYMENT");
  if (result.kind !== "PAYMENT") return;

  assert.deepEqual(result.payment, {
    providerTransactionId: "12345",
    amountVnd: 99000,
    occurredAt: "2026-09-23T08:30:45.000Z",
    paymentReference: "SAAS0123456789ABCDEF0123456789ABCDEF",
    metadata: {
      adapter: "SEPAY",
      gateway: "MBBank",
      accountNumber: "0123456789",
      subAccount: null,
      bankReference: "FT260923ABC123",
      providerEventId: "12345"
    }
  });
});

test("SePay webhook adapter extracts SaaS payment reference from transfer content", async () => {
  const adapter = new SePayBillingWebhookAdapter(
    new Set(["0123456789"])
  );
  const result = await adapter.normalize(
    event({
      ...basePayload,
      code: null,
      content:
        "CK SAASFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF thanh toan"
    })
  );

  assert.equal(result.kind, "PAYMENT");
  if (result.kind !== "PAYMENT") return;
  assert.equal(
    result.payment.paymentReference,
    "SAASFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
  );
});

test("SePay webhook adapter ignores outgoing transfers and reviews unknown accounts", async () => {
  const adapter = new SePayBillingWebhookAdapter(
    new Set(["0123456789"])
  );

  const outgoing = await adapter.normalize(
    event({ ...basePayload, transferType: "out" })
  );
  assert.equal(outgoing.kind, "IGNORED");

  const wrongAccount = await adapter.normalize(
    event({ ...basePayload, accountNumber: "9999999999" })
  );
  assert.equal(wrongAccount.kind, "REVIEW_REQUIRED");
  if (wrongAccount.kind === "REVIEW_REQUIRED") {
    assert.equal(
      wrongAccount.errorCode,
      "SEPAY_ACCOUNT_NOT_ALLOWED"
    );
  }
});

test("SePay webhook adapter refuses event id mismatch", async () => {
  const adapter = new SePayBillingWebhookAdapter(
    new Set(["0123456789"])
  );
  const result = await adapter.normalize(
    event(basePayload, { providerEventId: "99999" })
  );

  assert.equal(result.kind, "FAILED");
  if (result.kind === "FAILED") {
    assert.equal(result.errorCode, "SEPAY_EVENT_ID_MISMATCH");
  }
});
