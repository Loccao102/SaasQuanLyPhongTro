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
