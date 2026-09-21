import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { SubscriptionManagementService } from "../commercial/application/subscription-management.service.js";
import { DatabaseService } from "../database/database.service.js";
import { CmsService } from "./cms.service.js";
import type { PlatformPrincipal } from "./cms.types.js";

const userId = "91000000-0000-0000-0000-000000000001";
const organizationId = "92000000-0000-0000-0000-000000000001";
const planId = "93000000-0000-0000-0000-000000000001";
const planVersionId = "94000000-0000-0000-0000-000000000001";
const testSettingKey = "cms_integration_flag";

const principal: PlatformPrincipal = {
  userId,
  role: "PLATFORM_ADMIN"
};

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    "DELETE FROM platform_command_receipts WHERE actor_user_id = $1",
    [userId]
  );
  await pool.query(
    "DELETE FROM platform_audit_events WHERE actor_user_id = $1 OR organization_id = $2",
    [userId, organizationId]
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
  await pool.query("DELETE FROM system_settings WHERE key = $1", [
    testSettingKey
  ]);

  await pool.query(
    "UPDATE saas_plans SET current_version_id = NULL WHERE id = $1",
    [planId]
  );
  await pool.query("DELETE FROM saas_plan_versions WHERE plan_id = $1", [
    planId
  ]);
  await pool.query("DELETE FROM saas_plans WHERE id = $1", [planId]);

  await pool.query("DELETE FROM platform_operators WHERE user_id = $1", [
    userId
  ]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

test("CMS configuration commands are transactional, idempotent and auditable", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const service = new CmsService(
    database,
    new SubscriptionManagementService()
  );

  try {
    await cleanup(fixturePool);

    await fixturePool.query(
      `INSERT INTO users (id, email, display_name, status)
       VALUES ($1, 'cms-integration@example.invalid', 'CMS Integration', 'ACTIVE')`,
      [userId]
    );
    await fixturePool.query(
      `INSERT INTO platform_operators (user_id, role, status)
       VALUES ($1, 'PLATFORM_ADMIN', 'ACTIVE')`,
      [userId]
    );
    await fixturePool.query(
      `INSERT INTO organizations (
         id, slug, name, organization_type, status
       ) VALUES (
         $1, 'cms-integration-org', 'CMS Integration Org', 'INDIVIDUAL', 'ACTIVE'
       )`,
      [organizationId]
    );
    await fixturePool.query(
      `INSERT INTO system_settings (
         key, group_key, label, description, value, value_type
       ) VALUES (
         $1, 'Test', 'CMS integration flag', 'integration fixture',
         'false'::jsonb, 'BOOLEAN'
       )`,
      [testSettingKey]
    );

    await fixturePool.query(
      `INSERT INTO saas_plans (id, code, name, status)
       VALUES ($1, 'CMS_TEST', 'CMS Test', 'ACTIVE')`,
      [planId]
    );
    await fixturePool.query(
      `INSERT INTO saas_plan_versions (
         id, plan_id, version, monthly_price_vnd, yearly_price_vnd,
         room_limit, staff_limit, automation_quota, reason
       ) VALUES (
         $1, $2, 1, 100000, 1000000, 20, 2, 500, 'Integration fixture'
       )`,
      [planVersionId, planId]
    );
    await fixturePool.query(
      "UPDATE saas_plans SET current_version_id = $2 WHERE id = $1",
      [planId, planVersionId]
    );

    const firstSetting = await service.updateSetting(
      principal,
      testSettingKey,
      {
        value: true,
        expectedVersion: 1,
        reason: "Integration setting change"
      },
      "cms-setting-001"
    );
    const replayedSetting = await service.updateSetting(
      principal,
      testSettingKey,
      {
        value: true,
        expectedVersion: 1,
        reason: "Integration setting change"
      },
      "cms-setting-001"
    );

    assert.deepEqual(replayedSetting, firstSetting);
    assert.equal(
      (firstSetting as { value: unknown }).value,
      true
    );

    const settingAudit = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM platform_audit_events
       WHERE actor_user_id = $1
         AND action = 'SYSTEM_SETTING_UPDATED'
         AND target_key = $2`,
      [userId, testSettingKey]
    );
    assert.equal(settingAudit.rows[0]?.count, 1);

    const firstPlan = await service.updatePlan(
      principal,
      "CMS_TEST",
      {
        monthlyPriceVnd: 123000,
        roomLimit: 42,
        staffLimit: 4,
        automationQuota: 1200,
        expectedVersion: 1,
        reason: "Integration plan change"
      },
      "cms-plan-0001"
    );
    const replayedPlan = await service.updatePlan(
      principal,
      "CMS_TEST",
      {
        monthlyPriceVnd: 123000,
        roomLimit: 42,
        staffLimit: 4,
        automationQuota: 1200,
        expectedVersion: 1,
        reason: "Integration plan change"
      },
      "cms-plan-0001"
    );

    assert.deepEqual(replayedPlan, firstPlan);
    assert.equal((firstPlan as { version: number }).version, 2);

    const planVersions = await fixturePool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM saas_plan_versions WHERE plan_id = $1",
      [planId]
    );
    assert.equal(planVersions.rows[0]?.count, 2);

    const firstProvision = await service.provisionSubscription(
      principal,
      organizationId,
      {
        planCode: "CMS_TEST",
        status: "ACTIVE",
        reason: "Integration subscription provision"
      },
      "cms-subscription-provision-001"
    );
    const replayedProvision = await service.provisionSubscription(
      principal,
      organizationId,
      {
        planCode: "CMS_TEST",
        status: "ACTIVE",
        reason: "Integration subscription provision"
      },
      "cms-subscription-provision-001"
    );

    assert.deepEqual(replayedProvision, firstProvision);
    assert.equal(
      (firstProvision as { status: string }).status,
      "ACTIVE"
    );
    assert.equal(
      (firstProvision as { version: number }).version,
      1
    );

    const currentPlanVersion = await fixturePool.query<{ id: string }>(
      "SELECT current_version_id::text AS id FROM saas_plans WHERE id = $1",
      [planId]
    );
    assert.equal(
      (firstProvision as { planVersionId: string }).planVersionId,
      currentPlanVersion.rows[0]?.id
    );

    const firstTransition = await service.transitionSubscription(
      principal,
      organizationId,
      {
        to: "PAST_DUE",
        expectedVersion: 1,
        reason: "Integration renewal failure"
      },
      "cms-subscription-transition-001"
    );
    const replayedTransition = await service.transitionSubscription(
      principal,
      organizationId,
      {
        to: "PAST_DUE",
        expectedVersion: 1,
        reason: "Integration renewal failure"
      },
      "cms-subscription-transition-001"
    );

    assert.deepEqual(replayedTransition, firstTransition);
    assert.equal(
      (firstTransition as { status: string }).status,
      "PAST_DUE"
    );
    assert.equal(
      (firstTransition as { version: number }).version,
      2
    );

    const firstPlanChange = await service.changeSubscriptionPlan(
      principal,
      organizationId,
      {
        targetPlanCode: "GROWTH",
        expectedVersion: 2,
        reason: "Integration plan switch"
      },
      "cms-subscription-plan-change-001"
    );
    const replayedPlanChange = await service.changeSubscriptionPlan(
      principal,
      organizationId,
      {
        targetPlanCode: "GROWTH",
        expectedVersion: 2,
        reason: "Integration plan switch"
      },
      "cms-subscription-plan-change-001"
    );

    assert.deepEqual(replayedPlanChange, firstPlanChange);
    assert.equal(
      (firstPlanChange as { planCode: string }).planCode,
      "GROWTH"
    );
    assert.equal(
      (firstPlanChange as { status: string }).status,
      "PAST_DUE"
    );
    assert.equal(
      (firstPlanChange as { version: number }).version,
      3
    );

    const subscriptionAudits = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM platform_audit_events
       WHERE organization_id = $1
         AND action IN (
           'SUBSCRIPTION_PROVISIONED',
           'SUBSCRIPTION_STATUS_CHANGED',
           'SUBSCRIPTION_PLAN_CHANGED'
         )`,
      [organizationId]
    );
    assert.equal(subscriptionAudits.rows[0]?.count, 3);

    const firstOverride = await service.setEntitlementOverride(
      principal,
      organizationId,
      "room_limit",
      {
        value: 80,
        expiresAt: "2030-01-01T00:00:00.000Z",
        reason: "Integration entitlement exception"
      },
      "cms-override-001"
    );
    const replayedOverride = await service.setEntitlementOverride(
      principal,
      organizationId,
      "room_limit",
      {
        value: 80,
        expiresAt: "2030-01-01T00:00:00.000Z",
        reason: "Integration entitlement exception"
      },
      "cms-override-001"
    );

    assert.deepEqual(replayedOverride, firstOverride);

    const organizations = await service.listOrganizations(principal);
    const inspected = organizations.find(
      (organization) => organization.id === organizationId
    );
    assert.ok(inspected);
    assert.equal(inspected.roomLimit, 80);
    assert.equal(inspected.roomLimitSource, "OVERRIDE");
    assert.equal(inspected.subscriptionStatus, "PAST_DUE");
    assert.equal(inspected.subscriptionVersion, 3);
    assert.equal(inspected.planCode, "GROWTH");

    await service.revokeEntitlementOverride(
      principal,
      organizationId,
      "room_limit",
      { reason: "Integration override cleanup" },
      "cms-revoke-0001"
    );

    const overrides = await service.listEntitlementOverrides(principal);
    assert.equal(
      overrides.some(
        (override) =>
          override.organizationId === organizationId &&
          override.key === "room_limit"
      ),
      false
    );

    const overrideAudits = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM platform_audit_events
       WHERE organization_id = $1
         AND action IN (
           'ENTITLEMENT_OVERRIDE_SET',
           'ENTITLEMENT_OVERRIDE_REVOKED'
         )`,
      [organizationId]
    );
    assert.equal(overrideAudits.rows[0]?.count, 2);
  } finally {
    await cleanup(fixturePool);
    await database.onModuleDestroy();
    await fixturePool.end();
  }
});
