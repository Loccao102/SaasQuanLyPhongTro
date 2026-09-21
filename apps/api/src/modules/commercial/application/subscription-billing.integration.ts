import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import {
  SubscriptionBillingConflictError,
  SubscriptionBillingService
} from "./subscription-billing.service.js";

const organizationId = "d1000000-0000-0000-0000-000000000001";

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    "DELETE FROM saas_subscription_payments WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM saas_subscription_invoices WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM platform_audit_events WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM organization_subscriptions WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
}

test("subscription billing invoice, delinquency and settlement flow is durable and idempotent", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const billing = new SubscriptionBillingService(database);

  try {
    await cleanup(fixturePool);

    await fixturePool.query(
      `INSERT INTO organizations (
         id, slug, name, organization_type, status
       )
       VALUES (
         $1,
         'billing-integration-org',
         'Billing Integration Org',
         'INDIVIDUAL',
         'ACTIVE'
       )`,
      [organizationId]
    );

    await fixturePool.query(
      `INSERT INTO organization_subscriptions (
         organization_id,
         plan_id,
         plan_version_id,
         status,
         billing_interval,
         current_period_start,
         current_period_end
       )
       SELECT
         $1,
         p.id,
         p.current_version_id,
         'ACTIVE',
         'MONTHLY',
         now() - interval '1 month 2 days',
         now() - interval '2 days'
       FROM saas_plans p
       WHERE p.code = 'STARTER'`,
      [organizationId]
    );

    const firstProcess = await billing.processOrganizationBilling(
      organizationId
    );
    assert.ok(firstProcess.invoice);
    assert.equal(firstProcess.invoice.amountVnd, 99_000);
    assert.equal(firstProcess.invoice.billingInterval, "MONTHLY");
    assert.equal(firstProcess.invoice.status, "OPEN");
    assert.equal(firstProcess.transition?.from, "ACTIVE");
    assert.equal(firstProcess.transition?.to, "PAST_DUE");

    const overdueInvoice = await billing.listInvoices(organizationId);
    assert.equal(overdueInvoice.length, 1);
    assert.equal(overdueInvoice[0]?.status, "OVERDUE");

    const afterPastDue = await fixturePool.query<{
      status: string;
      past_due_at: Date | null;
      version: number;
    }>(
      `SELECT status, past_due_at, version
       FROM organization_subscriptions
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(afterPastDue.rows[0]?.status, "PAST_DUE");
    assert.ok(afterPastDue.rows[0]?.past_due_at);
    assert.equal(afterPastDue.rows[0]?.version, 2);

    await fixturePool.query(
      `UPDATE organization_subscriptions
       SET past_due_at = now() - interval '2 days'
       WHERE organization_id = $1`,
      [organizationId]
    );

    const graceProcess = await billing.processOrganizationBilling(
      organizationId
    );
    assert.equal(graceProcess.transition?.from, "PAST_DUE");
    assert.equal(graceProcess.transition?.to, "GRACE_PERIOD");

    const graceState = await fixturePool.query<{
      status: string;
      grace_ends_at: Date | null;
      version: number;
    }>(
      `SELECT status, grace_ends_at, version
       FROM organization_subscriptions
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(graceState.rows[0]?.status, "GRACE_PERIOD");
    assert.ok(graceState.rows[0]?.grace_ends_at);
    assert.equal(graceState.rows[0]?.version, 3);

    await fixturePool.query(
      `UPDATE organization_subscriptions
       SET grace_ends_at = now() - interval '1 minute'
       WHERE organization_id = $1`,
      [organizationId]
    );

    const suspendProcess = await billing.processOrganizationBilling(
      organizationId
    );
    assert.equal(suspendProcess.transition?.from, "GRACE_PERIOD");
    assert.equal(suspendProcess.transition?.to, "SUSPENDED");

    const suspended = await fixturePool.query<{
      status: string;
      version: number;
    }>(
      `SELECT status, version
       FROM organization_subscriptions
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(suspended.rows[0]?.status, "SUSPENDED");
    assert.equal(suspended.rows[0]?.version, 4);

    const invoice = (await billing.listInvoices(organizationId))[0];
    assert.ok(invoice);

    const firstSettlement = await billing.recordSuccessfulPayment({
      organizationId,
      invoiceId: invoice.id,
      amountVnd: invoice.amountVnd,
      source: "MANUAL",
      idempotencyKey: "billing-payment-001",
      metadata: { note: "Integration settlement" }
    });

    assert.equal(firstSettlement.invoice.status, "PAID");
    assert.ok(firstSettlement.invoice.paidAt);
    assert.equal(firstSettlement.payment.status, "SUCCEEDED");
    assert.equal(firstSettlement.payment.amountVnd, 99_000);
    assert.equal(firstSettlement.subscription.status, "ACTIVE");
    assert.equal(firstSettlement.subscription.version, 5);
    assert.equal(
      firstSettlement.subscription.currentPeriodStart,
      invoice.periodStart
    );
    assert.equal(
      firstSettlement.subscription.currentPeriodEnd,
      invoice.periodEnd
    );

    const replayedSettlement = await billing.recordSuccessfulPayment({
      organizationId,
      invoiceId: invoice.id,
      amountVnd: invoice.amountVnd,
      source: "MANUAL",
      idempotencyKey: "billing-payment-001",
      metadata: { note: "Ignored on idempotent replay" }
    });

    assert.equal(
      replayedSettlement.payment.id,
      firstSettlement.payment.id
    );
    assert.equal(
      replayedSettlement.subscription.version,
      firstSettlement.subscription.version
    );

    await assert.rejects(
      () =>
        billing.recordSuccessfulPayment({
          organizationId,
          invoiceId: invoice.id,
          amountVnd: invoice.amountVnd,
          source: "MANUAL",
          idempotencyKey: "billing-payment-002"
        }),
      SubscriptionBillingConflictError
    );

    const paymentCount = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM saas_subscription_payments
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(paymentCount.rows[0]?.count, 1);

    const audit = await fixturePool.query<{
      action: string;
    }>(
      `SELECT action
       FROM platform_audit_events
       WHERE organization_id = $1
       ORDER BY occurred_at, id`,
      [organizationId]
    );

    assert.deepEqual(
      audit.rows.map((row) => row.action),
      [
        "SUBSCRIPTION_BILLING_STATUS_CHANGED",
        "SUBSCRIPTION_BILLING_STATUS_CHANGED",
        "SUBSCRIPTION_BILLING_STATUS_CHANGED",
        "SUBSCRIPTION_PAYMENT_SETTLED"
      ]
    );
  } finally {
    await database.onModuleDestroy();
    await cleanup(fixturePool);
    await fixturePool.end();
  }
});
