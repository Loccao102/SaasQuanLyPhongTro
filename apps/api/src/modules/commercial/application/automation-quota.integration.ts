import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import {
  CommercialPolicyService,
  CommercialWriteRestrictedError
} from "./commercial-policy.service.js";
import {
  AutomationQuotaExceededError,
  AutomationQuotaService
} from "./automation-quota.service.js";

const organizationId = "b1000000-0000-0000-0000-000000000001";

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    "DELETE FROM automation_quota_consumptions WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM automation_quota_reservations WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM automation_quota_periods WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM organization_entitlement_overrides WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM organization_subscriptions WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
}

test("automation quota reservation is durable, idempotent and suspension-aware", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const policy = new CommercialPolicyService();
  const quota = new AutomationQuotaService(database, policy);

  try {
    await cleanup(fixturePool);

    await fixturePool.query(
      `INSERT INTO organizations (
         id, slug, name, organization_type, status
       )
       VALUES (
         $1, 'quota-test-org', 'Quota Test Org', 'INDIVIDUAL', 'ACTIVE'
       )`,
      [organizationId]
    );

    await fixturePool.query(
      `INSERT INTO organization_subscriptions (
         organization_id,
         plan_id,
         plan_version_id,
         status
       )
       SELECT $1, p.id, p.current_version_id, 'ACTIVE'
       FROM saas_plans p
       WHERE p.code = 'STARTER'`,
      [organizationId]
    );

    await fixturePool.query(
      `INSERT INTO organization_entitlement_overrides (
         organization_id,
         entitlement_key,
         value,
         reason
       )
       VALUES (
         $1,
         'automation_actions_monthly',
         '3'::jsonb,
         'Integration quota limit'
       )`,
      [organizationId]
    );

    const firstReservation = await quota.reserve({
      organizationId,
      idempotencyKey: "campaign-001",
      sourceType: "NOTIFICATION_CAMPAIGN",
      sourceId: "campaign-a",
      requestedActions: 2,
      metadata: { channel: "ZALO" }
    });

    const replayedReservation = await quota.reserve({
      organizationId,
      idempotencyKey: "campaign-001",
      sourceType: "NOTIFICATION_CAMPAIGN",
      sourceId: "campaign-a",
      requestedActions: 2,
      metadata: { channel: "ZALO" }
    });

    assert.deepEqual(replayedReservation, firstReservation);
    assert.equal(firstReservation.requestedActions, 2);
    assert.equal(firstReservation.remainingActions, 2);

    await assert.rejects(
      () =>
        quota.reserve({
          organizationId,
          idempotencyKey: "campaign-002",
          sourceType: "NOTIFICATION_CAMPAIGN",
          sourceId: "campaign-b",
          requestedActions: 2
        }),
      AutomationQuotaExceededError
    );

    const firstConsumption = await quota.consume({
      organizationId,
      reservationId: firstReservation.id,
      consumptionKey: "recipient-001",
      quantity: 1
    });
    const replayedConsumption = await quota.consume({
      organizationId,
      reservationId: firstReservation.id,
      consumptionKey: "recipient-001",
      quantity: 1
    });

    assert.deepEqual(replayedConsumption, firstConsumption);
    assert.equal(firstConsumption.reservation.consumedActions, 1);
    assert.equal(firstConsumption.reservation.remainingActions, 1);

    const periodAfterConsume = await fixturePool.query<{
      reserved_actions: number;
      consumed_actions: number;
    }>(
      `SELECT reserved_actions, consumed_actions
       FROM automation_quota_periods
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(periodAfterConsume.rows[0]?.reserved_actions, 1);
    assert.equal(periodAfterConsume.rows[0]?.consumed_actions, 1);

    await fixturePool.query(
      `UPDATE organization_subscriptions
       SET status = 'SUSPENDED',
           version = version + 1,
           updated_at = now()
       WHERE organization_id = $1`,
      [organizationId]
    );

    const replayWhileSuspended = await quota.consume({
      organizationId,
      reservationId: firstReservation.id,
      consumptionKey: "recipient-001",
      quantity: 1
    });
    assert.deepEqual(replayWhileSuspended, firstConsumption);

    await assert.rejects(
      () =>
        quota.consume({
          organizationId,
          reservationId: firstReservation.id,
          consumptionKey: "recipient-002",
          quantity: 1
        }),
      CommercialWriteRestrictedError
    );

    await assert.rejects(
      () =>
        quota.reserve({
          organizationId,
          idempotencyKey: "campaign-003",
          sourceType: "NOTIFICATION_CAMPAIGN",
          sourceId: "campaign-c",
          requestedActions: 1
        }),
      CommercialWriteRestrictedError
    );

    const released = await quota.release({
      organizationId,
      reservationId: firstReservation.id
    });
    const releasedReplay = await quota.release({
      organizationId,
      reservationId: firstReservation.id
    });

    assert.deepEqual(releasedReplay, released);
    assert.equal(released.status, "RELEASED");
    assert.equal(released.consumedActions, 1);
    assert.equal(released.releasedActions, 1);
    assert.equal(released.remainingActions, 0);

    const periodAfterRelease = await fixturePool.query<{
      reserved_actions: number;
      consumed_actions: number;
    }>(
      `SELECT reserved_actions, consumed_actions
       FROM automation_quota_periods
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(periodAfterRelease.rows[0]?.reserved_actions, 0);
    assert.equal(periodAfterRelease.rows[0]?.consumed_actions, 1);
  } finally {
    await database.onModuleDestroy();
    await cleanup(fixturePool);
    await fixturePool.end();
  }
});
