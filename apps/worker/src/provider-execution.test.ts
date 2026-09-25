import assert from "node:assert/strict";
import test from "node:test";
import {
  type ClaimedNotificationJob,
  type NotificationProvider
} from "./notification-types.js";
import { executeProviderSafely } from "./provider-execution.js";

const job: ClaimedNotificationJob = {
  id: "job-1",
  organizationId: "org-1",
  campaignId: "campaign-1",
  recipientKey: "recipient-1",
  recipientDisplayName: null,
  provider: "TEST",
  channel: "TEST",
  messageBody: "hello",
  attemptNumber: 1,
  maxAttempts: 3,
  deliveryReplayCheckRequired: false
};

test("unhandled provider exceptions become UNKNOWN, never retryable success", async () => {
  const provider: NotificationProvider = {
    name: "TEST",
    async send() {
      throw new Error("browser crashed after an ambiguous action");
    }
  };

  const result = await executeProviderSafely(provider, job);

  assert.equal(result.kind, "UNKNOWN");
  if (result.kind === "UNKNOWN") {
    assert.equal(result.errorCode, "PROVIDER_EXCEPTION");
  }
});
