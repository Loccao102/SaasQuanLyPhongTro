import assert from "node:assert/strict";
import test from "node:test";
import type { ClaimedNotificationJob } from "../notification-types.js";
import { loadZaloPlaywrightConfig } from "./zalo-playwright.config.js";
import {
  normalizeZaloRecipientPhone,
  ZaloPlaywrightProvider
} from "./zalo-playwright.provider.js";

function job(
  deliveryReplayCheckRequired: boolean
): ClaimedNotificationJob {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000002",
    campaignId: "10000000-0000-4000-8000-000000000003",
    recipientKey: "0901234567",
    recipientDisplayName: "Nguyen A",
    provider: "PLAYWRIGHT_ZALO",
    channel: "ZALO",
    messageBody: "Unique invoice notification",
    attemptNumber: 2,
    maxAttempts: 3,
    deliveryReplayCheckRequired
  };
}

test("Zalo Playwright exposes the durable provider id used by notification jobs", () => {
  const provider = ZaloPlaywrightProvider.fromEnvironment({
    ZALO_SESSION_KEY_BASE64: Buffer.alloc(32, 7).toString("base64")
  });

  assert.equal(provider.name, "PLAYWRIGHT_ZALO");
  assert.deepEqual(provider.claimAliases, ["ZALO_PLAYWRIGHT"]);
});

test("uncertain previous delivery never auto-sends or claims a sent state", async () => {
  let acquired = false;
  let loaded = false;
  const provider = ZaloPlaywrightProvider.withStorage(
    loadZaloPlaywrightConfig({
      ZALO_SESSION_KEY_BASE64: Buffer.alloc(32, 7).toString("base64")
    }),
    { load: async () => { loaded = true; return undefined; }, save: async () => {} },
    { acquire: async () => { acquired = true; return true; }, release: async () => {} }
  );
  const claimed = job(true);
  const result = await provider.send(claimed);
  assert.equal(result.kind, "MANUAL_REVIEW");
  if (result.kind === "MANUAL_REVIEW") {
    assert.equal(result.errorCode, "ZALO_PREVIOUS_SEND_UNVERIFIED");
    assert.equal((result.evidence as { stage: string }).stage, "previous-uncertain-send-review");
  }
  assert.equal(acquired, false);
  assert.equal(loaded, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(claimed.messageBody), false);
  assert.equal(serialized.includes(claimed.recipientKey), false);
});

test("a fresh first attempt still proceeds to tenant session lookup", async () => {
  let loaded = false;
  let released = false;
  const provider = ZaloPlaywrightProvider.withStorage(
    loadZaloPlaywrightConfig({
      ZALO_SESSION_KEY_BASE64: Buffer.alloc(32, 7).toString("base64")
    }),
    { load: async () => { loaded = true; return undefined; }, save: async () => {} },
    { acquire: async () => true, release: async () => { released = true; } }
  );
  const result = await provider.send(job(false));
  assert.equal(result.kind, "MANUAL_REVIEW");
  if (result.kind === "MANUAL_REVIEW") {
    assert.equal(result.errorCode, "ZALO_SESSION_NOT_CONNECTED");
  }
  assert.equal(loaded, true);
  assert.equal(released, true);
});

test("Zalo phone-only recipients normalize local and international formats", () => {
  assert.equal(normalizeZaloRecipientPhone("0359224828"), "0359224828");
  assert.equal(normalizeZaloRecipientPhone("+84359224828"), "0359224828");
  assert.equal(normalizeZaloRecipientPhone("84359224828"), "0359224828");
  assert.equal(normalizeZaloRecipientPhone("035 922 4828"), "0359224828");
  assert.equal(normalizeZaloRecipientPhone("invalid"), null);
  assert.equal(normalizeZaloRecipientPhone("123"), null);
});

test("phone-only job proceeds past validation to Zalo session lookup", async () => {
  let released = false;
  const provider = ZaloPlaywrightProvider.withStorage(
    loadZaloPlaywrightConfig({
      ZALO_SESSION_KEY_BASE64: Buffer.alloc(32, 7).toString("base64")
    }),
    { load: async () => undefined, save: async () => {} },
    {
      acquire: async () => true,
      release: async () => { released = true; }
    }
  );
  const result = await provider.send({
    ...job(false),
    recipientDisplayName: null,
    attemptNumber: 1
  });
  assert.equal(result.kind, "MANUAL_REVIEW");
  if (result.kind === "MANUAL_REVIEW") {
    assert.equal(result.errorCode, "ZALO_SESSION_NOT_CONNECTED");
  }
  assert.equal(released, true);
});
