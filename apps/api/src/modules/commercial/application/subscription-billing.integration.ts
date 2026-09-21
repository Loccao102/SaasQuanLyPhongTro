import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import {
  SubscriptionBillingConflictError,
  SubscriptionBillingService
} from "./subscription-billing.service.js";

const organizationId = "d1000000-0000-0000-0000-000000000001";
const operatorUserId = "d2000000-0000-0000-0000-000000000001";

async function cleanup(pool: Pool): Promise<void> {
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
    "DELETE FROM platform_audit_events WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM organization_subscriptions WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
  await pool.query("DELETE FROM users WHERE id = $1", [operatorUserId]);
}

test("subscription billing supports partial allocations, delinquency and idempotent recovery", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const billing = new SubscriptionBillingService(database);

  try {
    await cleanup(fixturePool);

    await fixturePool.query(
      `INSERT INTO users (id, email, display_name, status)
       VALUES (
         $1,
         'billing-operator@example.invalid',
         'Billing Operator',
         'ACTIVE'
       )`,
      [operatorUserId]
    );

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
    assert.equal(firstProcess.invoice.paidAmountVnd, 0);
    assert.equal(firstProcess.invoice.remainingAmountVnd, 99_000);
    assert.equal(firstProcess.invoice.status, "OPEN");
    assert.equal(firstProcess.invoice.isOverdue, true);
    assert.equal(firstProcess.transition?.from, "ACTIVE");
    assert.equal(firstProcess.transition?.to, "PAST_DUE");

    const invoice = (await billing.listInvoices(organizationId))[0];
    assert.ok(invoice);
    assert.equal(invoice.status, "OPEN");
    assert.equal(invoice.isOverdue, true);

    const partial = await database.withTransaction((client) =>
      billing.recordManualPaymentInTransaction(client, {
        organizationId,
        invoiceId: invoice.id,
        amountVnd: 40_000,
        idempotencyKey: "billing-partial-001",
        recordedByUserId: operatorUserId,
        reason: "Integration partial bank transfer"
      })
    );

    assert.equal(partial.invoice.status, "PARTIALLY_PAID");
    assert.equal(partial.invoice.paidAmountVnd, 40_000);
    assert.equal(partial.invoice.remainingAmountVnd, 59_000);
    assert.equal(partial.invoice.isOverdue, true);
    assert.equal(partial.payment.amountVnd, 40_000);
    assert.equal(partial.payment.allocatedAmountVnd, 40_000);
    assert.equal(partial.payment.unallocatedAmountVnd, 0);
    assert.equal(partial.payment.reconciliationStatus, "ALLOCATED");
    assert.equal(partial.allocation.amountVnd, 40_000);
    assert.equal(partial.subscription.status, "PAST_DUE");
    assert.equal(partial.subscription.version, 2);

    const replayedPartial = await database.withTransaction((client) =>
      billing.recordManualPaymentInTransaction(client, {
        organizationId,
        invoiceId: invoice.id,
        amountVnd: 40_000,
        idempotencyKey: "billing-partial-001",
        recordedByUserId: operatorUserId,
        reason: "Integration partial bank transfer"
      })
    );

    assert.equal(replayedPartial.payment.id, partial.payment.id);
    assert.equal(replayedPartial.allocation.id, partial.allocation.id);

    const partialPaymentCount = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM saas_subscription_payments
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(partialPaymentCount.rows[0]?.count, 1);

    const partialAllocationCount = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM saas_subscription_payment_allocations
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(partialAllocationCount.rows[0]?.count, 1);

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

    const finalSettlement = await database.withTransaction((client) =>
      billing.recordManualPaymentInTransaction(client, {
        organizationId,
        invoiceId: invoice.id,
        amountVnd: 59_000,
        idempotencyKey: "billing-final-001",
        recordedByUserId: operatorUserId,
        reason: "Integration remaining bank transfer"
      })
    );

    assert.equal(finalSettlement.invoice.status, "PAID");
    assert.equal(finalSettlement.invoice.paidAmountVnd, 99_000);
    assert.equal(finalSettlement.invoice.remainingAmountVnd, 0);
    assert.equal(finalSettlement.invoice.isOverdue, false);
    assert.ok(finalSettlement.invoice.paidAt);
    assert.equal(finalSettlement.payment.amountVnd, 59_000);
    assert.equal(finalSettlement.subscription.status, "ACTIVE");
    assert.equal(finalSettlement.subscription.version, 5);
    assert.equal(
      finalSettlement.subscription.currentPeriodStart,
      invoice.periodStart
    );
    assert.equal(
      finalSettlement.subscription.currentPeriodEnd,
      invoice.periodEnd
    );

    await assert.rejects(
      () =>
        database.withTransaction((client) =>
          billing.recordManualPaymentInTransaction(client, {
            organizationId,
            invoiceId: invoice.id,
            amountVnd: 1,
            idempotencyKey: "billing-overpay-001",
            recordedByUserId: operatorUserId,
            reason: "Should be rejected"
          })
        ),
      SubscriptionBillingConflictError
    );

    const paymentCount = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM saas_subscription_payments
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(paymentCount.rows[0]?.count, 2);

    const allocationCount = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM saas_subscription_payment_allocations
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(allocationCount.rows[0]?.count, 2);

    const audit = await fixturePool.query<{
      action: string;
      count: number;
    }>(
      `SELECT action, count(*)::int AS count
       FROM platform_audit_events
       WHERE organization_id = $1
       GROUP BY action`,
      [organizationId]
    );
    const auditCounts = new Map(
      audit.rows.map((row) => [row.action, row.count])
    );

    assert.equal(
      auditCounts.get("SUBSCRIPTION_BILLING_STATUS_CHANGED"),
      3
    );
    assert.equal(
      auditCounts.get("SUBSCRIPTION_PAYMENT_ALLOCATED"),
      2
    );
    assert.equal(
      auditCounts.get("SUBSCRIPTION_PAID_PERIOD_ACTIVATED"),
      1
    );
  } finally {
    await database.onModuleDestroy();
    await cleanup(fixturePool);
    await fixturePool.end();
  }
});
