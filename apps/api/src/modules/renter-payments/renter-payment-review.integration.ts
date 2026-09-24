import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { CommercialPolicyService } from "../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";
import { RenterPaymentReviewService } from "./renter-payment-review.service.js";

const organizationId = "f2000000-0000-4000-8000-000000000001";
const userId = "f2000000-0000-4000-8000-000000000002";
const propertyId = "f2000000-0000-4000-8000-000000000003";
const roomId = "f2000000-0000-4000-8000-000000000004";
const leaseId = "f2000000-0000-4000-8000-000000000005";
const cycleId = "f2000000-0000-4000-8000-000000000006";
const invoiceId = "f2000000-0000-4000-8000-000000000007";
const transactionId = "f2000000-0000-4000-8000-000000000008";

async function cleanup(pool: Pool) {
  await pool.query("DELETE FROM renter_payment_webhook_events WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM renter_payment_allocations WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM renter_payment_transactions WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM renter_invoices WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM renter_billing_cycles WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM leases WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM rooms WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM properties WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organization_subscriptions WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM audit_events WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organization_memberships WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

test("tenant review queue safely resolves a provider payment without hiding excess money", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString);

  const pool = new Pool({ connectionString });
  const database = new DatabaseService();
  const service = new RenterPaymentReviewService(
    database,
    new AccessControlService(),
    new CommercialPolicyService()
  );

  try {
    await cleanup(pool);

    await pool.query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, 'review-queue@example.invalid', 'Review Queue')`,
      [userId]
    );
    await pool.query(
      `INSERT INTO organizations (id, slug, name, organization_type, status)
       VALUES ($1, 'review-queue-test', 'Review Queue Test', 'INDIVIDUAL', 'ACTIVE')`,
      [organizationId]
    );
    await pool.query(
      `INSERT INTO organization_memberships (
         organization_id, user_id, role, status
       ) VALUES ($1, $2, 'OWNER', 'ACTIVE')`,
      [organizationId, userId]
    );

    const plan = await pool.query<{ id: string; current_version_id: string }>(
      `SELECT id::text, current_version_id::text
       FROM saas_plans
       WHERE code = 'BUSINESS'`
    );
    assert.ok(plan.rows[0]);
    await pool.query(
      `INSERT INTO organization_subscriptions (
         organization_id, plan_id, plan_version_id, status,
         current_period_start, current_period_end
       ) VALUES ($1, $2, $3, 'ACTIVE', now(), now() + interval '30 days')`,
      [organizationId, plan.rows[0]!.id, plan.rows[0]!.current_version_id]
    );

    await pool.query(
      `INSERT INTO properties (id, organization_id, code, name, property_type)
       VALUES ($1, $2, 'P1', 'Property 1', 'BOARDING_HOUSE')`,
      [propertyId, organizationId]
    );
    await pool.query(
      `INSERT INTO rooms (id, organization_id, property_id, code, name)
       VALUES ($1, $2, $3, 'R1', 'Room 1')`,
      [roomId, organizationId, propertyId]
    );
    await pool.query(
      `INSERT INTO leases (
         id, organization_id, room_id, lease_code, status, start_date,
         base_rent_vnd, deposit_required_vnd, billing_day
       ) VALUES ($1, $2, $3, 'LEASE-R', 'ACTIVE', '2026-09-01', 100000, 0, 1)`,
      [leaseId, organizationId, roomId]
    );
    await pool.query(
      `INSERT INTO renter_billing_cycles (
         id, organization_id, property_id, cycle_code,
         period_start, period_end, due_date, status
       ) VALUES ($1, $2, $3, '2026-09', '2026-09-01', '2026-09-30', '2026-10-05', 'FINALIZED')`,
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
         'INV-REVIEW', 'RENTREVIEW001', 'ISSUED',
         '2026-09-01', '2026-09-30', '2026-10-05',
         'Property 1', 'R1', 'LEASE-R', 'Resident R',
         100000, 0, 0, 100000, 0, 100000, 'UNPAID', now()
       )`,
      [invoiceId, organizationId, cycleId, propertyId, roomId, leaseId]
    );
    await pool.query(
      `INSERT INTO renter_payment_transactions (
         id, organization_id, source, provider, provider_transaction_id,
         payment_reference, reconciliation_status, amount_vnd, occurred_at,
         status, raw_payload
       ) VALUES (
         $1, $2, 'PROVIDER', 'SEPAY', 'review-tx-1',
         'RENTREVIEW001', 'REVIEW_REQUIRED', 120000, now(), 'POSTED', '{}'::jsonb
       )`,
      [transactionId, organizationId]
    );
    await pool.query(
      `INSERT INTO renter_payment_webhook_events (
         provider, provider_event_id, signature_status, processing_status,
         raw_body, raw_body_sha256, provider_transaction_id, amount_vnd,
         occurred_at, payment_reference, normalized_payment_fingerprint,
         organization_id, payment_transaction_id, last_error_code, last_error_message
       ) VALUES (
         'SEPAY', 'review-event-1', 'VERIFIED', 'REVIEW_REQUIRED',
         '{}', repeat('a', 64), 'review-tx-1', 120000, now(),
         'RENTREVIEW001', repeat('b', 64), $1, $2,
         'RENTER_PAYMENT_OVERPAYMENT', 'Provider payment exceeds invoice remaining amount.'
       )`,
      [organizationId, transactionId]
    );

    const principal: TenantPrincipal = {
      userId,
      membershipId: "not-used-by-service",
      organizationId,
      organizationName: "Review Queue Test",
      role: "OWNER",
      membership: {
        organizationId,
        role: "OWNER",
        status: "ACTIVE",
        scopes: [{ type: "ORGANIZATION" }]
      }
    };

    const queue = await service.list(principal);
    assert.equal(queue.count, 1);
    assert.equal(queue.items[0]?.reason.code, "RENTER_PAYMENT_OVERPAYMENT");
    assert.equal(queue.items[0]?.unallocatedVnd, 120000);

    const allocationId = randomUUID();
    const resolved = await service.allocateReferencedInvoice(
      principal,
      transactionId,
      {
        allocationId,
        amountVnd: 100000,
        reason: "Đã đối chiếu sao kê, phân bổ tối đa theo số còn phải thu."
      }
    );

    assert.equal(resolved.invoice.collectionStatus, "PAID");
    assert.equal(resolved.invoice.remainingVnd, 0);
    assert.equal(resolved.unallocatedVnd, 20000);
    assert.equal(resolved.reconciliationStatus, "REVIEW_REQUIRED");

    const retry = await service.allocateReferencedInvoice(
      principal,
      transactionId,
      {
        allocationId,
        amountVnd: 100000,
        reason: "Retry cùng command."
      }
    );
    assert.equal(retry.transactionId, transactionId);

    const audit = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM audit_events
       WHERE organization_id = $1
         AND action = 'RENTER_PROVIDER_PAYMENT_MANUALLY_RECONCILED'
         AND resource_id = $2`,
      [organizationId, transactionId]
    );
    assert.equal(audit.rows[0]?.count, 1);
  } finally {
    await database.onModuleDestroy();
    await cleanup(pool);
    await pool.end();
  }
});
