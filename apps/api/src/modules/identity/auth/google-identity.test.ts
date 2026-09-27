import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign
} from "node:crypto";
import test from "node:test";
import { verifyGoogleIdentityToken } from "./google-identity.js";

const clientId = "test-client.apps.googleusercontent.com";
const validNonce = "nonce-a-0123456789abcdef0123456789abcdef";
const replayNonce = "nonce-b-fedcba9876543210fedcba9876543210";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048
});
const publicJwk = publicKey.export({ format: "jwk" });
const jwk = {
  ...publicJwk,
  kid: "habi-test-key",
  alg: "RS256",
  use: "sig"
};

function jwt(input: {
  nonce: string;
  email?: string;
  audience?: string | string[];
  authorizedParty?: string;
  issuer?: string;
  expiresAt?: number;
}) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: jwk.kid, typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: input.issuer ?? "https://accounts.google.com",
      sub: "google-user-123",
      aud: input.audience ?? clientId,
      azp: input.authorizedParty,
      exp: input.expiresAt ?? Math.floor(Date.now() / 1000) + 300,
      email: input.email ?? "owner@gmail.com",
      email_verified: true,
      name: "Habi Owner",
      nonce: input.nonce
    })
  ).toString("base64url");
  const data = header + "." + payload;
  const signature = sign("RSA-SHA256", Buffer.from(data), privateKey)
    .toString("base64url");
  return data + "." + signature;
}

test("Google identity accepts a valid signed token with the expected nonce", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200,
      headers: { "cache-control": "public, max-age=3600" }
    });

  try {
    const identity = await verifyGoogleIdentityToken(
      jwt({ nonce: validNonce }),
      clientId,
      validNonce
    );

    assert.equal(identity.subject, "google-user-123");
    assert.equal(identity.email, "owner@gmail.com");
    assert.equal(identity.authoritativeEmail, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google identity rejects replay with the wrong nonce", async () => {
  await assert.rejects(
    () =>
      verifyGoogleIdentityToken(
        jwt({ nonce: validNonce }),
        clientId,
        replayNonce
      ),
    /không vượt qua bước xác thực/
  );
});

test("Google identity rejects a token issued for another client", async () => {
  await assert.rejects(
    () =>
      verifyGoogleIdentityToken(
        jwt({
          nonce: validNonce,
          audience: "attacker.apps.googleusercontent.com"
        }),
        clientId,
        validNonce
      ),
    /không vượt qua bước xác thực/
  );
});


test("Google identity rejects a multi-audience token with a different authorized party", async () => {
  await assert.rejects(
    () =>
      verifyGoogleIdentityToken(
        jwt({
          nonce: validNonce,
          audience: [clientId, "other-client.apps.googleusercontent.com"],
          authorizedParty: "other-client.apps.googleusercontent.com"
        }),
        clientId,
        validNonce
      ),
    /không vượt qua bước xác thực/
  );
});

test("Google identity accepts a multi-audience token when azp matches Habi", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200,
      headers: { "cache-control": "public, max-age=3600" }
    });

  try {
    const identity = await verifyGoogleIdentityToken(
      jwt({
        nonce: validNonce,
        audience: [clientId, "other-client.apps.googleusercontent.com"],
        authorizedParty: clientId
      }),
      clientId,
      validNonce
    );
    assert.equal(identity.subject, "google-user-123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
