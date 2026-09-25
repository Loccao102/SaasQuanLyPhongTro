import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSePayWorkerReadiness,
  failedSePayWorkerReadinessCodes
} from "./sepay-worker-readiness.js";

test("SePay worker readiness does not require API token while reconciliation is disabled", () => {
  const readiness = evaluateSePayWorkerReadiness({
    provider: "SEPAY",
    env: {
      NODE_ENV: "production",
      SEPAY_RECONCILIATION_ENABLED: "false"
    }
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.reconciliationEnabled, false);
  assert.deepEqual(failedSePayWorkerReadinessCodes(readiness), []);
});

test("SePay worker readiness fails unsafe enabled reconciliation config without exposing token", () => {
  const token = "s3cr3t";
  const readiness = evaluateSePayWorkerReadiness({
    provider: "SEPAY",
    env: {
      NODE_ENV: "production",
      SEPAY_RECONCILIATION_ENABLED: "true",
      SEPAY_API_TOKEN: token,
      SEPAY_API_BASE_URL: "http://userapi.sepay.vn/v2",
      SEPAY_RECONCILIATION_SCOPE_KEY: "default"
    }
  });

  assert.equal(readiness.ready, false);
  assert.deepEqual(failedSePayWorkerReadinessCodes(readiness).sort(), [
    "RECONCILIATION_API_NOT_HTTPS",
    "RECONCILIATION_API_TOKEN_INVALID"
  ]);
  assert.equal(JSON.stringify(readiness).includes(token), false);
});

test("SePay worker readiness accepts safe production reconciliation config", () => {
  const readiness = evaluateSePayWorkerReadiness({
    provider: "SEPAY",
    env: {
      NODE_ENV: "production",
      SEPAY_RECONCILIATION_ENABLED: "true",
      SEPAY_API_TOKEN: "token-0123456789abcdef",
      SEPAY_API_BASE_URL: "https://userapi.sepay.vn/v2",
      SEPAY_RECONCILIATION_SCOPE_KEY: "production-company"
    }
  });

  assert.equal(readiness.ready, true);
  assert.deepEqual(failedSePayWorkerReadinessCodes(readiness), []);
});

test("enabled SePay reconciliation fails when the active provider is not SePay", () => {
  const readiness = evaluateSePayWorkerReadiness({
    provider: "DEV_JSON_BANK",
    env: {
      SEPAY_RECONCILIATION_ENABLED: "true"
    }
  });

  assert.equal(readiness.ready, false);
  assert.deepEqual(failedSePayWorkerReadinessCodes(readiness), [
    "RECONCILIATION_PROVIDER_MISMATCH"
  ]);
});
