import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { CommercialPolicyService } from "../commercial/application/commercial-policy.service.js";
import { SubscriptionBillingService } from "../commercial/application/subscription-billing.service.js";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import { RenterPaymentsService } from "../renter-payments/renter-payments.service.js";
import {
  BillingWebhookConflictError,
  SaasBillingWebhookInboxService
} from "./saas-billing-webhook-inbox.service.js";
import { SaasBillingWebhookProcessingService } from "./saas-billing-webhook-processing.service.js";

const organizationId = "f1000000-0000-0000-0000-000000000001";
const provider = "TEST_WEBHOOK_PROCESSOR";

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    "DELETE FROM saas_billing_webhook_events WHERE provider = $1",
    [provider]
  );
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

test("verified billing webhook processing commits one payment effect and replays safely", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const billing = new SubscriptionBillingService(database);
  const inbox = new SaasBillingWebhookInboxService(database);
  const renterPayments = new RenterPaymentsService(
    database,
    new AccessControlService(),
    new CommercialPolicyService()
  );
  const processing = new SaasBillingWebhookProcessingService(
    database,
    inbox,
    billing,
    renterPayments
  );

  try {
    await cleanup(fixturePool);

    await fixturePool.query(
      `INSERT INTO organizations (
         id, slug, name, organization_type, status
       )
       VALUES (
         $1,
         'webhook-processing-org',
         'Webhook Processing Org',
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

    const event = await inbox.persist({
      provider,
      providerEventId: "webhook-event-001",
      signatureStatus: "VERIFIED",
      rawBody: JSON.stringify({
        transactionId: "bank-tx-001",
        amount: 40000,
        reference: invoice.paymentReference
      }),
      headers: { "x-test-signature": "verified" }
    });

    const claimed = await processing.claim(provider);
    assert.ok(claimed);
    assert.equal(claimed.id, event.id);
    assert.equal(claimed.processingAttempts, 1);

    const normalized = {
      providerTransactionId: "bank-tx-001",
      amountVnd: 40_000,
      occurredAt: "2026-09-21T05:00:00.000Z",
      paymentReference: invoice.paymentReference,
      metadata: { parsedBy: "integration-test" }
    };

    const first = await processing.processPayment(
      claimed.id,
      normalized
    );

    assert.equal(first.domain, "SAAS");
    assert.equal(first.replayed, false);
    assert.equal(first.event.processingStatus, "PROCESSED");
    assert.equal(first.event.paymentId, first.ingestion.payment.id);
    assert.equal(
      first.ingestion.payment.reconciliationStatus,
      "ALLOCATED"
    );
    assert.equal(first.ingestion.invoice?.status, "PARTIALLY_PAID");
    assert.equal(first.ingestion.invoice?.paidAmountVnd, 40_000);
    assert.equal(first.ingestion.invoice?.remainingAmountVnd, 59_000);

    const replayed = await processing.processPayment(
      claimed.id,
      normalized
    );

    assert.equal(replayed.replayed, true);
    assert.equal(
      replayed.ingestion.payment.id,
      first.ingestion.payment.id
    );
    assert.equal(
      replayed.ingestion.allocation?.id,
      first.ingestion.allocation?.id
    );

    await assert.rejects(
      () =>
        processing.processPayment(claimed.id, {
          ...normalized,
          amountVnd: 41_000
        }),
      BillingWebhookConflictError
    );

    const paymentCount = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM saas_subscription_payments
       WHERE provider = $1
         AND provider_transaction_id = 'bank-tx-001'`,
      [provider]
    );
    assert.equal(paymentCount.rows[0]?.count, 1);

    const allocationCount = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM saas_subscription_payment_allocations
       WHERE organization_id = $1
         AND invoice_id = $2`,
      [organizationId, invoice.id]
    );
    assert.equal(allocationCount.rows[0]?.count, 1);

    const failedEvent = await inbox.persist({
      provider,
      providerEventId: "webhook-event-failed",
      signatureStatus: "VERIFIED",
      rawBody: '{"unparseable":true}'
    });
    const failedClaim = await processing.claim(provider);
    assert.ok(failedClaim);
    assert.equal(failedClaim.id, failedEvent.id);

    const failed = await processing.completeWithoutPayment({
      eventId: failedClaim.id,
      outcome: "REVIEW_REQUIRED",
      errorCode: "UNSUPPORTED_PAYLOAD",
      errorMessage: "Provider adapter could not normalize payment"
    });
    assert.equal(failed.processingStatus, "REVIEW_REQUIRED");
    assert.equal(failed.paymentId, null);

    const paymentsAfterFailure = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM saas_subscription_payments
       WHERE provider = $1`,
      [provider]
    );
    assert.equal(paymentsAfterFailure.rows[0]?.count, 1);
  } finally {
    await database.onModuleDestroy();
    await cleanup(fixturePool);
    await fixturePool.end();
  }
});
