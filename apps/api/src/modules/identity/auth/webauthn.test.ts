import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePasskeyName,
  normalizePasskeyTransports,
  uuidToWebAuthnUserId,
  webAuthnConfig
} from "./webauthn.js";

test("uuidToWebAuthnUserId produces stable 16-byte opaque user handle", () => {
  const result = uuidToWebAuthnUserId(
    "00112233-4455-6677-8899-aabbccddeeff"
  );
  assert.equal(result.byteLength, 16);
  assert.equal(
    Buffer.from(result).toString("hex"),
    "00112233445566778899aabbccddeeff"
  );
});

test("uuidToWebAuthnUserId rejects non-UUID values", () => {
  assert.throws(
    () => uuidToWebAuthnUserId("not-a-user-id"),
    /must originate from a UUID/
  );
});

test("passkey metadata is normalized before persistence", () => {
  assert.equal(
    normalizePasskeyName("  Laptop    Windows Hello  "),
    "Laptop Windows Hello"
  );
  assert.equal(normalizePasskeyName("   "), "Passkey");
  assert.deepEqual(
    normalizePasskeyTransports([
      "internal",
      "hybrid",
      "cable",
      "smart-card",
      "usb"
    ]),
    ["internal", "hybrid", "usb"]
  );
});

test("development WebAuthn config has safe local defaults", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousName = process.env.AUTH_WEBAUTHN_RP_NAME;
  const previousId = process.env.AUTH_WEBAUTHN_RP_ID;
  const previousOrigins = process.env.AUTH_WEBAUTHN_ORIGINS;
  const previousTtl = process.env.AUTH_WEBAUTHN_CHALLENGE_TTL_MINUTES;

  try {
    process.env.NODE_ENV = "test";
    delete process.env.AUTH_WEBAUTHN_RP_NAME;
    delete process.env.AUTH_WEBAUTHN_RP_ID;
    delete process.env.AUTH_WEBAUTHN_ORIGINS;
    delete process.env.AUTH_WEBAUTHN_CHALLENGE_TTL_MINUTES;

    assert.deepEqual(webAuthnConfig(), {
      rpName: "Habi",
      rpID: "localhost",
      origins: [
        "http://localhost:3000",
        "http://localhost:3003"
      ],
      challengeTtlMinutes: 5
    });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousName === undefined) delete process.env.AUTH_WEBAUTHN_RP_NAME;
    else process.env.AUTH_WEBAUTHN_RP_NAME = previousName;
    if (previousId === undefined) delete process.env.AUTH_WEBAUTHN_RP_ID;
    else process.env.AUTH_WEBAUTHN_RP_ID = previousId;
    if (previousOrigins === undefined) delete process.env.AUTH_WEBAUTHN_ORIGINS;
    else process.env.AUTH_WEBAUTHN_ORIGINS = previousOrigins;
    if (previousTtl === undefined) {
      delete process.env.AUTH_WEBAUTHN_CHALLENGE_TTL_MINUTES;
    } else {
      process.env.AUTH_WEBAUTHN_CHALLENGE_TTL_MINUTES = previousTtl;
    }
  }
});
