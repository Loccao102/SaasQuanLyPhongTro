import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { DatabaseService } from "../database/database.service.js";
import { RenterPaymentWebhookInboxService } from "./renter-payment-webhook-inbox.service.js";
import { RenterProviderPaymentProcessingService } from "./renter-provider-payment-processing.service.js";

const organizationId = "f1000000-0000-4000-8000-000000000001";
const propertyId = "f1000000-0000-4000-8000-000000000002";
const roomId = "f1000000-0000-4000-8000-000000000003";
const leaseId = "f1000000-0000-4000-8000-000000000004";
const cycleId = "f1000000-0000-4000-8000-000000000005";
const invoiceId = "f1000000-0000-4000-8000-000000000006";
const provider = "TEST_RENTER_BANK";

async function cleanup(pool: Pool) {
  await pool.query(
    "DELETE FROM renter_payment_webhook_events WHERE provider = $1",
    [provider]
  );
  await pool.query(
    "DELETE FROM renter_payment_allocations WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM renter_payment_transactions WHERE organization_id = $1 OR provider = $2",
    [organizationId, provider]
  );
  await pool.query(
    "DELETE FROM renter_invoices WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM renter_billing_cycles WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query("DELETE FROM leases WHERE organization_id = $1", [
    organizationId
  ]);
  await pool.query("DELETE FROM rooms WHERE organization_id = $1", [
    organizationId
  ]);
  await pool.query("DELETE FROM properties WHERE organization_id = $1", [
    organizationId
  ]);
  await pool.query("DELETE FROM audit_events WHERE organization_id = $1", [
    organizationId
  ]);
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
}

async function acceptAndClaim(
  inbox: RenterPaymentWebhookInboxService,
  eventId: string,
  body: string
) {
  const persisted = await inbox.persist({
    provider,
    providerEventId: eventId,
    signatureStatus: "VERIFIED",
    rawBody: body
  });
  const claimed = await inbox.claim(provider);
  assert.ok(claimed);
  assert.equal(claimed.id, persisted.id);
  return claimed;
}

test("renter provider payments safely auto-allocate and route unsafe matches to review", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const pool = new Pool({ connectionString });
  const database = new DatabaseService();
  const inbox = new RenterPaymentWebhookInboxService(database);
  const processing = new RenterProviderPaymentProcessingService(database, inbox);

  try {
    await cleanup(pool);

    await pool.query(
      `INSERT INTO organizations (
         id, slug, name, organization_type, status
       ) VALUES ($1, 'renter-provider-test', 'Renter Provider Test', 'INDIVIDUAL', 'ACTIVE')`,
      [organizationId]
    );
    await pool.query(
      `INSERT INTO properties (
         id, organization_id, code, name, property_type
       ) VALUES ($1, $2, 'P1', 'Property 1', 'BOARDING_HOUSE')`,
      [propertyId, organizationId]
    );
    await pool.query(
      `INSERT INTO rooms (
         id, organization_id, property_id, code, name
       ) VALUES ($1, $2, $3, 'R1', 'Room 1')`,
      [roomId, organizationId, propertyId]
    );
    await pool.query(
      `INSERT INTO leases (
         id, organization_id, room_id, lease_code, status, start_date,
         base_rent_vnd, deposit_required_vnd, billing_day
       ) VALUES ($1, $2, $3, 'LEASE-1', 'ACTIVE', '2026-09-01', 100000, 0, 1)`,
      [leaseId, organizationId, roomId]
    );
    await pool.query(
      `INSERT INTO renter_billing_cycles (
         id, organization_id, property_id, cycle_code,
         period_start, period_end, due_date, status
       ) VALUES (
         $1, $2, $3, '2026-09', '2026-09-01', '2026-09-30', '2026-10-05', 'FINALIZED'
       )`,
      [cycleId, organizationId, propertyId]
    );
    await pool.query(
      `INSERT INTO renter_invoices (
         id, organization_id, billing_cycle_id, property_id, room_id, lease_id,
         invoice_number, payment_reference, status,
         period_start, period_end, due_date,
         property_name_snapshot, room_code_snapshot, lease_code_snapshot,
         primary_resident_name_snapshot,
         subtotal_vnd, adjustment_vnd, previous_balance_vnd, total_vnd,
         paid_vnd, remaining_vnd, collection_status, issued_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         'INV-100', 'RENTTEST100', 'ISSUED',
         '2026-09-01', '2026-09-30', '2026-10-05',
         'Property 1', 'R1', 'LEASE-1', 'Resident A',
         100000, 0, 0, 100000,
         0, 100000, 'UNPAID', now()
       )`,
      [
        invoiceId,
        organizationId,
        cycleId,
        propertyId,
        roomId,
        leaseId
      ]
    );

    const partialAt = new Date("2026-09-24T01:00:00.000Z").toISOString();
    const first = await acceptAndClaim(inbox, "event-partial", "{}");
    const partial = await processing.processPayment(first.id, {
      providerTransactionId: "tx-partial",
      amountVnd: 40_000,
      occurredAt: partialAt,
      paymentReference: "renttest100"
    });
    assert.equal(partial.allocated, true);
    assert.equal(partial.collectionStatus, "PARTIALLY_PAID");
    assert.equal(partial.remainingVnd, 60_000);

    const over = await acceptAndClaim(inbox, "event-overpay", "{}");
    const overpay = await processing.processPayment(over.id, {
      providerTransactionId: "tx-overpay",
      amountVnd: 70_000,
      occurredAt: new Date("2026-09-24T01:05:00.000Z").toISOString(),
      paymentReference: "RENTTEST100"
    });
    assert.equal(overpay.allocated, false);
    assert.equal(overpay.event.processingStatus, "REVIEW_REQUIRED");
    assert.ok(overpay.paymentTransactionId);

    const exact = await acceptAndClaim(inbox, "event-exact", "{}");
    const paid = await processing.processPayment(exact.id, {
      providerTransactionId: "tx-exact",
      amountVnd: 60_000,
      occurredAt: new Date("2026-09-24T01:10:00.000Z").toISOString(),
      paymentReference: "RENTTEST100"
    });
    assert.equal(paid.allocated, true);
    assert.equal(paid.collectionStatus, "PAID");
    assert.equal(paid.remainingVnd, 0);

    const duplicate = await acceptAndClaim(inbox, "event-exact-replay", "{}");
    const replay = await processing.processPayment(duplicate.id, {
      providerTransactionId: "tx-exact",
      amountVnd: 60_000,
      occurredAt: new Date("2026-09-24T01:10:00.000Z").toISOString(),
      paymentReference: "RENTTEST100"
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.allocated, true);
    assert.equal(replay.paymentTransactionId, paid.paymentTransactionId);

    const wrong = await acceptAndClaim(inbox, "event-wrong-ref", "{}");
    const unmatched = await processing.processPayment(wrong.id, {
      providerTransactionId: "tx-wrong",
      amountVnd: 25_000,
      occurredAt: new Date("2026-09-24T01:15:00.000Z").toISOString(),
      paymentReference: "RENTUNKNOWN"
    });
    assert.equal(unmatched.allocated, false);
    assert.equal(unmatched.paymentTransactionId, null);
    assert.equal(unmatched.event.processingStatus, "REVIEW_REQUIRED");

    const invoice = await pool.query<{
      paid_vnd: string;
      remaining_vnd: string;
      collection_status: string;
    }>(
      `SELECT paid_vnd::text, remaining_vnd::text, collection_status
       FROM renter_invoices
       WHERE id = $1`,
      [invoiceId]
    );
    assert.equal(Number(invoice.rows[0]?.paid_vnd), 100_000);
    assert.equal(Number(invoice.rows[0]?.remaining_vnd), 0);
    assert.equal(invoice.rows[0]?.collection_status, "PAID");

    const allocations = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM renter_payment_allocations
       WHERE organization_id = $1
         AND invoice_id = $2`,
      [organizationId, invoiceId]
    );
    assert.equal(allocations.rows[0]?.count, 2);

    const reviewTx = await pool.query<{
      reconciliation_status: string;
      count: number;
    }>(
      `SELECT reconciliation_status, count(*)::int AS count
       FROM renter_payment_transactions
       WHERE organization_id = $1
         AND provider_transaction_id = 'tx-overpay'
       GROUP BY reconciliation_status`,
      [organizationId]
    );
    assert.equal(reviewTx.rows[0]?.reconciliation_status, "REVIEW_REQUIRED");
    assert.equal(reviewTx.rows[0]?.count, 1);
  } finally {
    await database.onModuleDestroy();
    await cleanup(pool);
    await pool.end();
  }
});
