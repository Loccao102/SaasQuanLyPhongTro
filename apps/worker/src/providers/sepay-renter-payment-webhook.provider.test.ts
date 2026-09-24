import assert from "node:assert/strict";
import test from "node:test";
import type { ClaimedBillingWebhookEvent } from "../billing-webhook-types.js";
import { SePayRenterPaymentWebhookAdapter } from "./sepay-renter-payment-webhook.provider.js";

function event(payload: unknown): ClaimedBillingWebhookEvent {
  return {
    id: "event-sepay-1",
    provider: "SEPAY",
    providerEventId: "92704",
    signatureStatus: "VERIFIED",
    processingStatus: "PROCESSING",
    rawBodySha256: "abc",
    headers: {},
    receivedAt: "2026-09-24T09:00:00.000Z",
    processingStartedAt: "2026-09-24T09:00:01.000Z",
    processingAttempts: 1,
    processedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    paymentId: null,
    rawBody: JSON.stringify(payload)
  };
}

test("SePay worker normalizes incoming payment with exact Habi payment code", async () => {
  const adapter = new SePayRenterPaymentWebhookAdapter();
  const result = await adapter.normalize(
    event({
      id: 92704,
      gateway: "MBBank",
      transactionDate: "2026-09-24 16:08:33",
      accountNumber: "0123456789",
      subAccount: "",
      code: "rent0123456789abcdef0123456789abcdef",
      content: "RENT0123456789ABCDEF0123456789ABCDEF thanh toan",
      transferType: "in",
      description: "NGUYEN VAN A chuyen tien",
      transferAmount: 100000,
      accumulated: 5000000,
      referenceCode: "FT260924ABC"
    })
  );

  assert.equal(result.kind, "PAYMENT");
  if (result.kind !== "PAYMENT") return;
  assert.equal(result.payment.providerTransactionId, "92704");
  assert.equal(result.payment.amountVnd, 100000);
  assert.equal(result.payment.occurredAt, "2026-09-24T09:08:33.000Z");
  assert.equal(
    result.payment.paymentReference,
    "RENT0123456789ABCDEF0123456789ABCDEF"
  );
  assert.equal(result.payment.destinationAccountNo, "0123456789");
  assert.deepEqual(result.payment.providerIdentity, {
    aliasType: "SEPAY_WEBHOOK_NUMERIC_ID",
    aliasValue: "92704",
    referenceNumber: "FT260924ABC",
    destinationAccountNo: "0123456789",
    occurredAt: "2026-09-24T09:08:33.000Z",
    direction: "IN",
    amountVnd: 100000
  });
  assert.equal(
    (result.payment.metadata as { gateway?: string }).gateway,
    "MBBank"
  );
});

test("SePay worker extracts Habi payment reference from content when code is absent", async () => {
  const adapter = new SePayRenterPaymentWebhookAdapter();
  const result = await adapter.normalize(
    event({
      id: 92705,
      transactionDate: "2026-09-24 16:10:00",
      accountNumber: "0123456789",
      code: null,
      content:
        "CK RENTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA tien phong",
      transferType: "in",
      transferAmount: 50000
    })
  );

  assert.equal(result.kind, "PAYMENT");
  if (result.kind !== "PAYMENT") return;
  assert.equal(
    result.payment.paymentReference,
    "RENTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
  );
  assert.equal(result.payment.providerIdentity, null);
});

test("SePay worker keeps unmatched incoming payments for review instead of guessing", async () => {
  const adapter = new SePayRenterPaymentWebhookAdapter();
  const result = await adapter.normalize(
    event({
      id: 92706,
      transactionDate: "2026-09-24 16:12:00",
      accountNumber: "0123456789",
      code: "OTHER123",
      content: "chuyen tien phong",
      transferType: "in",
      transferAmount: 50000
    })
  );

  assert.equal(result.kind, "PAYMENT");
  if (result.kind !== "PAYMENT") return;
  assert.equal(result.payment.paymentReference, null);
});

test("SePay worker ignores outgoing transactions", async () => {
  const adapter = new SePayRenterPaymentWebhookAdapter();
  const result = await adapter.normalize(
    event({
      id: 92707,
      transactionDate: "2026-09-24 16:13:00",
      transferType: "out",
      transferAmount: 50000
    })
  );

  assert.equal(result.kind, "IGNORED");
  if (result.kind !== "IGNORED") return;
  assert.equal(result.errorCode, "SEPAY_OUTGOING_TRANSACTION");
});

test("SePay worker routes invalid amount or date to review", async () => {
  const adapter = new SePayRenterPaymentWebhookAdapter();

  const invalidAmount = await adapter.normalize(
    event({
      id: 92708,
      transactionDate: "2026-09-24 16:14:00",
      transferType: "in",
      transferAmount: 0
    })
  );
  assert.equal(invalidAmount.kind, "REVIEW_REQUIRED");

  const invalidDate = await adapter.normalize(
    event({
      id: 92709,
      transactionDate: "2026-02-31 16:14:00",
      transferType: "in",
      transferAmount: 10000
    })
  );
  assert.equal(invalidDate.kind, "REVIEW_REQUIRED");
  if (invalidDate.kind !== "REVIEW_REQUIRED") return;
  assert.equal(invalidDate.errorCode, "SEPAY_TRANSACTION_DATE_INVALID");
});
