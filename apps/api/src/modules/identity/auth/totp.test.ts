import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  verifyTotpCode
} from "./totp.js";

const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("TOTP verifies the RFC 6238 SHA1 vector truncated to 6 digits", () => {
  assert.equal(verifyTotpCode(rfcSecret, "287082", 59_000), true);
  assert.equal(verifyTotpCode(rfcSecret, "287083", 59_000), false);
});

test("TOTP secrets are encrypted with authenticated encryption", () => {
  const encrypted = encryptTotpSecret(rfcSecret);
  assert.notEqual(encrypted.ciphertext.toString("utf8"), rfcSecret);
  assert.equal(decryptTotpSecret(encrypted), rfcSecret);
});

test("recovery codes have a stable hash and recognizable format", () => {
  const [code] = generateRecoveryCodes(1);
  assert.ok(code);
  assert.equal(looksLikeRecoveryCode(code), true);
  assert.deepEqual(hashRecoveryCode(code), hashRecoveryCode(code.toLowerCase()));
});
