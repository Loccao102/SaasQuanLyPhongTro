import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSePayProductionPreflight,
  REQUIRED_SEPAY_PRODUCTION_MIGRATIONS,
  type SePayPreflightDatabaseSnapshot
} from "./sepay-production-preflight.js";

function healthyDatabase(): SePayPreflightDatabaseSnapshot {
  return {
    schemaMigrationsTablePresent: true,
    appliedMigrations: [...REQUIRED_SEPAY_PRODUCTION_MIGRATIONS],
    tables: {
      system_worker_heartbeats: true,
      renter_invoices: true,
      organization_payment_profiles: true,
      renter_payment_webhook_events: true,
      renter_provider_transaction_identities: true,
      renter_payment_reconciliation_cursors: true
    },
    activePaymentProfiles: 1,
    outstandingOrganizationsWithoutActivePaymentProfile: 0,
    providerReviewRequired: 0,
    invalidSignature24h: 0,
    worker: {
      status: "HEALTHY",
      lastSeenAgeSeconds: 10,
      staleAfterSeconds: 180
    },
    reconciliation: {
      initialized: true,
      lastSuccessAgeSeconds: 120
    }
  };
}

const productionEnv = {
  SEPAY_RENTER_WEBHOOK_SECRET:
    "current-sepay-webhook-secret-0123456789",
  SEPAY_RECONCILIATION_ENABLED: "true",
  SEPAY_API_BASE_URL: "https://userapi.sepay.vn/v2",
  SEPAY_API_TOKEN: "sepay-api-token-0123456789",
  SEPAY_RECONCILIATION_SCOPE_KEY: "production-company",
  SEPAY_RECONCILIATION_INTERVAL_MS: "900000",
  SEPAY_RECONCILIATION_INITIAL_LOOKBACK_HOURS: "24"
};

test("production preflight passes a healthy SePay cutover configuration", () => {
  const report = evaluateSePayProductionPreflight(
    productionEnv,
    healthyDatabase()
  );

  assert.equal(report.ready, true);
  assert.equal(report.summary.fail, 0);
  assert.equal(report.summary.warn, 0);
});

test("production preflight fails unsafe financial cutover conditions", () => {
  const database = healthyDatabase();
  database.appliedMigrations = database.appliedMigrations.filter(
    (migration) =>
      migration !== "0019_renter_provider_transaction_identity.sql"
  );
  database.outstandingOrganizationsWithoutActivePaymentProfile = 2;

  const report = evaluateSePayProductionPreflight(
    {
      ...productionEnv,
      SEPAY_RENTER_WEBHOOK_SECRET: "",
      SEPAY_API_TOKEN: ""
    },
    database
  );

  assert.equal(report.ready, false);
  assert.ok(report.summary.fail >= 4);
  assert.ok(
    report.checks.some(
      (check) =>
        check.id === "payment-profile-coverage" &&
        check.status === "FAIL"
    )
  );
  assert.ok(
    report.checks.some(
      (check) => check.id === "migration-0019" && check.status === "FAIL"
    )
  );
});

test("previous-secret overlap is visible but secrets never appear in the report", () => {
  const current = "current-secret-never-log-0123456789";
  const previous = "previous-secret-never-log-01234567";
  const token = "api-token-never-log-0123456789";
  const report = evaluateSePayProductionPreflight(
    {
      ...productionEnv,
      SEPAY_RENTER_WEBHOOK_SECRET: current,
      SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS: previous,
      SEPAY_API_TOKEN: token
    },
    healthyDatabase()
  );

  assert.equal(report.ready, true);
  assert.ok(
    report.checks.some(
      (check) =>
        check.id === "webhook-previous-secret" &&
        check.status === "WARN"
    )
  );

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(current), false);
  assert.equal(serialized.includes(previous), false);
  assert.equal(serialized.includes(token), false);
});

test("disabled reconciliation stays deployable but reports recovery risk", () => {
  const report = evaluateSePayProductionPreflight(
    {
      SEPAY_RENTER_WEBHOOK_SECRET:
        "current-sepay-webhook-secret-0123456789",
      SEPAY_RECONCILIATION_ENABLED: "false"
    },
    healthyDatabase()
  );

  assert.equal(report.ready, true);
  assert.ok(
    report.checks.some(
      (check) =>
        check.id === "reconciliation-enabled" &&
        check.status === "WARN"
    )
  );
});
