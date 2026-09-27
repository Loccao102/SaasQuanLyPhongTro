import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { SubscriptionBillingService } from "../commercial/application/subscription-billing.service.js";
import { SubscriptionManagementService } from "../commercial/application/subscription-management.service.js";
import { DatabaseService } from "../database/database.service.js";
import { SaasBillingWebhookInboxService } from "../integrations/saas-billing-webhook-inbox.service.js";
import { NotificationOperationsService } from "../notifications/application/notification-operations.service.js";
import { CacheService } from "../cache/cache.service.js";
import { CmsService } from "./cms.service.js";
import { CmsOrganizationDirectoryService } from "./cms-organization-directory.service.js";
import type { PlatformPrincipal } from "./cms.types.js";

const userId = "97000000-0000-0000-0000-000000000001";
const orgId1 = "98000000-0000-0000-0000-000000000001";
const orgId2 = "98000000-0000-0000-0000-000000000002";
const planId = "99000000-0000-0000-0000-000000000001";
const planVersionId = "99100000-0000-0000-0000-000000000001";
const testSettingKey = "cms_performance_test_key";

const principal: PlatformPrincipal = {
  userId,
  role: "PLATFORM_ADMIN"
};

async function cleanup(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM platform_command_receipts WHERE actor_user_id = $1", [userId]);
  await pool.query("DELETE FROM platform_audit_events WHERE actor_user_id = $1 OR organization_id IN ($2, $3)", [userId, orgId1, orgId2]);
  await pool.query("DELETE FROM organization_entitlement_overrides WHERE organization_id IN ($1, $2)", [orgId1, orgId2]);
  await pool.query("DELETE FROM organization_subscriptions WHERE organization_id IN ($1, $2)", [orgId1, orgId2]);
  await pool.query("DELETE FROM organization_memberships WHERE organization_id IN ($1, $2)", [orgId1, orgId2]);
  await pool.query("DELETE FROM organizations WHERE id IN ($1, $2)", [orgId1, orgId2]);
  await pool.query("DELETE FROM system_settings WHERE key = $1", [testSettingKey]);
  await pool.query("UPDATE saas_plans SET current_version_id = NULL WHERE id = $1", [planId]);
  await pool.query("DELETE FROM saas_plan_versions WHERE plan_id = $1", [planId]);
  await pool.query("DELETE FROM saas_plans WHERE id = $1", [planId]);
  await pool.query("DELETE FROM platform_operators WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

test("CMS performance metrics, Redis caching, and organization search filtering", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const cache = new CacheService();
  await cache.onModuleInit();

  const subscriptionManagement = new SubscriptionManagementService();
  const subscriptionBilling = new SubscriptionBillingService(database);
  const notificationOperations = new NotificationOperationsService(database);
  const billingWebhookInbox = new SaasBillingWebhookInboxService(database);

  const cmsService = new CmsService(
    database,
    subscriptionManagement,
    subscriptionBilling,
    notificationOperations,
    billingWebhookInbox,
    undefined,
    cache
  );

  const directoryService = new CmsOrganizationDirectoryService(database);

  await cleanup(fixturePool);
  await cache.del("cms:system_settings:list");
  await cache.del("cms:commercial_plans:list");
  await cache.del("cms:dashboard:overview");

  try {
    // Setup test operator
    await fixturePool.query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, 'perf-test@example.invalid', 'Performance Tester')`,
      [userId]
    );
    await fixturePool.query(
      `INSERT INTO platform_operators (user_id, role, status)
       VALUES ($1, 'PLATFORM_ADMIN', 'ACTIVE')`,
      [userId]
    );

    // Setup 2 test organizations
    await fixturePool.query(
      `INSERT INTO organizations (id, slug, name, organization_type, status)
       VALUES
         ($1, 'habi-premier-alpha', 'Habi Premier Alpha', 'INDIVIDUAL', 'ACTIVE'),
         ($2, 'beta-rental-group', 'Beta Rental Group', 'INDIVIDUAL', 'SUSPENDED')`,
      [orgId1, orgId2]
    );

    // Setup test setting
    await fixturePool.query(
      `INSERT INTO system_settings (key, group_key, label, description, value, value_type, version, updated_at)
       VALUES ($1, 'test', 'Performance Setting', 'Setting for cache tests', '100'::jsonb, 'INTEGER', 1, now())`,
      [testSettingKey]
    );

    // Setup test plan
    await fixturePool.query(
      `INSERT INTO saas_plans (id, code, name, status, created_at, updated_at)
       VALUES ($1, 'PERF_PLAN', 'Performance Pro', 'ACTIVE', now(), now())`,
      [planId]
    );
    await fixturePool.query(
      `INSERT INTO saas_plan_versions (
         id, plan_id, version, monthly_price_vnd, yearly_price_vnd,
         room_limit, staff_limit, automation_quota, features, effective_from, reason
       )
       VALUES ($1, $2, 1, 500000, 5000000, 50, 10, 5000, '{}'::jsonb, now(), 'Initial perf version')`,
      [planVersionId, planId]
    );
    await fixturePool.query(
      `UPDATE saas_plans SET current_version_id = $1 WHERE id = $2`,
      [planVersionId, planId]
    );

    // 1. Verify getSystemPerformance
    const perf = await cmsService.getSystemPerformance(principal);
    assert.ok(perf.database.pool.max > 0, "DB pool max should be > 0");
    assert.ok(perf.process.memoryUsageBytes.rss > 0, "Memory RSS should be > 0");
    assert.ok(perf.process.uptimeSeconds >= 0, "Uptime should be non-negative");
    assert.ok(typeof perf.cache.connected === "boolean");

    // 2. Verify settings caching & invalidation
    const settingsBefore = await cmsService.listSettings(principal);
    assert.ok(settingsBefore.length > 0);
    const beforeSetting = settingsBefore.find((s) => s.key === testSettingKey);
    assert.ok(beforeSetting);
    assert.equal(beforeSetting.value, 100);

    // Update setting with idempotency key
    const updatedSetting = (await cmsService.updateSetting(
      principal,
      testSettingKey,
      { value: 250, expectedVersion: 1, reason: "Cache test update" },
      "idemp-setting-perf-001"
    )) as { value: unknown; version: number };
    assert.equal(updatedSetting.value, 250);
    assert.equal(updatedSetting.version, 2);

    // Verify fresh read reflects updated value
    const settingsAfter = await cmsService.listSettings(principal);
    const afterSetting = settingsAfter.find((s) => s.key === testSettingKey);
    assert.ok(afterSetting);
    assert.equal(afterSetting.value, 250);
    assert.equal(afterSetting.version, 2);

    // 3. Verify plans caching & invalidation
    const plansBefore = await cmsService.listPlans(principal);
    const beforePlan = plansBefore.find((p) => p.code === "PERF_PLAN");
    assert.ok(beforePlan);
    assert.equal(beforePlan.monthlyPriceVnd, 500000);

    const updatedPlan = (await cmsService.updatePlan(
      principal,
      "PERF_PLAN",
      {
        monthlyPriceVnd: 750000,
        roomLimit: 75,
        staffLimit: 15,
        automationQuota: 7500,
        expectedVersion: 1,
        reason: "Performance plan upgrade"
      },
      "idemp-plan-perf-001"
    )) as { monthlyPriceVnd: number; version: number };
    assert.equal(updatedPlan.monthlyPriceVnd, 750000);
    assert.equal(updatedPlan.version, 2);

    // 4. Verify organization directory search and filtering
    const searchAlpha = await directoryService.search(principal, {
      query: "Premier Alpha"
    });
    assert.equal(searchAlpha.items.length, 1);
    assert.equal(searchAlpha.items[0]?.name, "Habi Premier Alpha");

    const searchActive = await directoryService.search(principal, {
      organizationStatus: "ACTIVE"
    });
    assert.ok(searchActive.items.some((o) => o.id === orgId1));
    assert.ok(!searchActive.items.some((o) => o.id === orgId2));

    const searchSuspended = await directoryService.search(principal, {
      organizationStatus: "SUSPENDED"
    });
    assert.ok(searchSuspended.items.some((o) => o.id === orgId2));
    assert.ok(!searchSuspended.items.some((o) => o.id === orgId1));
  } finally {
    await cache.del("cms:system_settings:list");
    await cache.del("cms:commercial_plans:list");
    await cache.del("cms:dashboard:overview");
    await cache.onModuleDestroy();
    await database.onModuleDestroy();
    await cleanup(fixturePool);
    await fixturePool.end();
  }
});
