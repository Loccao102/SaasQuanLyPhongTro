import assert from "node:assert/strict";
import test from "node:test";
import { decideNotificationCompletion } from "./notification-lifecycle.js";

test("confirmed send requires both recipient and send verification", () => {
  const sent = decideNotificationCompletion({
    result: {
      kind: "SENT_CONFIRMED",
      recipientVerified: true,
      sendVerified: true
    },
    attemptCount: 1,
    maxAttempts: 3
  });

  assert.equal(sent.jobStatus, "SENT");
  assert.equal(sent.verificationState, "VERIFIED");

  const ambiguous = decideNotificationCompletion({
    result: {
      kind: "SENT_CONFIRMED",
      recipientVerified: true,
      sendVerified: false
    },
    attemptCount: 1,
    maxAttempts: 3
  });

  assert.equal(ambiguous.jobStatus, "MANUAL_REVIEW");
  assert.equal(ambiguous.sent, false);
});

test("transient failure retries with bounded backoff", () => {
  const retry = decideNotificationCompletion({
    result: {
      kind: "TRANSIENT_FAILURE",
      errorCode: "TIMEOUT",
      errorMessage: "Provider timed out"
    },
    attemptCount: 2,
    maxAttempts: 3
  });

  assert.equal(retry.jobStatus, "RETRY_WAIT");
  assert.equal(retry.retryDelaySeconds, 120);
});

test("transient failure stops after max attempts", () => {
  const failed = decideNotificationCompletion({
    result: {
      kind: "TRANSIENT_FAILURE",
      errorCode: "TIMEOUT",
      errorMessage: "Provider timed out"
    },
    attemptCount: 3,
    maxAttempts: 3
  });

  assert.equal(failed.jobStatus, "FAILED");
  assert.equal(failed.retryDelaySeconds, null);
});

test("unknown provider result is never success", () => {
  const decision = decideNotificationCompletion({
    result: { kind: "UNKNOWN" },
    attemptCount: 1,
    maxAttempts: 3
  });

  assert.equal(decision.jobStatus, "MANUAL_REVIEW");
  assert.equal(decision.sent, false);
  assert.equal(decision.verificationState, "UNKNOWN");
});

test("Zalo account restriction always needs review and never schedules automatic retries", () => {
  const decision = decideNotificationCompletion({
    result: {
      kind: "MANUAL_REVIEW",
      errorCode: "ZALO_RATE_RESTRICTED",
      errorMessage: "Zalo rate limit reported"
    },
    attemptCount: 1,
    maxAttempts: 3
  });
  assert.equal(decision.jobStatus, "MANUAL_REVIEW");
  assert.equal(decision.retryDelaySeconds, null);
  assert.equal(decision.sent, false);
});

test("uncertain post-click Zalo send is never silently retried or marked as delivered", () => {
  const decision = decideNotificationCompletion({
    result: {
      kind: "UNKNOWN",
      errorCode: "ZALO_SEND_REJECTED",
      errorMessage: "Unverified Zalo send"
    },
    attemptCount: 1,
    maxAttempts: 3
  });
  assert.equal(decision.jobStatus, "MANUAL_REVIEW");
  assert.equal(decision.retryDelaySeconds, null);
  assert.equal(decision.sent, false);
});
