import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ZaloTenantVault } from "./zalo-tenant-vault.js";

const organizationA = "00000000-0000-4000-8000-000000000001";
const organizationB = "00000000-0000-4000-8000-000000000002";
const state = {
  cookies: [{ name: "z", value: "private-cookie", domain: ".zalo.me", path: "/" }],
  origins: []
};

test("Zalo tenant vault roundtrip uses independent authenticated envelopes", () => {
  const vault = new ZaloTenantVault(randomBytes(32).toString("base64"));
  const encrypted = vault.encrypt(organizationA, state);
  assert.deepEqual(vault.decrypt(organizationA, encrypted), state);
  assert.notEqual(vault.encrypt(organizationA, state), encrypted);
  assert.ok(!encrypted.includes("private-cookie"));
});

test("encrypted Zalo state cannot be swapped between tenants", () => {
  const vault = new ZaloTenantVault(randomBytes(32).toString("base64"));
  const encrypted = vault.encrypt(organizationA, state);
  assert.throws(() => vault.decrypt(organizationB, encrypted));
});

test("encrypted Zalo state rejects tampering", () => {
  const vault = new ZaloTenantVault(randomBytes(32).toString("base64"));
  const encrypted = vault.encrypt(organizationA, state);
  const payload = JSON.parse(encrypted) as {
    v: number; iv: string; tag: string; data: string;
  };
  payload.tag = Buffer.alloc(16, 1).toString("base64");
  assert.throws(() => vault.decrypt(organizationA, JSON.stringify(payload)));
});

test("Zalo vault requires a 256-bit master key", () => {
  assert.throws(() => new ZaloTenantVault("not-a-valid-key"));
});

test("different keys cannot decrypt another server's sessions", () => {
  const first = new ZaloTenantVault(randomBytes(32).toString("base64"));
  const second = new ZaloTenantVault(randomBytes(32).toString("base64"));
  assert.throws(() => second.decrypt(organizationA, first.encrypt(organizationA, state)));
});
