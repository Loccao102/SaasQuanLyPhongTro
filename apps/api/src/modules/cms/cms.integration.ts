import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { SubscriptionBillingService } from "../commercial/application/subscription-billing.service.js";
import { SubscriptionManagementService } from "../commercial/application/subscription-management.service.js";
import { DatabaseService } from "../database/database.service.js";
import { SaasBillingWebhookInboxService } from "../integrations/saas-billing-webhook-inbox.service.js";
import { NotificationOperationsService } from "../notifications/application/notification-operations.service.js";
import { CmsService } from "./cms.service.js";
import type { PlatformPrincipal } from "./cms.types.js";

const userId = "91000000-0000-0000-0000-000000000001";
const organizationId = "92000000-0000-0000-0000-000000000001";
const planId = "93000000-0000-0000-0000-000000000001";
const planVersionId = "94000000-0000-0000-0000-000000000001";
const testSettingKey = "cms_integration_flag";
const testProvider = "PLAYWRIGHT_ZALO";
const billingWebhookProvider = "CMS_TEST_BANK";

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
    "DELETE FROM saas_billing_webhook_events WHERE provider = $1",
    [billingWebhookProvider]
  );
  await pool.query(
    "DELETE FROM saas_subscription_payment_allocations WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM saas_subscription_payments WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM saas_subscription_invoices WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM organization_subscriptions WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM notification_worker_heartbeats WHERE provider = $1",
    [testProvider]
  );
  await pool.query(
    "DELETE FROM notification_provider_controls WHERE provider = $1",
    [testProvider]
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
  const subscriptionBilling = new SubscriptionBillingService(database);
  const service = new CmsService(
    database,
    new SubscriptionManagementService(),
    subscriptionBilling,
    new NotificationOperationsService(database),
    new SaasBillingWebhookInboxService(database)
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

    const bootstrap = service.getBootstrap(principal);
    assert.equal(bootstrap.role, "PLATFORM_ADMIN");
    assert.ok(
      bootstrap.permissions.includes("platform.billing.read")
    );
    assert.ok(
      bootstrap.permissions.includes("platform.billing.manage")
    );
    assert.ok(
      bootstrap.permissions.includes("platform.jobs.manage")
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

    await fixturePool.query(
      `UPDATE organization_subscriptions
       SET current_period_start = now() - interval '1 month 1 second',
           current_period_end = now() - interval '1 second'
       WHERE organization_id = $1`,
      [organizationId]
    );

    const billingInvoice = await fixturePool.query<{
      id: string;
      amount_vnd: string;
    }>(
      `INSERT INTO saas_subscription_invoices (
         organization_id,
         subscription_id,
         plan_id,
         plan_version_id,
         billing_interval,
         period_start,
         period_end,
         amount_vnd,
         status,
         due_at
       )
       SELECT
         s.organization_id,
         s.id,
         s.plan_id,
         s.plan_version_id,
         s.billing_interval,
         s.current_period_end,
         s.current_period_end + interval '1 month',
         pv.monthly_price_vnd,
         'OPEN',
         s.current_period_end
       FROM organization_subscriptions s
       JOIN saas_plan_versions pv
         ON pv.id = s.plan_version_id
        AND pv.plan_id = s.plan_id
       WHERE s.organization_id = $1
       RETURNING id::text, amount_vnd::text`,
      [organizationId]
    );
    const billingInvoiceId = billingInvoice.rows[0]?.id;
    assert.ok(billingInvoiceId);
    assert.equal(Number(billingInvoice.rows[0]?.amount_vnd), 249_000);

    const organizationsBeforePayment =
      await service.listOrganizations(principal);
    const billingBeforePayment = organizationsBeforePayment.find(
      (organization) => organization.id === organizationId
    );
    assert.ok(billingBeforePayment);
    assert.equal(billingBeforePayment.billingInterval, "MONTHLY");
    assert.equal(billingBeforePayment.latestInvoice?.status, "OPEN");
    assert.equal(billingBeforePayment.latestInvoice?.amountVnd, 249_000);
    assert.equal(billingBeforePayment.latestInvoice?.paidAmountVnd, 0);
    assert.equal(
      billingBeforePayment.latestInvoice?.remainingAmountVnd,
      249_000
    );
    assert.equal(billingBeforePayment.latestInvoice?.isOverdue, true);

    const firstManualPayment = await service.recordSubscriptionPayment(
      principal,
      organizationId,
      {
        invoiceId: billingInvoiceId,
        amountVnd: 249_000,
        reason: "Integration verified bank transfer"
      },
      "cms-manual-payment-001"
    );
    const replayedManualPayment = await service.recordSubscriptionPayment(
      principal,
      organizationId,
      {
        invoiceId: billingInvoiceId,
        amountVnd: 249_000,
        reason: "Integration verified bank transfer"
      },
      "cms-manual-payment-001"
    );

    assert.deepEqual(replayedManualPayment, firstManualPayment);
    assert.equal(
      (firstManualPayment as {
        invoice: { status: string };
        payment: { status: string };
        subscription: { status: string; version: number };
      }).invoice.status,
      "PAID"
    );
    assert.equal(
      (firstManualPayment as {
        invoice: { status: string };
        payment: { status: string };
        subscription: { status: string; version: number };
      }).payment.status,
      "SUCCEEDED"
    );
    assert.equal(
      (firstManualPayment as {
        invoice: { status: string };
        payment: { status: string };
        subscription: { status: string; version: number };
      }).subscription.status,
      "ACTIVE"
    );
    assert.equal(
      (firstManualPayment as {
        invoice: { status: string };
        payment: { status: string };
        subscription: { status: string; version: number };
      }).subscription.version,
      4
    );

    const manualPaymentCount = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM saas_subscription_payments
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(manualPaymentCount.rows[0]?.count, 1);

    const manualAllocationCount = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM saas_subscription_payment_allocations
       WHERE organization_id = $1
         AND invoice_id = $2`,
      [organizationId, billingInvoiceId]
    );
    assert.equal(manualAllocationCount.rows[0]?.count, 1);

    const manualPaymentAudit = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM platform_audit_events
       WHERE actor_user_id = $1
         AND organization_id = $2
         AND action = 'SUBSCRIPTION_PAYMENT_RECORDED_MANUALLY'
         AND target_key = $3`,
      [userId, organizationId, billingInvoiceId]
    );
    assert.equal(manualPaymentAudit.rows[0]?.count, 1);

    const organizationsAfterPayment =
      await service.listOrganizations(principal);
    const billingAfterPayment = organizationsAfterPayment.find(
      (organization) => organization.id === organizationId
    );
    assert.ok(billingAfterPayment);
    assert.equal(billingAfterPayment.subscriptionStatus, "ACTIVE");
    assert.equal(billingAfterPayment.subscriptionVersion, 4);
    assert.equal(billingAfterPayment.latestInvoice?.status, "PAID");
    assert.equal(
      billingAfterPayment.latestInvoice?.paidAmountVnd,
      249_000
    );
    assert.equal(
      billingAfterPayment.latestInvoice?.remainingAmountVnd,
      0
    );
    assert.equal(billingAfterPayment.latestInvoice?.isOverdue, false);
    assert.ok(billingAfterPayment.latestInvoice?.paidAt);

    const reconciliationInvoice = await fixturePool.query<{
      id: string;
      payment_reference: string;
      amount_vnd: string;
    }>(
      `INSERT INTO saas_subscription_invoices (
         organization_id,
         subscription_id,
         plan_id,
         plan_version_id,
         billing_interval,
         period_start,
         period_end,
         amount_vnd,
         status,
         due_at
       )
       SELECT
         s.organization_id,
         s.id,
         s.plan_id,
         s.plan_version_id,
         s.billing_interval,
         s.current_period_end,
         s.current_period_end + interval '1 month',
         pv.monthly_price_vnd,
         'OPEN',
         s.current_period_end
       FROM organization_subscriptions s
       JOIN saas_plan_versions pv
         ON pv.id = s.plan_version_id
        AND pv.plan_id = s.plan_id
       WHERE s.organization_id = $1
       RETURNING id::text, payment_reference, amount_vnd::text`,
      [organizationId]
    );
    const reconciliationInvoiceId = reconciliationInvoice.rows[0]?.id;
    const reconciliationReference =
      reconciliationInvoice.rows[0]?.payment_reference;
    assert.ok(reconciliationInvoiceId);
    assert.ok(reconciliationReference);
    assert.equal(
      Number(reconciliationInvoice.rows[0]?.amount_vnd),
      249_000
    );

    const providerOccurredAt = new Date().toISOString();
    const reviewPayment = await subscriptionBilling.ingestProviderPayment({
      provider: "CMS_TEST_BANK",
      providerTransactionId: "cms-review-payment-001",
      amountVnd: 300_000,
      occurredAt: providerOccurredAt,
      paymentReference: reconciliationReference
    });

    assert.equal(
      reviewPayment.payment.reconciliationStatus,
      "REVIEW_REQUIRED"
    );
    assert.equal(reviewPayment.payment.organizationId, organizationId);
    assert.equal(reviewPayment.allocation, null);
    assert.equal(reviewPayment.invoice?.id, reconciliationInvoiceId);

    const webhookFixture = await fixturePool.query<{ id: string }>(
      `INSERT INTO saas_billing_webhook_events (
         provider,
         provider_event_id,
         signature_status,
         processing_status,
         raw_body,
         raw_body_sha256,
         processing_attempts,
         last_error_code,
         last_error_message
       )
       VALUES (
         $1,
         'cms-webhook-review-001',
         'VERIFIED',
         'REVIEW_REQUIRED',
         '{"fixture":true}',
         repeat('a', 64),
         1,
         'CMS_TEST_REVIEW',
         'Integration fixture requires review'
       )
       RETURNING id::text`,
      [billingWebhookProvider]
    );
    const webhookFixtureId = webhookFixture.rows[0]?.id;
    assert.ok(webhookFixtureId);

    const reconciliationBefore =
      await service.getBillingReconciliation(principal);
    const queuedPayment = reconciliationBefore.reviewPayments.find(
      (item) => item.payment.id === reviewPayment.payment.id
    );
    assert.ok(queuedPayment);
    assert.equal(queuedPayment.paymentReference, reconciliationReference);
    assert.equal(queuedPayment.payment.unallocatedAmountVnd, 300_000);
    assert.ok(
      reconciliationBefore.invoices.some(
        (invoice) => invoice.id === reconciliationInvoiceId
      )
    );
    assert.equal(
      reconciliationBefore.webhookInbox.summary.reviewRequired,
      1
    );
    const webhookReviewEvent =
      reconciliationBefore.webhookInbox.events.find(
        (event) =>
          event.provider === billingWebhookProvider &&
          event.providerEventId === "cms-webhook-review-001"
      );
    assert.ok(webhookReviewEvent);
    assert.equal(webhookReviewEvent.processingStatus, "REVIEW_REQUIRED");
    assert.equal(webhookReviewEvent.processingAttempts, 1);
    assert.equal(webhookReviewEvent.paymentId, null);
    const firstWebhookRequeue = await service.requeueBillingWebhook(
      principal,
      webhookFixtureId,
      {
        reason: "Integration provider parser fixed"
      },
      "cms-webhook-requeue-001"
    );
    const replayedWebhookRequeue =
      await service.requeueBillingWebhook(
        principal,
        webhookFixtureId,
        {
          reason: "Integration provider parser fixed"
        },
        "cms-webhook-requeue-001"
      );

    assert.deepEqual(replayedWebhookRequeue, firstWebhookRequeue);
    assert.equal(firstWebhookRequeue.processingStatus, "RECEIVED");
    assert.equal(firstWebhookRequeue.processingAttempts, 1);
    assert.equal(firstWebhookRequeue.lastErrorCode, null);
    assert.equal(firstWebhookRequeue.lastErrorMessage, null);

    const webhookRequeueAudit = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM platform_audit_events
       WHERE actor_user_id = $1
         AND action = 'BILLING_WEBHOOK_REQUEUED'
         AND target_key = $2`,
      [userId, webhookFixtureId]
    );
    assert.equal(webhookRequeueAudit.rows[0]?.count, 1);


    const firstReconciliation = await service.allocateProviderPayment(
      principal,
      reviewPayment.payment.id,
      {
        invoiceId: reconciliationInvoiceId,
        amountVnd: 100_000,
        reason: "Integration verified provider allocation"
      },
      "cms-provider-reconcile-001"
    );
    const replayedReconciliation = await service.allocateProviderPayment(
      principal,
      reviewPayment.payment.id,
      {
        invoiceId: reconciliationInvoiceId,
        amountVnd: 100_000,
        reason: "Integration verified provider allocation"
      },
      "cms-provider-reconcile-001"
    );

    assert.deepEqual(replayedReconciliation, firstReconciliation);
    assert.equal(firstReconciliation.invoice.status, "PARTIALLY_PAID");
    assert.equal(firstReconciliation.invoice.paidAmountVnd, 100_000);
    assert.equal(firstReconciliation.invoice.remainingAmountVnd, 149_000);
    assert.equal(
      firstReconciliation.payment.reconciliationStatus,
      "REVIEW_REQUIRED"
    );
    assert.equal(
      firstReconciliation.payment.unallocatedAmountVnd,
      200_000
    );
    assert.equal(firstReconciliation.allocation.amountVnd, 100_000);

    const reconciliationAllocationCount =
      await fixturePool.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM saas_subscription_payment_allocations
         WHERE payment_id = $1
           AND invoice_id = $2`,
        [reviewPayment.payment.id, reconciliationInvoiceId]
      );
    assert.equal(reconciliationAllocationCount.rows[0]?.count, 1);

    const reconciliationOperatorAudit =
      await fixturePool.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM platform_audit_events
         WHERE actor_user_id = $1
           AND action =
             'SUBSCRIPTION_PROVIDER_PAYMENT_RECONCILED_MANUALLY'
           AND target_key = $2`,
        [userId, reviewPayment.payment.id]
      );
    assert.equal(reconciliationOperatorAudit.rows[0]?.count, 1);

    const reconciliationFinancialAudit =
      await fixturePool.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM platform_audit_events
         WHERE organization_id = $1
           AND action =
             'SUBSCRIPTION_PROVIDER_PAYMENT_RECONCILED'
           AND target_key = $2`,
        [organizationId, reviewPayment.payment.id]
      );
    assert.equal(reconciliationFinancialAudit.rows[0]?.count, 1);

    const firstProviderPause =
      await service.updateNotificationProviderControl(
        principal,
        testProvider,
        {
          status: "PAUSED",
          reason: "Integration provider maintenance"
        },
        "cms-provider-control-001"
      );
    const replayedProviderPause =
      await service.updateNotificationProviderControl(
        principal,
        testProvider,
        {
          status: "PAUSED",
          reason: "Integration provider maintenance"
        },
        "cms-provider-control-001"
      );

    assert.deepEqual(replayedProviderPause, firstProviderPause);
    assert.equal(
      (firstProviderPause as { status: string }).status,
      "PAUSED"
    );

    const providerControlAudit = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM platform_audit_events
       WHERE actor_user_id = $1
         AND action = 'NOTIFICATION_PROVIDER_CONTROL_UPDATED'
         AND target_key = $2`,
      [userId, testProvider]
    );
    assert.equal(providerControlAudit.rows[0]?.count, 1);

    await service.updateNotificationProviderControl(
      principal,
      testProvider,
      {
        status: "ACTIVE",
        reason: "Integration provider maintenance complete"
      },
      "cms-provider-control-002"
    );

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
    assert.equal(inspected.subscriptionStatus, "ACTIVE");
    assert.equal(inspected.subscriptionVersion, 4);
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
