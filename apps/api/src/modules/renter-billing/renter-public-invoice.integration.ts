import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { CommercialPolicyService } from "../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";
import { RenterPaymentsService } from "../renter-payments/renter-payments.service.js";
import { RenterPublicInvoiceService } from "./renter-public-invoice.service.js";

const organizationId = "f2000000-0000-4000-8000-000000000001";
const userId = "f2000000-0000-4000-8000-000000000002";
const membershipId = "f2000000-0000-4000-8000-000000000003";
const propertyId = "f2000000-0000-4000-8000-000000000004";
const roomId = "f2000000-0000-4000-8000-000000000005";
const leaseId = "f2000000-0000-4000-8000-000000000006";
const cycleId = "f2000000-0000-4000-8000-000000000007";
const invoiceId = "f2000000-0000-4000-8000-000000000008";
const transactionId = "f2000000-0000-4000-8000-000000000009";
const allocationId = "f2000000-0000-4000-8000-000000000010";

const principal: TenantPrincipal = {
  userId,
  membershipId,
  organizationId,
  organizationName: "Public Invoice Test",
  role: "ADMIN",
  membership: {
    organizationId,
    role: "ADMIN",
    status: "ACTIVE",
    scopes: [{ type: "ORGANIZATION" }]
  }
};

async function cleanup(pool: Pool) {
  await pool.query(
    "DELETE FROM renter_invoice_public_links WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM organization_payment_profiles WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM renter_payment_allocations WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM renter_payment_transactions WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query("DELETE FROM renter_invoice_lines WHERE organization_id = $1", [
    organizationId
  ]);
  await pool.query("DELETE FROM renter_invoices WHERE organization_id = $1", [
    organizationId
  ]);
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
  await pool.query("DELETE FROM membership_scopes WHERE organization_id = $1", [
    organizationId
  ]);
  await pool.query(
    "DELETE FROM organization_memberships WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM organization_subscriptions WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query("DELETE FROM audit_events WHERE organization_id = $1", [
    organizationId
  ]);
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

test("public invoice token is opaque, revocable and reflects payment state", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const pool = new Pool({ connectionString });
  const database = new DatabaseService();
  const access = new AccessControlService();
  const commercial = new CommercialPolicyService();
  const payments = new RenterPaymentsService(database, access, commercial);
  const publicInvoices = new RenterPublicInvoiceService(
    database,
    access,
    commercial,
    payments
  );

  try {
    await cleanup(pool);

    await pool.query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, 'public-invoice-test@example.com', 'Public Invoice Test')`,
      [userId]
    );
    await pool.query(
      `INSERT INTO organizations (
         id, slug, name, organization_type, status
       ) VALUES (
         $1, 'public-invoice-test', 'Public Invoice Test', 'INDIVIDUAL', 'ACTIVE'
       )`,
      [organizationId]
    );
    await pool.query(
      `INSERT INTO organization_memberships (
         id, organization_id, user_id, role, status
       ) VALUES ($1, $2, $3, 'ADMIN', 'ACTIVE')`,
      [membershipId, organizationId, userId]
    );
    await pool.query(
      `INSERT INTO membership_scopes (
         organization_id, membership_id, scope_type
       ) VALUES ($1, $2, 'ORGANIZATION')`,
      [organizationId, membershipId]
    );
    await pool.query(
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
         now() - interval '1 day',
         now() + interval '29 days'
       FROM saas_plans p
       WHERE p.code = 'STARTER'`,
      [organizationId]
    );
    await pool.query(
      `INSERT INTO properties (
         id, organization_id, code, name, property_type
       ) VALUES ($1, $2, 'P1', 'Nhà trọ Test', 'BOARDING_HOUSE')`,
      [propertyId, organizationId]
    );
    await pool.query(
      `INSERT INTO rooms (
         id, organization_id, property_id, code, name
       ) VALUES ($1, $2, $3, 'A101', 'Phòng A101')`,
      [roomId, organizationId, propertyId]
    );
    await pool.query(
      `INSERT INTO leases (
         id, organization_id, room_id, lease_code, status, start_date,
         base_rent_vnd, deposit_required_vnd, billing_day
       ) VALUES (
         $1, $2, $3, 'LEASE-PUBLIC', 'ACTIVE', '2026-09-01',
         100000, 0, 1
       )`,
      [leaseId, organizationId, roomId]
    );
    await pool.query(
      `INSERT INTO renter_billing_cycles (
         id, organization_id, property_id, cycle_code,
         period_start, period_end, due_date, status
       ) VALUES (
         $1, $2, $3, '2026-09', '2026-09-01', '2026-09-30',
         '2026-10-05', 'FINALIZED'
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
         paid_vnd, remaining_vnd, collection_status,
         calculation_status, review_reasons, issued_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         'INV-PUBLIC-001', 'RENTPUBLIC001', 'ISSUED',
         '2026-09-01', '2026-09-30', '2026-10-05',
         'Nhà trọ Test', 'A101', 'LEASE-PUBLIC', 'Resident Secret Name',
         100000, 0, 0, 100000,
         0, 100000, 'UNPAID',
         'READY', '[]'::jsonb, now()
       )`,
      [invoiceId, organizationId, cycleId, propertyId, roomId, leaseId]
    );
    await pool.query(
      `INSERT INTO renter_invoice_lines (
         organization_id, invoice_id, line_type, description,
         quantity, unit_price_vnd, amount_vnd, sort_order
       ) VALUES ($1, $2, 'RENT', 'Tiền phòng', 1, 100000, 100000, 10)`,
      [organizationId, invoiceId]
    );

    const profile = await payments.updatePaymentProfile(principal, {
      bankId: "970422",
      accountNo: "123456789",
      accountName: "HABI TEST",
      vietQrTemplate: "compact2",
      isActive: true
    });
    assert.equal(profile.bankId, "970422");

    const issued = await publicInvoices.issueAccess(principal, invoiceId);
    assert.match(issued.token, /^habi_inv_[A-Za-z0-9_-]+$/);

    const stored = await pool.query<{ token_hash: string; token_hint: string }>(
      `SELECT token_hash, token_hint
       FROM renter_invoice_public_links
       WHERE organization_id = $1 AND invoice_id = $2 AND status = 'ACTIVE'`,
      [organizationId, invoiceId]
    );
    assert.equal(stored.rows.length, 1);
    assert.notEqual(stored.rows[0]?.token_hash, issued.token);
    assert.equal(stored.rows[0]?.token_hint, issued.token.slice(-6));

    const detail = await publicInvoices.detail(issued.token);
    assert.equal(detail.invoiceNumber, "INV-PUBLIC-001");
    assert.equal(detail.roomCode, "A101");
    assert.equal(detail.remainingVnd, 100000);
    assert.equal(detail.collectionStatus, "UNPAID");
    assert.equal(detail.lines.length, 1);
    assert.equal("primaryResidentName" in detail, false);
    assert.equal(detail.payment.configured, true);
    if (detail.payment.configured) {
      assert.match(detail.payment.qrImageUrl, /^https:\/\/img\.vietqr\.io\/image\//);
      assert.match(detail.payment.qrImageUrl, /amount=100000/);
      assert.match(detail.payment.qrImageUrl, /addInfo=RENTPUBLIC001/);
    }

    const rotated = await publicInvoices.issueAccess(principal, invoiceId);
    assert.notEqual(rotated.token, issued.token);
    await assert.rejects(
      () => publicInvoices.detail(issued.token),
      /invalid or no longer active/
    );

    await payments.createManualAllocation(principal, {
      transactionId,
      allocationId,
      invoiceId,
      amountVnd: 100000,
      occurredAt: new Date("2026-09-24T09:00:00.000Z").toISOString(),
      payerName: "Resident",
      note: "Integration test"
    });

    const paid = await publicInvoices.status(rotated.token);
    assert.equal(paid.collectionStatus, "PAID");
    assert.equal(paid.remainingVnd, 0);
    assert.equal(paid.paidVnd, 100000);

    const wrongTenant: TenantPrincipal = {
      ...principal,
      organizationId: "f2000000-0000-4000-8000-000000000099",
      organizationName: "Other",
      membership: {
        ...principal.membership,
        organizationId: "f2000000-0000-4000-8000-000000000099"
      }
    };
    await assert.rejects(
      () => publicInvoices.issueAccess(wrongTenant, invoiceId),
      /Renter invoice was not found/
    );

    const revoked = await publicInvoices.revokeAccess(principal, invoiceId);
    assert.equal(revoked.revoked, true);
    await assert.rejects(
      () => publicInvoices.detail(rotated.token),
      /invalid or no longer active/
    );
  } finally {
    await database.onModuleDestroy();
    await cleanup(pool);
    await pool.end();
  }
});
