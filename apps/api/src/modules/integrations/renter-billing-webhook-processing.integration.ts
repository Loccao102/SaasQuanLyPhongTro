import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { CommercialPolicyService } from "../commercial/application/commercial-policy.service.js";
import { SubscriptionBillingService } from "../commercial/application/subscription-billing.service.js";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import { RenterPaymentsService } from "../renter-payments/renter-payments.service.js";
import { SaasBillingWebhookInboxService } from "./saas-billing-webhook-inbox.service.js";
import { SaasBillingWebhookProcessingService } from "./saas-billing-webhook-processing.service.js";

const organizationId = "f2000000-0000-4000-8000-000000000001";
const propertyId = "f2100000-0000-4000-8000-000000000001";
const roomId = "f2200000-0000-4000-8000-000000000001";
const leaseId = "f2300000-0000-4000-8000-000000000001";
const cycleId = "f2400000-0000-4000-8000-000000000001";
const invoiceId = "f2500000-0000-4000-8000-000000000001";
const provider = "TEST_RENTER_WEBHOOK";
const paymentReference = "RENTF2500000000040008000000000000001";

async function cleanup(pool: Pool) {
  await pool.query(
    `DELETE FROM renter_billing_webhook_event_links
     WHERE event_id IN (
       SELECT id
       FROM saas_billing_webhook_events
       WHERE provider = $1
     )`,
    [provider]
  );
  await pool.query(
    "DELETE FROM saas_billing_webhook_events WHERE provider = $1",
    [provider]
  );
  await pool.query(
    "DELETE FROM renter_payment_allocations WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM renter_payment_transactions WHERE provider = $1 OR organization_id = $2",
    [provider, organizationId]
  );
  await pool.query(
    "DELETE FROM renter_invoice_lines WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM renter_invoices WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM renter_billing_cycles WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM leases WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM audit_events WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM rooms WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM properties WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
}

test("renter billing webhook auto-allocates safe references and deduplicates provider transactions", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const inbox = new SaasBillingWebhookInboxService(database);
  const renterPayments = new RenterPaymentsService(
    database,
    new AccessControlService(),
    new CommercialPolicyService()
  );
  const processing = new SaasBillingWebhookProcessingService(
    database,
    inbox,
    new SubscriptionBillingService(database),
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
         'renter-webhook-org',
         'Renter Webhook Org',
         'INDIVIDUAL',
         'ACTIVE'
       )`,
      [organizationId]
    );
    await fixturePool.query(
      `INSERT INTO properties (
         id, organization_id, code, name, property_type
       )
       VALUES ($1, $2, 'RW1', 'Renter Webhook Property', 'BOARDING_HOUSE')`,
      [propertyId, organizationId]
    );
    await fixturePool.query(
      `INSERT INTO rooms (
         id, organization_id, property_id, code, name
       )
       VALUES ($1, $2, $3, '101', 'Room 101')`,
      [roomId, organizationId, propertyId]
    );
    await fixturePool.query(
      `INSERT INTO leases (
         id,
         organization_id,
         room_id,
         lease_code,
         status,
         start_date,
         base_rent_vnd,
         deposit_required_vnd,
         billing_day
       )
       VALUES (
         $1, $2, $3, 'LEASE-RW-1', 'ACTIVE',
         '2026-09-01', 200000, 0, 5
       )`,
      [leaseId, organizationId, roomId]
    );
    await fixturePool.query(
      `INSERT INTO renter_billing_cycles (
         id,
         organization_id,
         property_id,
         cycle_code,
         period_start,
         period_end,
         due_date,
         status,
         finalized_at
       )
       VALUES (
         $1, $2, $3, 'RW-2026-10',
         '2026-10-01', '2026-10-31', '2026-11-05',
         'FINALIZED', now()
       )`,
      [cycleId, organizationId, propertyId]
    );
    await fixturePool.query(
      `INSERT INTO renter_invoices (
         id,
         organization_id,
         billing_cycle_id,
         property_id,
         room_id,
         lease_id,
         invoice_number,
         status,
         period_start,
         period_end,
         due_date,
         property_name_snapshot,
         room_code_snapshot,
         lease_code_snapshot,
         primary_resident_name_snapshot,
         subtotal_vnd,
         adjustment_vnd,
         previous_balance_vnd,
         total_vnd,
         paid_vnd,
         remaining_vnd,
         collection_status,
         calculation_status,
         review_reasons,
         issued_at,
         payment_reference
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         'INV-RW-001', 'ISSUED',
         '2026-10-01', '2026-10-31', '2026-11-05',
         'Renter Webhook Property', '101', 'LEASE-RW-1', 'Tenant Webhook',
         200000, 0, 0, 200000,
         0, 200000, 'UNPAID',
         'READY', '[]'::jsonb, now(), $7
       )`,
      [
        invoiceId,
        organizationId,
        cycleId,
        propertyId,
        roomId,
        leaseId,
        paymentReference
      ]
    );

    const firstEvent = await inbox.persist({
      provider,
      providerEventId: "renter-event-001",
      signatureStatus: "VERIFIED",
      rawBody: JSON.stringify({
        transactionId: "bank-renter-001",
        amount: 100000,
        reference: paymentReference
      })
    });
    const firstClaim = await processing.claim(provider);
    assert.ok(firstClaim);
    assert.equal(firstClaim.id, firstEvent.id);

    const normalized = {
      providerTransactionId: "bank-renter-001",
      amountVnd: 100000,
      occurredAt: "2026-11-02T03:00:00.000Z",
      paymentReference,
      metadata: { parsedBy: "renter-webhook-integration" }
    };

    const first = await processing.processPayment(firstClaim.id, normalized);
    if (first.domain !== "RENTER" || !first.ingestion) {
      assert.fail("Expected RENTER webhook ingestion.");
    }
    assert.equal(first.replayed, false);
    assert.equal(first.event.processingStatus, "PROCESSED");
    assert.equal(first.event.paymentId, null);
    assert.equal(first.ingestion.payment.reconciliationStatus, "ALLOCATED");
    assert.equal(first.ingestion.allocations.length, 1);
    assert.equal(first.ingestion.invoice?.paidVnd, 100000);
    assert.equal(first.ingestion.invoice?.remainingVnd, 100000);
    assert.equal(
      first.ingestion.invoice?.collectionStatus,
      "PARTIALLY_PAID"
    );

    const replay = await processing.processPayment(firstClaim.id, normalized);
    if (replay.domain !== "RENTER" || !replay.ingestion) {
      assert.fail("Expected replayed RENTER webhook ingestion.");
    }
    assert.equal(replay.replayed, true);
    assert.equal(
      replay.ingestion.payment.id,
      first.ingestion.payment.id
    );

    const duplicateEvent = await inbox.persist({
      provider,
      providerEventId: "renter-event-002",
      signatureStatus: "VERIFIED",
      rawBody: JSON.stringify({
        transactionId: "bank-renter-001",
        amount: 100000,
        reference: paymentReference,
        duplicateDelivery: true
      })
    });
    const duplicateClaim = await processing.claim(provider);
    assert.ok(duplicateClaim);
    assert.equal(duplicateClaim.id, duplicateEvent.id);
    const duplicate = await processing.processPayment(
      duplicateClaim.id,
      normalized
    );
    if (duplicate.domain !== "RENTER" || !duplicate.ingestion) {
      assert.fail("Expected duplicate RENTER webhook ingestion.");
    }
    assert.equal(
      duplicate.ingestion.payment.id,
      first.ingestion.payment.id
    );

    const paymentCount = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM renter_payment_transactions
       WHERE provider = $1
         AND provider_transaction_id = 'bank-renter-001'`,
      [provider]
    );
    assert.equal(paymentCount.rows[0]?.count, 1);

    const allocationCount = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM renter_payment_allocations
       WHERE organization_id = $1
         AND invoice_id = $2`,
      [organizationId, invoiceId]
    );
    assert.equal(allocationCount.rows[0]?.count, 1);

    const linkCount = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM renter_billing_webhook_event_links l
       JOIN saas_billing_webhook_events e ON e.id = l.event_id
       WHERE e.provider = $1
         AND l.renter_payment_transaction_id = $2::uuid`,
      [provider, first.ingestion.payment.id]
    );
    assert.equal(linkCount.rows[0]?.count, 2);

    const unmatchedEvent = await inbox.persist({
      provider,
      providerEventId: "renter-event-unmatched",
      signatureStatus: "VERIFIED",
      rawBody: '{"reference":"RENT-NOT-FOUND"}'
    });
    const unmatchedClaim = await processing.claim(provider);
    assert.ok(unmatchedClaim);
    assert.equal(unmatchedClaim.id, unmatchedEvent.id);
    const unmatched = await processing.processPayment(
      unmatchedClaim.id,
      {
        providerTransactionId: "bank-renter-unmatched",
        amountVnd: 50000,
        occurredAt: "2026-11-03T03:00:00.000Z",
        paymentReference: "RENT-NOT-FOUND"
      }
    );
    if (unmatched.domain !== "RENTER" || !unmatched.ingestion) {
      assert.fail("Expected unmatched RENTER payment ingestion.");
    }
    assert.equal(
      unmatched.ingestion.payment.reconciliationStatus,
      "UNMATCHED"
    );
    assert.equal(unmatched.ingestion.payment.organizationId, null);
    assert.equal(unmatched.ingestion.allocations.length, 0);

    const overpayEvent = await inbox.persist({
      provider,
      providerEventId: "renter-event-overpay",
      signatureStatus: "VERIFIED",
      rawBody: '{"overpay":true}'
    });
    const overpayClaim = await processing.claim(provider);
    assert.ok(overpayClaim);
    assert.equal(overpayClaim.id, overpayEvent.id);
    const overpay = await processing.processPayment(overpayClaim.id, {
      providerTransactionId: "bank-renter-overpay",
      amountVnd: 150000,
      occurredAt: "2026-11-04T03:00:00.000Z",
      paymentReference
    });
    if (overpay.domain !== "RENTER" || !overpay.ingestion) {
      assert.fail("Expected overpay RENTER payment ingestion.");
    }
    assert.equal(
      overpay.ingestion.payment.reconciliationStatus,
      "REVIEW_REQUIRED"
    );
    assert.equal(overpay.ingestion.allocations.length, 0);
    assert.equal(overpay.ingestion.invoice, null);

    const invoiceAfterReview = await fixturePool.query<{
      paid_vnd: string;
      remaining_vnd: string;
      collection_status: string;
    }>(
      `SELECT
         paid_vnd::text,
         remaining_vnd::text,
         collection_status
       FROM renter_invoices
       WHERE id = $1`,
      [invoiceId]
    );
    assert.deepEqual(invoiceAfterReview.rows[0], {
      paid_vnd: "100000",
      remaining_vnd: "100000",
      collection_status: "PARTIALLY_PAID"
    });

    await inbox.persist({
      provider,
      providerEventId: "renter-event-unknown-domain",
      signatureStatus: "VERIFIED",
      rawBody: '{"reference":"UNKNOWN-001"}'
    });
    const unknownDomainClaim = await processing.claim(provider);
    assert.ok(unknownDomainClaim);
    const unknownDomain = await processing.processPayment(
      unknownDomainClaim.id,
      {
        providerTransactionId: "bank-unknown-domain",
        amountVnd: 10000,
        occurredAt: "2026-11-05T03:00:00.000Z",
        paymentReference: "UNKNOWN-001"
      }
    );
    assert.equal(unknownDomain.domain, "REVIEW_REQUIRED");
    assert.equal(unknownDomain.event.processingStatus, "REVIEW_REQUIRED");
    assert.equal(unknownDomain.ingestion, null);

    const audits = await fixturePool.query<{ action: string }>(
      `SELECT action
       FROM audit_events
       WHERE organization_id = $1
       ORDER BY occurred_at, id`,
      [organizationId]
    );
    assert.ok(
      audits.rows.some(
        (row) => row.action === "RENTER_PROVIDER_PAYMENT_ALLOCATED"
      )
    );
    assert.ok(
      audits.rows.some(
        (row) =>
          row.action === "RENTER_PROVIDER_PAYMENT_REVIEW_REQUIRED"
      )
    );
  } finally {
    await database.onModuleDestroy();
    await cleanup(fixturePool);
    await fixturePool.end();
  }
});
