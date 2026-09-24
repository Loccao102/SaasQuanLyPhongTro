import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidProviderTransactionIdentityError,
  normalizeProviderTransactionIdentity
} from "./provider-transaction-identity.js";

const webhook = {
  aliasType: "SEPAY_WEBHOOK_NUMERIC_ID",
  aliasValue: "92704",
  referenceNumber: "FT24012345678",
  destinationAccountNo: "0123456789",
  occurredAt: "2026-09-25T01:02:03+07:00",
  direction: "IN" as const,
  amountVnd: 125000
};

test("webhook numeric id and API v2 UUID map to the same canonical fingerprint", () => {
  const left = normalizeProviderTransactionIdentity("SEPAY", webhook);
  const right = normalizeProviderTransactionIdentity("sepay", {
    ...webhook,
    aliasType: "SEPAY_API_V2_UUID",
    aliasValue: "5a03e3d5-7cc5-4bfe-b88e-f78738fbf8e2",
    referenceNumber: "ft24012345678",
    destinationAccountNo: " 0123456789 ",
    occurredAt: "2026-09-24T18:02:03.000Z"
  });

  assert.equal(left.canonicalFingerprint, right.canonicalFingerprint);
  assert.notEqual(left.aliasValue, right.aliasValue);
});

test("financial/business evidence changes the canonical fingerprint", () => {
  const original = normalizeProviderTransactionIdentity("SEPAY", webhook);

  for (const changed of [
    { ...webhook, amountVnd: 125001 },
    { ...webhook, referenceNumber: "FT24012345679" },
    { ...webhook, destinationAccountNo: "0123456790" },
    { ...webhook, occurredAt: "2026-09-25T01:02:04+07:00" }
  ]) {
    assert.notEqual(
      normalizeProviderTransactionIdentity("SEPAY", changed)
        .canonicalFingerprint,
      original.canonicalFingerprint
    );
  }
});

test("canonical identity requires strong evidence instead of guessing", () => {
  assert.throws(
    () =>
      normalizeProviderTransactionIdentity("SEPAY", {
        ...webhook,
        referenceNumber: ""
      }),
    InvalidProviderTransactionIdentityError
  );
});
