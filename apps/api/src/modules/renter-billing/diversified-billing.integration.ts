import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { CommercialPolicyService } from "../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";
import { MeteringService } from "../metering/metering.service.js";
import { PricingService } from "../pricing/pricing.service.js";
import { RenterBillingService } from "./renter-billing.service.js";

const organizationId = "13000000-0000-4000-8000-000000000001";
const userId = "23000000-0000-4000-8000-000000000001";
const propertyId = "33000000-0000-4000-8000-000000000001";
const roomId = "43000000-0000-4000-8000-000000000001";
const leaseId = "53000000-0000-4000-8000-000000000001";
const residentId1 = "63000000-0000-4000-8000-000000000001";
const residentId2 = "63000000-0000-4000-8000-000000000002";
const cycleId = "73000000-0000-4000-8000-000000000001";
const pricingPolicyId = "91000000-0000-4000-8000-000000000002";
const vehicleId1 = "83000000-0000-4000-8000-000000000001";
const vehicleId2 = "83000000-0000-4000-8000-000000000002";

function principal(): TenantPrincipal {
  return {
    userId,
    membershipId: "83000000-0000-4000-8000-000000000003",
    organizationId,
    organizationName: "Diversified Billing Test",
    role: "OWNER",
    membership: {
      organizationId,
      role: "OWNER",
      status: "ACTIVE",
      scopes: [{ type: "ORGANIZATION" }]
    }
  };
}

async function cleanup(pool: Pool) {
  await pool.query("DELETE FROM renter_payment_allocations WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM renter_payment_transactions WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM renter_invoice_adjustments WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM renter_invoice_lines WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM renter_invoices WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM renter_billing_cycles WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM lease_vehicles WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM lease_residents WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM leases WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM residents WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM pricing_policy_items WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM pricing_policies WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM audit_events WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organization_entitlement_overrides WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organization_subscriptions WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organization_memberships WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM rooms WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM properties WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
}

test("diversified pricing calculates occupant count, vehicle parking, and adjustments accurately", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const accessControl = new AccessControlService();
  const commercialPolicy = new CommercialPolicyService();
  const pricing = new PricingService(database, accessControl, commercialPolicy);
  const metering = new MeteringService(database, accessControl, commercialPolicy);
  const service = new RenterBillingService(
    database,
    accessControl,
    commercialPolicy,
    pricing,
    metering
  );

  await cleanup(fixturePool);

  try {
    await fixturePool.query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, 'diversified-billing@example.invalid', 'Billing Admin')`,
      [userId]
    );
    await fixturePool.query(
      `INSERT INTO organizations (id, slug, name, organization_type)
       VALUES ($1, 'diversified-org', 'Diversified Org', 'INDIVIDUAL')`,
      [organizationId]
    );
    await fixturePool.query(
      `INSERT INTO organization_subscriptions (
         organization_id, plan_id, plan_version_id, status
       )
       SELECT $1, p.id, p.current_version_id, 'ACTIVE'
       FROM saas_plans p
       WHERE p.code = 'STARTER'`,
      [organizationId]
    );
    await fixturePool.query(
      `INSERT INTO organization_memberships (
         id, organization_id, user_id, role, status
       )
       VALUES ($1, $2, $3, 'OWNER', 'ACTIVE')`,
      [principal().membershipId, organizationId, userId]
    );
    await fixturePool.query(
      `INSERT INTO properties (id, organization_id, code, name, property_type)
       VALUES ($1, $2, 'DIV_P1', 'Tòa nhà Cầu Giấy', 'BOARDING_HOUSE')`,
      [propertyId, organizationId]
    );
    await fixturePool.query(
      `INSERT INTO rooms (id, organization_id, property_id, code, name)
       VALUES ($1, $2, $3, 'P301', 'Phòng 301')`,
      [roomId, organizationId, propertyId]
    );

    // Create 2 residents
    await fixturePool.query(
      `INSERT INTO residents (id, organization_id, full_name, phone)
       VALUES
         ($1, $3, 'Nguyễn Văn A', '0911111111'),
         ($2, $3, 'Trần Thị B', '0922222222')`,
      [residentId1, residentId2, organizationId]
    );

    // Create lease
    await fixturePool.query(
      `INSERT INTO leases (
         id, organization_id, room_id, lease_code, status,
         start_date, base_rent_vnd, deposit_required_vnd, billing_day
       )
       VALUES (
         $1, $2, $3, 'LEASE-DIV-01', 'ACTIVE',
         '2026-10-01', 3500000, 3500000, 1
       )`,
      [leaseId, organizationId, roomId]
    );

    // Add 2 active lease residents
    await fixturePool.query(
      `INSERT INTO lease_residents (
         organization_id, lease_id, resident_id, party_role, joined_on
       )
       VALUES
         ($1, $2, $3, 'PRIMARY_TENANT', '2026-10-01'),
         ($1, $2, $4, 'OCCUPANT', '2026-10-01')`,
      [organizationId, leaseId, residentId1, residentId2]
    );

    // Add 2 active vehicles
    await fixturePool.query(
      `INSERT INTO lease_vehicles (
         id, organization_id, lease_id, license_plate, vehicle_type, is_active, registered_at
       )
       VALUES
         ($1, $3, $4, '29B1-12345', 'MOTORBIKE', true, '2026-10-01'),
         ($2, $3, $4, '29B1-67890', 'MOTORBIKE', true, '2026-10-01')`,
      [vehicleId1, vehicleId2, organizationId, leaseId]
    );

    // Create Pricing Policy with diversified item types:
    // WATER_PER_PERSON: 50,000 VND / person
    // SERVICE_PER_PERSON: 30,000 VND / person
    // VEHICLE_PARKING: 100,000 VND / vehicle
    // WATER_PER_ROOM: 40,000 VND / room
    await pricing.createPolicy(principal(), {
      id: pricingPolicyId,
      propertyId,
      name: "Chính sách phí đa dạng 2026",
      effectiveFrom: "2026-10-01",
      items: [
        {
          id: "92000000-0000-4000-8000-000000000011",
          itemType: "WATER_PER_PERSON",
          description: "Nước sinh hoạt theo đầu người",
          unitPriceVnd: 50000,
          sortOrder: 1
        },
        {
          id: "92000000-0000-4000-8000-000000000012",
          itemType: "SERVICE_PER_PERSON",
          description: "Phí dịch vụ thang máy/vệ sinh",
          unitPriceVnd: 30000,
          sortOrder: 2
        },
        {
          id: "92000000-0000-4000-8000-000000000013",
          itemType: "VEHICLE_PARKING",
          description: "Gửi xe máy",
          unitPriceVnd: 100000,
          sortOrder: 3
        },
        {
          id: "92000000-0000-4000-8000-000000000014",
          itemType: "TRASH",
          description: "Phí rác cố định",
          unitPriceVnd: 40000,
          sortOrder: 4
        }
      ]
    });

    // Create billing cycle for 2026-10
    await service.createCycle(principal(), {
      id: cycleId,
      propertyId,
      code: "DIV-2026-10",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      dueDate: "2026-11-05"
    });

    // Generate rent drafts
    const drafts = await service.generateRentDrafts(principal(), cycleId);
    assert.equal(drafts.created, 1);
    assert.equal(drafts.eligibleLeaseCount, 1);

    // Query generated invoice lines
    const invoices = await fixturePool.query<{ id: string; total_vnd: string }>(
      `SELECT id, total_vnd::text
       FROM renter_invoices
       WHERE organization_id = $1 AND billing_cycle_id = $2`,
      [organizationId, cycleId]
    );
    assert.equal(invoices.rows.length, 1);
    const invoiceId = invoices.rows[0]!.id;

    const lines = await fixturePool.query<{
      line_type: string;
      description: string;
      quantity: string;
      unit_price_vnd: string;
      amount_vnd: string;
      snapshot: { itemType?: string; quantitySource?: string; occupantCount?: number; vehicleCount?: number };
    }>(
      `SELECT line_type, description, quantity::text, unit_price_vnd::text, amount_vnd::text, snapshot
       FROM renter_invoice_lines
       WHERE organization_id = $1 AND invoice_id = $2
       ORDER BY sort_order, id`,
      [organizationId, invoiceId]
    );

    // Expected lines:
    // 1. RENT: 3,500,000 VND
    // 2. WATER_PER_PERSON: 2 * 50,000 = 100,000 VND
    // 3. SERVICE_PER_PERSON: 2 * 30,000 = 60,000 VND
    // 4. VEHICLE_PARKING: 2 * 100,000 = 200,000 VND
    // 5. WATER_PER_ROOM: 1 * 40,000 = 40,000 VND
    // Total = 3,500,000 + 100,000 + 60,000 + 200,000 + 40,000 = 3,900,000 VND
    assert.equal(lines.rows.length, 5);

    const rentLine = lines.rows.find((l) => l.line_type === "RENT");
    assert.ok(rentLine);
    assert.equal(rentLine.amount_vnd, "3500000");

    const waterLine = lines.rows.find((l) => l.snapshot?.itemType === "WATER_PER_PERSON");
    assert.ok(waterLine, "Expected WATER_PER_PERSON invoice line");
    assert.equal(Number(waterLine.quantity), 2);
    assert.equal(waterLine.unit_price_vnd, "50000");
    assert.equal(waterLine.amount_vnd, "100000");
    assert.equal(waterLine.snapshot.occupantCount, 2);

    const serviceLine = lines.rows.find((l) => l.snapshot?.itemType === "SERVICE_PER_PERSON");
    assert.ok(serviceLine, "Expected SERVICE_PER_PERSON invoice line");
    assert.equal(Number(serviceLine.quantity), 2);
    assert.equal(serviceLine.unit_price_vnd, "30000");
    assert.equal(serviceLine.amount_vnd, "60000");

    const parkingLine = lines.rows.find((l) => l.snapshot?.itemType === "VEHICLE_PARKING");
    assert.ok(parkingLine, "Expected VEHICLE_PARKING invoice line");
    assert.equal(Number(parkingLine.quantity), 2);
    assert.equal(parkingLine.unit_price_vnd, "100000");
    assert.equal(parkingLine.amount_vnd, "200000");
    assert.equal(parkingLine.snapshot.vehicleCount, 2);

    const trashLine = lines.rows.find((l) => l.line_type === "TRASH" || l.snapshot?.itemType === "TRASH");
    assert.ok(trashLine, "Expected TRASH invoice line");
    assert.equal(trashLine.amount_vnd, "40000");

    assert.equal(invoices.rows[0]!.total_vnd, "3900000");

    // Test invoice adjustments (adding a DISCOUNT on DRAFT)
    const adjustmentResult = await service.applyAdjustment(principal(), invoiceId, {
      adjustmentType: "DISCOUNT",
      description: "Khuyến mãi đầu tháng",
      amountVnd: 100000
    });
    assert.equal(adjustmentResult.totalVnd, 3800000);

    // Verify invoice total updated in database
    const updatedInvoice = await fixturePool.query<{ total_vnd: string }>(
      "SELECT total_vnd::text FROM renter_invoices WHERE id = $1",
      [invoiceId]
    );
    assert.equal(updatedInvoice.rows[0]!.total_vnd, "3800000");

    // Remove adjustment
    const removeResult = await service.removeAdjustment(
      principal(),
      invoiceId,
      adjustmentResult.id
    );
    assert.equal(removeResult.totalVnd, 3900000);

    // Finalize the billing cycle
    const finalCycle = await service.finalizeCycle(principal(), cycleId);
    assert.equal(finalCycle.status, "FINALIZED");
    assert.equal(finalCycle.invoiceCount, 1);
  } finally {
    await database.onModuleDestroy();
    await cleanup(fixturePool);
    await fixturePool.end();
  }
});
