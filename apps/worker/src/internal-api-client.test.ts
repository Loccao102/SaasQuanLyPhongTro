import assert from "node:assert/strict";
import test from "node:test";
import { InternalWorkerApiClient } from "./internal-api-client.js";

const token = "1234567890abcdef";

test("claimBillingWebhook treats an empty successful response as no event", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("", {
      status: 201,
      headers: { "content-type": "application/json" }
    });

  try {
    const client = new InternalWorkerApiClient({
      apiBase: "http://localhost:4000/api",
      token
    });

    const result = await client.claimBillingWebhook("DEV_JSON_BANK");
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("internal API client still parses normal JSON responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });

  try {
    const client = new InternalWorkerApiClient({
      apiBase: "http://localhost:4000/api",
      token
    });

    const result = await client.observabilityHeartbeat({
      workerId: "worker-1",
      role: "BILLING_WEBHOOK",
      provider: "DEV_JSON_BANK",
      status: "HEALTHY",
      staleAfterSeconds: 60
    });

    assert.deepEqual(result, { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("internal API client reports endpoint context for invalid JSON", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("{", {
      status: 200,
      headers: { "content-type": "application/json" }
    });

  try {
    const client = new InternalWorkerApiClient({
      apiBase: "http://localhost:4000/api",
      token
    });

    await assert.rejects(
      () => client.claimBillingWebhook("DEV_JSON_BANK"),
      /Internal API returned invalid JSON \(200\) \/internal\/billing-webhooks\/claim/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
