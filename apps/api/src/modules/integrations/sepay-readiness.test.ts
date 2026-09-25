import assert from "node:assert/strict";
import test from "node:test";
import { inspectSePayReadiness } from "./sepay-readiness.js";

function productionEnv(
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    RENTER_PAYMENT_WEBHOOK_PROVIDER: "SEPAY",
    SEPAY_RENTER_WEBHOOK_SECRET:
      "current-sepay-webhook-secret-0123456789",
    SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS: "",
    SEPAY_RECONCILIATION_ENABLED: "true",
    SEPAY_API_BASE_URL: "https://userapi.sepay.vn/v2",
    SEPAY_API_TOKEN: "sepay-api-token-0123456789",
    SEPAY_RECONCILIATION_SCOPE_KEY: "production-company",
    SEPAY_RECONCILIATION_INTERVAL_MS: "900000",
    SEPAY_RECONCILIATION_INITIAL_LOOKBACK_HOURS: "24",
    ...overrides
  };
}

test("SePay readiness passes a complete production cutover configuration", () => {
  const report = inspectSePayReadiness(productionEnv());
  assert.equal(report.ready, true);
  assert.equal(report.reconciliationEnabled, true);
  assert.equal(report.previousWebhookSecretConfigured, false);
  assert.deepEqual(report.issues, []);
});

test("SePay readiness fails closed for missing secrets and unsafe production URL", () => {
  const report = inspectSePayReadiness(
    productionEnv({
      SEPAY_RENTER_WEBHOOK_SECRET: "",
      SEPAY_RECONCILIATION_SCOPE_KEY: "default",
      SEPAY_API_TOKEN: "",
      SEPAY_API_BASE_URL: "http://userapi.sepay.vn/v2"
    })
  );
  assert.equal(report.ready, false);
  for (const code of [
    "WEBHOOK_SECRET_MISSING",
    "API_TOKEN_MISSING",
    "API_BASE_URL_NOT_HTTPS",
    "RECONCILIATION_SCOPE_NOT_EXPLICIT"
  ]) {
    assert.ok(report.issues.some((issue) => issue.code === code));
  }
});

test("SePay readiness reports overlap without exposing secrets", () => {
  const report = inspectSePayReadiness(
    productionEnv({
      SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS:
        "previous-sepay-webhook-secret-987654321"
    })
  );
  assert.equal(report.ready, true);
  assert.equal(report.previousWebhookSecretConfigured, true);
  assert.ok(
    report.issues.some(
      (issue) => issue.code === "WEBHOOK_ROTATION_OVERLAP_ACTIVE"
    )
  );
  assert.equal(
    JSON.stringify(report).includes("previous-sepay-webhook-secret"),
    false
  );
});

test("SePay readiness warns when reconciliation is disabled", () => {
  const report = inspectSePayReadiness(
    productionEnv({
      SEPAY_RECONCILIATION_ENABLED: "false",
      SEPAY_API_TOKEN: ""
    })
  );
  assert.equal(report.ready, true);
  assert.equal(report.reconciliationEnabled, false);
  assert.ok(
    report.issues.some(
      (issue) => issue.code === "RECONCILIATION_DISABLED"
    )
  );
});
