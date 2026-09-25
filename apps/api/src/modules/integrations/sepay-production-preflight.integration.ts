import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import {
  collectSePayPreflightDatabaseSnapshot,
  REQUIRED_SEPAY_PRODUCTION_TABLES
} from "./sepay-production-preflight.js";

test("SePay preflight collector reads only safe operational readiness data", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const snapshot = await collectSePayPreflightDatabaseSnapshot(
      pool,
      "integration-preflight"
    );

    for (const table of REQUIRED_SEPAY_PRODUCTION_TABLES) {
      assert.equal(snapshot.tables[table], true, table + " should exist");
    }

    assert.ok(snapshot.activePaymentProfiles >= 0);
    assert.ok(
      snapshot.outstandingOrganizationsWithoutActivePaymentProfile >= 0
    );
    assert.ok(snapshot.providerReviewRequired >= 0);
    assert.ok(snapshot.invalidSignature24h >= 0);

    assert.equal("accountNo" in snapshot, false);
    assert.equal("providerTransactionId" in snapshot, false);
    assert.equal("paymentReference" in snapshot, false);
    if (snapshot.reconciliation) {
      assert.equal("cursor" in snapshot.reconciliation, false);
      assert.equal("cursorValue" in snapshot.reconciliation, false);
    }
  } finally {
    await pool.end();
  }
});
