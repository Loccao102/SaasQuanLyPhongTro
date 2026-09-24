import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseService } from "../database/database.service.js";
import { ObservabilityService } from "./observability.service.js";

const workerId = "integration-observability-billing-worker";
const reconciliationProvider = "SEPAY_OBSERVABILITY_TEST";
const reconciliationScope = "integration";

test("operational observability persists worker heartbeat and returns safe snapshot", async () => {
  assert.ok(
    process.env.DATABASE_URL,
    "DATABASE_URL must be set for integration test."
  );

  const database = new DatabaseService();
  const observability = new ObservabilityService(database);

  try {
    await database.query(
      "DELETE FROM system_worker_heartbeats WHERE worker_id = $1",
      [workerId]
    );

    await database.query(
      `DELETE FROM renter_payment_reconciliation_cursors
       WHERE provider = $1 AND scope_key = $2`,
      [reconciliationProvider, reconciliationScope]
    );
    await database.query(
      `INSERT INTO renter_payment_reconciliation_cursors (
         provider,
         scope_key,
         cursor_value,
         version,
         last_success_at
       ) VALUES ($1, $2, $3, 2, now() - interval '60 seconds')`,
      [
        reconciliationProvider,
        reconciliationScope,
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
      ]
    );

    await observability.reportWorkerHeartbeat({
      workerId,
      role: "BILLING",
      status: "STARTING",
      staleAfterSeconds: 180,
      metadata: { fixture: true }
    });

    await observability.reportWorkerHeartbeat({
      workerId,
      role: "BILLING",
      status: "HEALTHY",
      staleAfterSeconds: 180,
      metadata: {
        durationMs: 15,
        processed: 2,
        failed: 0
      }
    });

    observability.observeHttpRequest(200, 20);
    observability.observeHttpRequest(503, 600);

    const snapshot = await observability.getOperationalSnapshot();
    const worker = snapshot.workers.find(
      (item) => item.workerId === workerId
    );

    assert.ok(worker);
    assert.equal(worker.role, "BILLING");
    assert.equal(worker.status, "HEALTHY");
    assert.equal(worker.stale, false);
    assert.equal(worker.lastErrorCode, null);
    assert.equal(snapshot.api.requestCount, 2);
    assert.equal(snapshot.api.errorCount, 1);
    assert.ok(snapshot.database.pool.max >= 1);
    assert.equal("metadata" in worker, false);

    const reconciliation = snapshot.renterPaymentReconciliation.streams.find(
      (stream) =>
        stream.provider === reconciliationProvider &&
        stream.scopeKey === reconciliationScope
    );
    assert.ok(reconciliation);
    assert.equal(reconciliation.initialized, true);
    assert.ok(reconciliation.lastSuccessAgeSeconds >= 0);
    assert.equal(typeof snapshot.renterPaymentWebhooks.received, "number");
  } finally {
    await database.query(
      "DELETE FROM system_worker_heartbeats WHERE worker_id = $1",
      [workerId]
    );
    await database.query(
      `DELETE FROM renter_payment_reconciliation_cursors
       WHERE provider = $1 AND scope_key = $2`,
      [reconciliationProvider, reconciliationScope]
    );
    await database.onModuleDestroy();
  }
});
