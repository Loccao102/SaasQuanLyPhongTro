import assert from "node:assert/strict";
import test from "node:test";
import {
  runSePayReconciliationSweepOnce,
  SePayApiV2Client,
  stableSePayApiV2Observation,
  type RenterPaymentReconciliationApi,
  type RenterPaymentReconciliationCursor
} from "./sepay-api-v2-reconciliation.js";

const tx1 = {
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  transaction_date: "2026-09-25T01:00:00+07:00",
  account_number: "0123456789",
  transfer_type: "in" as const,
  amount_in: 100000,
  amount_out: 0,
  transaction_content: "RENTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  reference_number: "FT260925A",
  code: "RENTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  bank_brand_name: "MB",
  bank_account_id: "f9e8d7c6-b5a4-3210-fedc-ba0987654321",
  va_id: null
};

const tx2 = {
  ...tx1,
  id: "b1b2c3d4-e5f6-7890-abcd-ef1234567890",
  reference_number: "FT260925B",
  amount_in: 200000
};

class MemoryApi implements RenterPaymentReconciliationApi {
  cursor: RenterPaymentReconciliationCursor = {
    provider: "SEPAY",
    scopeKey: "pilot",
    cursor: null,
    version: 1,
    lastSuccessAt: null
  };
  observations: Array<{
    providerEventId: string;
    rawBody: string;
  }> = [];

  async renterPaymentReconciliationCursor() {
    return { ...this.cursor };
  }

  async persistRenterPaymentReconciliationObservation(input: {
    provider: string;
    scopeKey: string;
    providerEventId: string;
    rawBody: string;
  }) {
    this.observations.push({
      providerEventId: input.providerEventId,
      rawBody: input.rawBody
    });
    return {};
  }

  async advanceRenterPaymentReconciliationCursor(input: {
    provider: string;
    scopeKey: string;
    expectedVersion: number;
    nextCursor: string;
  }) {
    assert.equal(input.expectedVersion, this.cursor.version);
    this.cursor = {
      ...this.cursor,
      cursor: input.nextCursor,
      version: this.cursor.version + 1,
      lastSuccessAt: "2026-09-25T00:00:00.000Z"
    };
    return { ...this.cursor };
  }
}

test("stable observation excludes mutable webhook_success state", () => {
  const observation = stableSePayApiV2Observation(tx1);
  assert.equal(
    observation.providerEventId,
    "api-v2:a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  );
  assert.equal(
    JSON.parse(observation.rawBody)._habiSource,
    "SEPAY_API_V2"
  );
  assert.equal(
    Object.hasOwn(JSON.parse(observation.rawBody), "webhook_success"),
    false
  );
});

test("API v2 client requests safe incoming cursor polling fields", async () => {
  let requested = "";
  const client = new SePayApiV2Client({
    token: "a-very-long-test-token",
    fetchFn: (async (input) => {
      requested = String(input);
      return new Response(
        JSON.stringify({
          status: "success",
          data: [tx1],
          meta: { pagination: { has_more: false } }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch
  });

  const result = await client.listTransactions({
    sinceId: tx1.id,
    perPage: 100
  });

  assert.equal(result.transactions.length, 1);
  const url = new URL(requested);
  assert.equal(url.searchParams.get("since_id"), tx1.id);
  assert.equal(url.searchParams.get("transfer_type"), "in");
  assert.equal(url.searchParams.get("transaction_date_sort"), "asc");
  assert.equal(url.searchParams.get("timestamp_format"), "iso8601");
  assert.equal(url.searchParams.get("per_page"), "100");
});

test("bootstrap sweep persists all observations before cursor advance", async () => {
  const api = new MemoryApi();
  let calls = 0;
  const client = new SePayApiV2Client({
    token: "a-very-long-test-token",
    fetchFn: (async () => {
      calls += 1;
      const data = calls === 1 ? [tx1, tx2] : [];
      return new Response(
        JSON.stringify({
          status: "success",
          data,
          meta: { pagination: { has_more: false } }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch
  });

  const result = await runSePayReconciliationSweepOnce(api, client, {
    scopeKey: "pilot",
    initialLookbackHours: 24,
    now: new Date("2026-09-25T02:00:00+07:00")
  });

  assert.equal(result.observed, 2);
  assert.equal(api.observations.length, 2);
  assert.equal(api.cursor.cursor, tx2.id);
});

test("cursor is not advanced when durable observation persistence fails", async () => {
  const api = new MemoryApi();
  api.persistRenterPaymentReconciliationObservation = async () => {
    throw new Error("internal API unavailable");
  };
  const client = new SePayApiV2Client({
    token: "a-very-long-test-token",
    fetchFn: (async () =>
      new Response(
        JSON.stringify({
          status: "success",
          data: [tx1],
          meta: { pagination: { has_more: false } }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch
  });

  await assert.rejects(
    () =>
      runSePayReconciliationSweepOnce(api, client, {
        scopeKey: "pilot",
        initialLookbackHours: 24
      }),
    /internal API unavailable/
  );
  assert.equal(api.cursor.cursor, null);
});
