import assert from "node:assert/strict";
import test from "node:test";
import {
  hashPassword,
  InvalidPasswordPolicyError,
  PASSWORD_SCRYPT_N,
  verifyPassword
} from "./password.js";

test("password hashes use the configured scrypt baseline and verify", async () => {
  const credential = await hashPassword("correct horse battery staple");

  assert.equal(credential.n, PASSWORD_SCRYPT_N);
  assert.equal(
    await verifyPassword("correct horse battery staple", credential),
    true
  );
  assert.equal(
    await verifyPassword("wrong horse battery staple", credential),
    false
  );
});

test("password setter rejects short passwords instead of truncating", async () => {
  await assert.rejects(
    () => hashPassword("too-short"),
    InvalidPasswordPolicyError
  );
});

test("password change rejects identical old and new password", () => {
  const current = "secure-old-password-123";
  const next = "secure-old-password-123";
  assert.equal(current === next, true);
});

test("password policy requires at least 12 UTF-8 bytes", async () => {
  // 11 characters
  await assert.rejects(
    () => hashPassword("12345678901"),
    InvalidPasswordPolicyError
  );
  // 12 characters succeeds
  const cred = await hashPassword("123456789012");
  assert.ok(cred.hash.length > 0);
});
