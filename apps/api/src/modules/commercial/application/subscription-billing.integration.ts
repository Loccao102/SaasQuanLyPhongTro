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
const batchOrganizationId = "d1000000-0000-0000-0000-000000000002";
const cancellationOrganizationId =
  "d1000000-0000-0000-0000-000000000003";
const fundedCancellationOrganizationId =
  "d1000000-0000-0000-0000-000000000004";

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

async function cleanupBatch(pool: Pool): Promise<void> {
  await pool.query(
    "DELETE FROM saas_subscription_payment_allocations WHERE organization_id = $1",
    [batchOrganizationId]
  );
  await pool.query(
    "DELETE FROM saas_subscription_payments WHERE organization_id = $1",
    [batchOrganizationId]
  );
  await pool.query(
    "DELETE FROM saas_subscription_invoices WHERE organization_id = $1",
    [batchOrganizationId]
  );
  await pool.query(
    "DELETE FROM platform_audit_events WHERE organization_id = $1",
    [batchOrganizationId]
  );
  await pool.query(
    "DELETE FROM organization_subscriptions WHERE organization_id = $1",
    [batchOrganizationId]
  );
  await pool.query(
    "DELETE FROM organizations WHERE id = $1",
    [batchOrganizationId]
  );
}

async function cleanupCancellation(pool: Pool): Promise<void> {
  await pool.query(
    "DELETE FROM saas_subscription_payment_allocations WHERE organization_id = $1",
    [cancellationOrganizationId]
  );
  await pool.query(
    "DELETE FROM saas_subscription_payments WHERE organization_id = $1",
    [cancellationOrganizationId]
  );
  await pool.query(
    "DELETE FROM saas_subscription_invoices WHERE organization_id = $1",
    [cancellationOrganizationId]
  );
  await pool.query(
    "DELETE FROM platform_audit_events WHERE organization_id = $1",
    [cancellationOrganizationId]
  );
  await pool.query(
    "DELETE FROM organization_subscriptions WHERE organization_id = $1",
    [cancellationOrganizationId]
  );
  await pool.query(
    "DELETE FROM organizations WHERE id = $1",
    [cancellationOrganizationId]
  );
}

async function cleanupFundedCancellation(
  pool: Pool
): Promise<void> {
  await pool.query(
    "DELETE FROM saas_subscription_payment_allocations WHERE organization_id = $1",
    [fundedCancellationOrganizationId]
  );
  await pool.query(
    "DELETE FROM saas_subscription_payments WHERE organization_id = $1",
    [fundedCancellationOrganizationId]
  );
  await pool.query(
    "DELETE FROM saas_subscription_invoices WHERE organization_id = $1",
    [fundedCancellationOrganizationId]
  );
  await pool.query(
    "DELETE FROM platform_audit_events WHERE organization_id = $1",
    [fundedCancellationOrganizationId]
  );
  await pool.query(
    "DELETE FROM organization_subscriptions WHERE organization_id = $1",
    [fundedCancellationOrganizationId]
  );
  await pool.query(
    "DELETE FROM organizations WHERE id = $1",
    [fundedCancellationOrganizationId]
  );
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


test("bounded billing sweep creates one renewal invoice and is repeat-safe", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const billing = new SubscriptionBillingService(database);

  try {
    await cleanupBatch(fixturePool);

    await fixturePool.query(
      `INSERT INTO organizations (
         id, slug, name, organization_type, status
       )
       VALUES (
         $1,
         'billing-batch-org',
         'Billing Batch Org',
         'INDIVIDUAL',
         'ACTIVE'
       )`,
      [batchOrganizationId]
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
         now() - interval '27 days',
         now() + interval '3 days'
       FROM saas_plans p
       WHERE p.code = 'STARTER'`,
      [batchOrganizationId]
    );

    const firstSweep = await billing.processDueBatch(50);
    const firstResult = firstSweep.results.find(
      (item) => item.organizationId === batchOrganizationId
    );
    assert.ok(firstResult);
    assert.equal(firstResult.ok, true);
    assert.ok(firstResult.invoiceId);
    assert.equal(firstResult.transition, null);
    assert.equal(firstResult.activatedPaidPeriod, false);

    const invoicesAfterFirst = await billing.listInvoices(
      batchOrganizationId
    );
    assert.equal(invoicesAfterFirst.length, 1);
    assert.equal(invoicesAfterFirst[0]?.status, "OPEN");
    assert.equal(invoicesAfterFirst[0]?.isOverdue, false);

    const secondSweep = await billing.processDueBatch(50);
    const secondResult = secondSweep.results.find(
      (item) => item.organizationId === batchOrganizationId
    );
    assert.ok(secondResult);
    assert.equal(secondResult.invoiceId, firstResult.invoiceId);

    const invoiceCount = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM saas_subscription_invoices
       WHERE organization_id = $1`,
      [batchOrganizationId]
    );
    assert.equal(invoiceCount.rows[0]?.count, 1);

    const subscription = await fixturePool.query<{
      status: string;
      version: number;
    }>(
      `SELECT status, version
       FROM organization_subscriptions
       WHERE organization_id = $1`,
      [batchOrganizationId]
    );
    assert.equal(subscription.rows[0]?.status, "ACTIVE");
    assert.equal(subscription.rows[0]?.version, 1);
  } finally {
    await database.onModuleDestroy();
    await cleanupBatch(fixturePool);
    await fixturePool.end();
  }
});


test("scheduled cancellation voids and reopens renewal safely before applying at period end", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const billing = new SubscriptionBillingService(database);

  try {
    await cleanupCancellation(fixturePool);

    await fixturePool.query(
      `INSERT INTO organizations (
         id, slug, name, organization_type, status
       )
       VALUES (
         $1,
         'billing-cancellation-org',
         'Billing Cancellation Org',
         'INDIVIDUAL',
         'ACTIVE'
       )`,
      [cancellationOrganizationId]
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
         now() - interval '27 days',
         now() + interval '3 days'
       FROM saas_plans p
       WHERE p.code = 'STARTER'`,
      [cancellationOrganizationId]
    );

    const renewal = await billing.ensureRenewalInvoice(
      cancellationOrganizationId
    );
    assert.ok(renewal);
    assert.equal(renewal.status, "OPEN");

    const scheduled = await database.withTransaction((client) =>
      billing.setCancellationScheduleInTransaction(client, {
        organizationId: cancellationOrganizationId,
        cancelAtPeriodEnd: true,
        expectedVersion: 1,
        reason: "Integration schedule period-end cancellation"
      })
    );

    assert.equal(scheduled.cancelAtPeriodEnd, true);
    assert.equal(scheduled.version, 2);
    assert.deepEqual(scheduled.voidedInvoiceIds, [renewal.id]);
    assert.deepEqual(scheduled.reopenedInvoiceIds, []);

    const voidedInvoice = await fixturePool.query<{
      status: string;
      void_reason: string | null;
      voided_at: Date | null;
    }>(
      `SELECT status, void_reason, voided_at
       FROM saas_subscription_invoices
       WHERE id = $1`,
      [renewal.id]
    );
    assert.equal(voidedInvoice.rows[0]?.status, "VOID");
    assert.equal(
      voidedInvoice.rows[0]?.void_reason,
      "SCHEDULED_CANCELLATION"
    );
    assert.ok(voidedInvoice.rows[0]?.voided_at);

    assert.equal(
      await billing.ensureRenewalInvoice(cancellationOrganizationId),
      null
    );

    const undone = await database.withTransaction((client) =>
      billing.setCancellationScheduleInTransaction(client, {
        organizationId: cancellationOrganizationId,
        cancelAtPeriodEnd: false,
        expectedVersion: 2,
        reason: "Integration undo period-end cancellation"
      })
    );

    assert.equal(undone.cancelAtPeriodEnd, false);
    assert.equal(undone.version, 3);
    assert.deepEqual(undone.voidedInvoiceIds, []);
    assert.deepEqual(undone.reopenedInvoiceIds, [renewal.id]);

    const reopened = await billing.ensureRenewalInvoice(
      cancellationOrganizationId
    );
    assert.ok(reopened);
    assert.equal(reopened.id, renewal.id);
    assert.equal(reopened.status, "OPEN");

    const rescheduled = await database.withTransaction((client) =>
      billing.setCancellationScheduleInTransaction(client, {
        organizationId: cancellationOrganizationId,
        cancelAtPeriodEnd: true,
        expectedVersion: 3,
        reason: "Integration reschedule period-end cancellation"
      })
    );
    assert.equal(rescheduled.version, 4);
    assert.deepEqual(rescheduled.voidedInvoiceIds, [renewal.id]);

    await fixturePool.query(
      `UPDATE organization_subscriptions
       SET current_period_end = now() - interval '1 second'
       WHERE organization_id = $1`,
      [cancellationOrganizationId]
    );

    const sweep = await billing.processDueBatch(50);
    const result = sweep.results.find(
      (item) => item.organizationId === cancellationOrganizationId
    );
    assert.ok(result);
    assert.equal(result.ok, true);
    assert.equal(result.invoiceId, null);
    assert.equal(result.activatedPaidPeriod, false);
    assert.equal(result.transition, "ACTIVE->CANCELLED");

    const subscription = await fixturePool.query<{
      status: string;
      version: number;
      cancel_at_period_end: boolean;
    }>(
      `SELECT status, version, cancel_at_period_end
       FROM organization_subscriptions
       WHERE organization_id = $1`,
      [cancellationOrganizationId]
    );
    assert.equal(subscription.rows[0]?.status, "CANCELLED");
    assert.equal(subscription.rows[0]?.version, 5);
    assert.equal(
      subscription.rows[0]?.cancel_at_period_end,
      false
    );

    const repeatSweep = await billing.processDueBatch(50);
    assert.equal(
      repeatSweep.results.some(
        (item) => item.organizationId === cancellationOrganizationId
      ),
      false
    );

    const audits = await fixturePool.query<{
      action: string;
      count: number;
    }>(
      `SELECT action, count(*)::int AS count
       FROM platform_audit_events
       WHERE organization_id = $1
       GROUP BY action`,
      [cancellationOrganizationId]
    );
    const auditCounts = new Map(
      audits.rows.map((row) => [row.action, row.count])
    );
    assert.equal(
      auditCounts.get("SUBSCRIPTION_CANCELLATION_SCHEDULED"),
      2
    );
    assert.equal(
      auditCounts.get("SUBSCRIPTION_CANCELLATION_SCHEDULE_REVOKED"),
      1
    );
    assert.equal(
      auditCounts.get("SUBSCRIPTION_SCHEDULED_CANCELLATION_APPLIED"),
      1
    );
  } finally {
    await database.onModuleDestroy();
    await cleanupCancellation(fixturePool);
    await fixturePool.end();
  }
});


test("scheduled cancellation rejects future periods that already have allocated money", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const billing = new SubscriptionBillingService(database);

  try {
    await cleanupFundedCancellation(fixturePool);

    await fixturePool.query(
      `INSERT INTO organizations (
         id, slug, name, organization_type, status
       )
       VALUES (
         $1,
         'funded-cancellation-org',
         'Funded Cancellation Org',
         'INDIVIDUAL',
         'ACTIVE'
       )`,
      [fundedCancellationOrganizationId]
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
         now() - interval '27 days',
         now() + interval '3 days'
       FROM saas_plans p
       WHERE p.code = 'STARTER'`,
      [fundedCancellationOrganizationId]
    );

    const invoice = await billing.ensureRenewalInvoice(
      fundedCancellationOrganizationId
    );
    assert.ok(invoice);

    const payment = await fixturePool.query<{ id: string }>(
      `INSERT INTO saas_subscription_payments (
         organization_id,
         subscription_id,
         amount_vnd,
         status,
         reconciliation_status,
         source,
         provider,
         provider_transaction_id,
         idempotency_key,
         occurred_at,
         metadata
       )
       SELECT
         s.organization_id,
         s.id,
         1000,
         'SUCCEEDED',
         'ALLOCATED',
         'PROVIDER',
         'TEST_FUNDED_CANCEL',
         'funded-cancel-tx-001',
         'provider:TEST_FUNDED_CANCEL:funded-cancel-tx-001',
         now(),
         '{}'::jsonb
       FROM organization_subscriptions s
       WHERE s.organization_id = $1
       RETURNING id::text`,
      [fundedCancellationOrganizationId]
    );
    const paymentId = payment.rows[0]?.id;
    assert.ok(paymentId);

    await fixturePool.query(
      `INSERT INTO saas_subscription_payment_allocations (
         organization_id,
         payment_id,
         invoice_id,
         amount_vnd,
         reason
       )
       VALUES ($1, $2, $3, 1000, 'Integration funded future period')`,
      [fundedCancellationOrganizationId, paymentId, invoice.id]
    );

    await fixturePool.query(
      `UPDATE saas_subscription_invoices
       SET status = 'PARTIALLY_PAID',
           updated_at = now()
       WHERE id = $1`,
      [invoice.id]
    );

    await assert.rejects(
      () =>
        database.withTransaction((client) =>
          billing.setCancellationScheduleInTransaction(client, {
            organizationId: fundedCancellationOrganizationId,
            cancelAtPeriodEnd: true,
            expectedVersion: 1,
            reason: "Must reject funded future period"
          })
        ),
      SubscriptionBillingConflictError
    );

    const subscription = await fixturePool.query<{
      cancel_at_period_end: boolean;
      version: number;
    }>(
      `SELECT cancel_at_period_end, version
       FROM organization_subscriptions
       WHERE organization_id = $1`,
      [fundedCancellationOrganizationId]
    );
    assert.equal(
      subscription.rows[0]?.cancel_at_period_end,
      false
    );
    assert.equal(subscription.rows[0]?.version, 1);

    const invoiceAfter = await billing.listInvoices(
      fundedCancellationOrganizationId
    );
    assert.equal(invoiceAfter[0]?.id, invoice.id);
    assert.equal(invoiceAfter[0]?.status, "PARTIALLY_PAID");
    assert.equal(invoiceAfter[0]?.paidAmountVnd, 1000);
  } finally {
    await database.onModuleDestroy();
    await cleanupFundedCancellation(fixturePool);
    await fixturePool.end();
  }
});
