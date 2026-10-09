import assert from "node:assert/strict";
import test from "node:test";
import { fatalProviderPauseReason } from "./provider-health.js";

test("Zalo account logout/CAPTCHA do not pause other tenants", () => {
  for (const code of ["AUTH_REQUIRED", "SESSION_EXPIRED", "SESSION_STORAGE_ERROR", "CAPTCHA"]) {
    assert.equal(fatalProviderPauseReason({
      kind: "MANUAL_REVIEW", errorCode: code,
      errorMessage: "Account-specific issue"
    }), null);
  }
});

test("provider-wide UI breakage requests a global pause", () => {
  assert.match(fatalProviderPauseReason({
    kind: "UNKNOWN", errorCode: "PROVIDER_UI_BROKEN",
    errorMessage: "UI broken"
  }) ?? "", /^PROVIDER_UI_BROKEN:/);
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
