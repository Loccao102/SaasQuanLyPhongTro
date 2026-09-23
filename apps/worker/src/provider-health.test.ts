import assert from "node:assert/strict";
import test from "node:test";
import { fatalProviderPauseReason } from "./provider-health.js";

test("provider auth/session/captcha/ui failures request a global pause", () => {
  for (const code of [
    "AUTH_REQUIRED",
    "SESSION_EXPIRED",
    "SESSION_STORAGE_ERROR",
    "CAPTCHA",
    "PROVIDER_UI_BROKEN"
  ]) {
    const reason = fatalProviderPauseReason({
      kind: "MANUAL_REVIEW",
      errorCode: code,
      errorMessage: "provider needs operator attention"
    });

    assert.match(reason ?? "", new RegExp("^" + code + ":"));
  }
});

test("ordinary ambiguous recipient state does not globally pause provider", () => {
  const reason = fatalProviderPauseReason({
    kind: "UNKNOWN",
    errorCode: "AMBIGUOUS_SEND_STATE",
    errorMessage: "could not verify one message"
  });

  assert.equal(reason, null);
});

test("transient failures never request provider pause", () => {
  const reason = fatalProviderPauseReason({
    kind: "TRANSIENT_FAILURE",
    errorCode: "TIMEOUT",
    errorMessage: "safe pre-send timeout"
  });

  assert.equal(reason, null);
});
