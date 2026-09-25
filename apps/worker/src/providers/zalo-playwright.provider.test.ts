import assert from "node:assert/strict";
import test from "node:test";
import type { ClaimedNotificationJob } from "../notification-types.js";
import {
  existingDeliveryReplayResult,
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

test("replay detection confirms an existing exact message without exposing message content", () => {
  const claimed = job(true);
  const result = existingDeliveryReplayResult(claimed, 1);

  assert.ok(result);
  assert.equal(result.kind, "SENT_CONFIRMED");
  if (result.kind !== "SENT_CONFIRMED") return;
  assert.equal(result.recipientVerified, true);
  assert.equal(result.sendVerified, true);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(claimed.messageBody), false);
  assert.equal(serialized.includes(claimed.recipientKey), false);
  assert.equal(
    (result.evidence as { stage?: string } | undefined)?.stage,
    "pre-send-replay-detected"
  );
});

test("replay detection never auto-confirms a normal first delivery or absent message", () => {
  assert.equal(existingDeliveryReplayResult(job(false), 1), null);
  assert.equal(existingDeliveryReplayResult(job(true), 0), null);
});
