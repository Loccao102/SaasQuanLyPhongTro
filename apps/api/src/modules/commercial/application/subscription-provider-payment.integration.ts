import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import { SubscriptionBillingService } from "./subscription-billing.service.js";

const organizationId = "e1000000-0000-0000-0000-000000000001";
const provider = "TEST_PROVIDER";

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    "DELETE FROM saas_subscription_payment_allocations WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM saas_subscription_payments WHERE organization_id = $1 OR provider = $2",
    [organizationId, provider]
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

test("provider payment auto-matches unique reference and routes unsafe cases to review", async () => {
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
         'provider-payment-org',
         'Provider Payment Org',
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
         now() - interval '27 days',
         now() + interval '3 days'
       FROM saas_plans p
       WHERE p.code = 'STARTER'`,
      [organizationId]
    );

    const invoice = await billing.ensureRenewalInvoice(organizationId);
    assert.ok(invoice);
    assert.equal(invoice.amountVnd, 99_000);
    assert.equal(invoice.remainingAmountVnd, 99_000);
    assert.match(invoice.paymentReference, /^SAAS[A-F0-9]+$/);

    const partial = await billing.ingestProviderPayment({
      provider,
      providerTransactionId: "provider-tx-001",
      amountVnd: 40_000,
      occurredAt: new Date().toISOString(),
      paymentReference: invoice.paymentReference,
      metadata: { bankAccount: "test" }
    });

    assert.equal(partial.matchedBy, "PAYMENT_REFERENCE");
    assert.ok(partial.invoice);
    assert.ok(partial.allocation);
    assert.equal(partial.payment.source, "PROVIDER");
    assert.equal(partial.payment.reconciliationStatus, "ALLOCATED");
    assert.equal(partial.payment.organizationId, organizationId);
    assert.equal(partial.payment.allocatedAmountVnd, 40_000);
    assert.equal(partial.payment.unallocatedAmountVnd, 0);
    assert.equal(partial.invoice.status, "PARTIALLY_PAID");
    assert.equal(partial.invoice.paidAmountVnd, 40_000);
    assert.equal(partial.invoice.remainingAmountVnd, 59_000);

    const replayedPartial = await billing.ingestProviderPayment({
      provider,
      providerTransactionId: "provider-tx-001",
      amountVnd: 40_000,
      occurredAt: new Date().toISOString(),
      paymentReference: invoice.paymentReference,
      metadata: { bankAccount: "test" }
    });

    assert.equal(replayedPartial.payment.id, partial.payment.id);
    assert.equal(replayedPartial.allocation?.id, partial.allocation.id);
    assert.equal(replayedPartial.invoice?.remainingAmountVnd, 59_000);

    const overpay = await billing.ingestProviderPayment({
      provider,
      providerTransactionId: "provider-tx-overpay",
      amountVnd: 60_000,
      occurredAt: new Date().toISOString(),
      paymentReference: invoice.paymentReference
    });

    assert.equal(overpay.matchedBy, "PAYMENT_REFERENCE");
    assert.ok(overpay.invoice);
    assert.equal(overpay.allocation, null);
    assert.equal(
      overpay.payment.reconciliationStatus,
      "REVIEW_REQUIRED"
    );
    assert.equal(overpay.payment.organizationId, organizationId);
    assert.equal(overpay.payment.allocatedAmountVnd, 0);
    assert.equal(overpay.payment.unallocatedAmountVnd, 60_000);
    assert.equal(overpay.invoice.remainingAmountVnd, 59_000);

    const replayedOverpay = await billing.ingestProviderPayment({
      provider,
      providerTransactionId: "provider-tx-overpay",
      amountVnd: 60_000,
      occurredAt: new Date().toISOString(),
      paymentReference: invoice.paymentReference
    });

    assert.equal(replayedOverpay.payment.id, overpay.payment.id);
    assert.equal(replayedOverpay.matchedBy, "PAYMENT_REFERENCE");
    assert.equal(
      replayedOverpay.invoice?.paymentReference,
      invoice.paymentReference
    );
    assert.equal(replayedOverpay.allocation, null);

    const unmatched = await billing.ingestProviderPayment({
      provider,
      providerTransactionId: "provider-tx-unmatched",
      amountVnd: 25_000,
      occurredAt: new Date().toISOString(),
      paymentReference: "SAASUNKNOWNREFERENCE"
    });

    assert.equal(unmatched.matchedBy, null);
    assert.equal(unmatched.invoice, null);
    assert.equal(unmatched.allocation, null);
    assert.equal(
      unmatched.payment.reconciliationStatus,
      "REVIEW_REQUIRED"
    );
    assert.equal(unmatched.payment.organizationId, null);
    assert.equal(unmatched.payment.subscriptionId, null);

    const invoiceAfter = (await billing.listInvoices(organizationId))[0];
    assert.ok(invoiceAfter);
    assert.equal(invoiceAfter.status, "PARTIALLY_PAID");
    assert.equal(invoiceAfter.paidAmountVnd, 40_000);
    assert.equal(invoiceAfter.remainingAmountVnd, 59_000);

    const payments = await fixturePool.query<{
      provider_transaction_id: string;
      reconciliation_status: string;
      organization_id: string | null;
    }>(
      `SELECT
         provider_transaction_id,
         reconciliation_status,
         organization_id::text
       FROM saas_subscription_payments
       WHERE provider = $1
       ORDER BY provider_transaction_id`,
      [provider]
    );
    assert.equal(payments.rows.length, 3);

    const allocations = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM saas_subscription_payment_allocations
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(allocations.rows[0]?.count, 1);
  } finally {
    await database.onModuleDestroy();
    await cleanup(fixturePool);
    await fixturePool.end();
  }
});
