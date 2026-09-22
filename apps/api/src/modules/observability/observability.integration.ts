import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseService } from "../database/database.service.js";
import { ObservabilityService } from "./observability.service.js";

const workerId = "integration-observability-billing-worker";

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
  } finally {
    await database.query(
      "DELETE FROM system_worker_heartbeats WHERE worker_id = $1",
      [workerId]
    );
    await database.onModuleDestroy();
  }
});
