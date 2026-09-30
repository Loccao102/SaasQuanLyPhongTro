import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { CommercialPolicyService } from "../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";
import { MeteringService } from "../metering/metering.service.js";
import { PricingService } from "../pricing/pricing.service.js";
import { RenterPaymentsService } from "../renter-payments/renter-payments.service.js";
import { RenterBillingService } from "./renter-billing.service.js";

const organizationId = "12000000-0000-4000-8000-000000000001";
const userId = "22000000-0000-4000-8000-000000000001";
const propertyId = "32000000-0000-4000-8000-000000000001";
const roomId = "42000000-0000-4000-8000-000000000001";
const roomId2 = "42000000-0000-4000-8000-000000000002";
const leaseId = "52000000-0000-4000-8000-000000000001";
const leaseId2 = "52000000-0000-4000-8000-000000000002";
const residentId = "62000000-0000-4000-8000-000000000001";
const residentId2 = "62000000-0000-4000-8000-000000000002";
const cycleId = "72000000-0000-4000-8000-000000000001";
const cycleId2 = "72000000-0000-4000-8000-000000000002";
const pricingPolicyId = "91000000-0000-4000-8000-000000000001";
const electricityItemId = "92000000-0000-4000-8000-000000000001";
const waterItemId = "92000000-0000-4000-8000-000000000002";
const internetItemId = "92000000-0000-4000-8000-000000000003";
const electricityMeterId = "93000000-0000-4000-8000-000000000001";
const waterMeterId = "93000000-0000-4000-8000-000000000002";

function principal(): TenantPrincipal {
  return {
    userId,
    membershipId: "82000000-0000-4000-8000-000000000001",
    organizationId,
    organizationName: "Renter Billing Test",
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
  await pool.query("DELETE FROM renter_invoice_lines WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM renter_invoices WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM renter_billing_cycles WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM meter_readings WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM meters WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM pricing_policy_items WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM pricing_policies WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM lease_command_receipts WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM lease_terminations WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM lease_residents WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM leases WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM residents WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM audit_events WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organization_entitlement_overrides WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organization_subscriptions WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organization_memberships WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM rooms WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM properties WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

test("renter billing snapshots rent, utilities and services and blocks incomplete or partial-period invoices", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const accessControl = new AccessControlService();
  const commercialPolicy = new CommercialPolicyService();
  const pricing = new PricingService(
    database,
    accessControl,
    commercialPolicy
  );
  const metering = new MeteringService(
    database,
    accessControl,
    commercialPolicy
  );
  const service = new RenterBillingService(
    database,
    accessControl,
    commercialPolicy,
    pricing,
    metering
  );
  const payments = new RenterPaymentsService(
    database,
    accessControl,
    commercialPolicy
  );

  try {
    await cleanup(fixturePool);

    await fixturePool.query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, 'renter-billing-test@example.invalid', 'Renter Billing Test')`,
      [userId]
    );
    await fixturePool.query(
      `INSERT INTO organizations (id, slug, name, organization_type)
       VALUES ($1, 'renter-billing-test', 'Renter Billing Test', 'INDIVIDUAL')`,
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
      `INSERT INTO properties (
         id, organization_id, code, name, property_type
       )
       VALUES ($1, $2, 'RB1', 'Renter Billing Property', 'BOARDING_HOUSE')`,
      [propertyId, organizationId]
    );
    await fixturePool.query(
      `INSERT INTO rooms (
         id, organization_id, property_id, code, name
       )
       VALUES
       ($1, $3, $4, '101', 'Room 101'),
       ($2, $3, $4, '102', 'Room 102')`,
      [roomId, roomId2, organizationId, propertyId]
    );
    await fixturePool.query(
      `INSERT INTO residents (id, organization_id, full_name, phone)
       VALUES ($1, $3, 'Tenant Full Period', '0901000001'),
              ($2, $3, 'Tenant Partial Period', '0901000002')`,
      [residentId, residentId2, organizationId]
    );
    await fixturePool.query(
      `INSERT INTO leases (
         id, organization_id, room_id, lease_code, status,
         start_date, base_rent_vnd, deposit_required_vnd, billing_day
       )
       VALUES (
         $1, $2, $3, 'LEASE-RB-1', 'ACTIVE',
         '2026-09-01', 3500000, 3500000, 5
       )`,
      [leaseId, organizationId, roomId]
    );
    await fixturePool.query(
      `INSERT INTO lease_residents (
         organization_id, lease_id, resident_id, party_role, joined_on
       )
       VALUES ($1, $2, $3, 'PRIMARY_TENANT', '2026-09-01')`,
      [organizationId, leaseId, residentId]
    );

    const policy = await pricing.createPolicy(principal(), {
      id: pricingPolicyId,
      propertyId,
      name: "Biểu giá cuối 2026",
      effectiveFrom: "2026-10-01",
      effectiveTo: "2026-11-30",
      items: [
        {
          id: electricityItemId,
          itemType: "ELECTRICITY_PER_KWH",
          description: "Tiền điện",
          unitPriceVnd: 3500,
          sortOrder: 20
        },
        {
          id: waterItemId,
          itemType: "WATER_PER_M3",
          description: "Tiền nước",
          unitPriceVnd: 15000,
          sortOrder: 30
        },
        {
          id: internetItemId,
          itemType: "INTERNET",
          description: "Internet",
          unitPriceVnd: 100000,
          fixedQuantity: 1,
          sortOrder: 40
        }
      ]
    });
    assert.equal(policy.items.length, 3);

    const ownerPricing = await pricing.listForProperty(principal(), propertyId);
    assert.equal(ownerPricing.permissions.manage, true);
    assert.equal(ownerPricing.policies.length, 1);

    const viewer = principal();
    viewer.role = "VIEWER";
    viewer.membership = {
      ...viewer.membership,
      role: "VIEWER"
    };
    const viewerPricing = await pricing.listForProperty(viewer, propertyId);
    assert.equal(viewerPricing.permissions.manage, false);
    assert.equal(viewerPricing.policies.length, 1);
    assert.deepEqual(
      await pricing.createPolicy(principal(), {
        id: pricingPolicyId,
        propertyId,
        name: "Biểu giá cuối 2026",
        effectiveFrom: "2026-10-01",
        effectiveTo: "2026-11-30",
        items: [
          {
            id: electricityItemId,
            itemType: "ELECTRICITY_PER_KWH",
            description: "Tiền điện",
            unitPriceVnd: 3500,
            sortOrder: 20
          },
          {
            id: waterItemId,
            itemType: "WATER_PER_M3",
            description: "Tiền nước",
            unitPriceVnd: 15000,
            sortOrder: 30
          },
          {
            id: internetItemId,
            itemType: "INTERNET",
            description: "Internet",
            unitPriceVnd: 100000,
            fixedQuantity: 1,
            sortOrder: 40
          }
        ]
      }),
      policy
    );

    await metering.createMeter(principal(), {
      id: electricityMeterId,
      roomId,
      meterType: "ELECTRICITY",
      label: "Điện phòng 101"
    });
    await metering.createMeter(principal(), {
      id: waterMeterId,
      roomId,
      meterType: "WATER",
      label: "Nước phòng 101"
    });

    const created = await service.createCycle(principal(), {
      id: cycleId,
      propertyId,
      code: "RB-2026-10",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      dueDate: "2026-11-05"
    });
    const retry = await service.createCycle(principal(), {
      id: cycleId,
      propertyId,
      code: "RB-2026-10",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      dueDate: "2026-11-05"
    });
    assert.deepEqual(retry, created);

    const incomplete = await service.generateRentDrafts(principal(), cycleId);
    assert.deepEqual(incomplete, {
      cycleId,
      created: 1,
      refreshed: 0,
      eligibleLeaseCount: 1,
      partialLeaseCount: 0,
      reviewRequiredInvoiceCount: 1,
      requiresReview: true
    });
    await assert.rejects(
      () => service.finalizeCycle(principal(), cycleId),
      /pricing or meter review/
    );

    const electricityStart = await metering.addReading(
      principal(),
      electricityMeterId,
      {
        id: "94000000-0000-4000-8000-000000000001",
        readingDate: "2026-10-01",
        readingValue: "1000.000"
      }
    );
    assert.deepEqual(
      await metering.addReading(principal(), electricityMeterId, {
        id: "94000000-0000-4000-8000-000000000001",
        readingDate: "2026-10-01",
        readingValue: "1000.000"
      }),
      electricityStart
    );
    await metering.addReading(principal(), electricityMeterId, {
      id: "94000000-0000-4000-8000-000000000002",
      readingDate: "2026-10-31",
      readingValue: "1120.500"
    });
    await metering.addReading(principal(), waterMeterId, {
      id: "94000000-0000-4000-8000-000000000003",
      readingDate: "2026-10-01",
      readingValue: "50.000"
    });
    await metering.addReading(principal(), waterMeterId, {
      id: "94000000-0000-4000-8000-000000000004",
      readingDate: "2026-10-31",
      readingValue: "54.000"
    });

    const generated = await service.generateRentDrafts(principal(), cycleId);
    assert.deepEqual(generated, {
      cycleId,
      created: 0,
      refreshed: 1,
      eligibleLeaseCount: 1,
      partialLeaseCount: 0,
      reviewRequiredInvoiceCount: 0,
      requiresReview: false
    });

    const detailBeforeIssue = await service.detail(principal(), cycleId);
    assert.equal(detailBeforeIssue.invoices.length, 1);
    const octoberInvoice = detailBeforeIssue.invoices[0]!;
    assert.equal(octoberInvoice.status, "DRAFT");
    assert.equal(octoberInvoice.calculationStatus, "READY");
    assert.deepEqual(octoberInvoice.reviewReasons, []);
    assert.ok(octoberInvoice.calculatedAt);
    assert.equal(octoberInvoice.totalVnd, 4081750);
    assert.equal(octoberInvoice.lines.length, 4);
    assert.deepEqual(
      octoberInvoice.lines.map((line) => [line.type, line.amountVnd]),
      [
        ["RENT", 3500000],
        ["ELECTRICITY", 421750],
        ["WATER", 60000],
        ["SERVICE", 100000]
      ]
    );
    assert.equal(octoberInvoice.lines[1]?.quantity, "120.500");
    assert.equal(octoberInvoice.lines[2]?.quantity, "4.000");

    const generatedRetry = await service.generateRentDrafts(
      principal(),
      cycleId
    );
    assert.equal(generatedRetry.created, 0);
    assert.equal(generatedRetry.refreshed, 1);
    const detailAfterRetry = await service.detail(principal(), cycleId);
    assert.equal(detailAfterRetry.invoices[0]?.lines.length, 4);
    assert.equal(detailAfterRetry.invoices[0]?.totalVnd, 4081750);

    const finalized = await service.finalizeCycle(principal(), cycleId);
    assert.deepEqual(finalized, {
      cycleId,
      status: "FINALIZED",
      invoiceCount: 1,
      totalVnd: 4081750
    });
    assert.deepEqual(
      await service.finalizeCycle(principal(), cycleId),
      finalized
    );

    const detailAfterIssue = await service.detail(principal(), cycleId);
    const issuedInvoice = detailAfterIssue.invoices[0]!;
    assert.equal(issuedInvoice.status, "ISSUED");
    assert.ok(issuedInvoice.issuedAt);
    assert.equal(issuedInvoice.paidVnd, 0);
    assert.equal(issuedInvoice.remainingVnd, 4081750);
    assert.equal(issuedInvoice.collectionStatus, "UNPAID");

    const firstPaymentInput = {
      transactionId: "95000000-0000-4000-8000-000000000001",
      allocationId: "96000000-0000-4000-8000-000000000001",
      invoiceId: issuedInvoice.id,
      amountVnd: 1000000,
      occurredAt: "2026-11-02T03:00:00.000Z",
      payerName: "Tenant Full Period",
      note: "Chuyển khoản đợt 1"
    };
    const firstPayment = await payments.createManualAllocation(
      principal(),
      firstPaymentInput
    );
    assert.equal(firstPayment.invoice.paidVnd, 1000000);
    assert.equal(firstPayment.invoice.remainingVnd, 3081750);
    assert.equal(firstPayment.invoice.collectionStatus, "PARTIALLY_PAID");
    assert.equal(firstPayment.allocations.length, 1);
    assert.deepEqual(
      await payments.createManualAllocation(principal(), firstPaymentInput),
      firstPayment
    );

    await assert.rejects(
      () =>
        payments.createManualAllocation(principal(), {
          transactionId: "95000000-0000-4000-8000-000000000002",
          allocationId: "96000000-0000-4000-8000-000000000002",
          invoiceId: issuedInvoice.id,
          amountVnd: 4000000,
          occurredAt: "2026-11-03T03:00:00.000Z",
          payerName: "Tenant Full Period",
          note: "Overpay should fail"
        }),
      /exceeds invoice remaining amount/
    );

    const secondPayment = await payments.createManualAllocation(principal(), {
      transactionId: "95000000-0000-4000-8000-000000000003",
      allocationId: "96000000-0000-4000-8000-000000000003",
      invoiceId: issuedInvoice.id,
      amountVnd: 3081750,
      occurredAt: "2026-11-04T03:00:00.000Z",
      payerName: "Tenant Full Period",
      note: "Thanh toán phần còn lại"
    });
    assert.equal(secondPayment.invoice.paidVnd, 4081750);
    assert.equal(secondPayment.invoice.remainingVnd, 0);
    assert.equal(secondPayment.invoice.collectionStatus, "PAID");
    assert.equal(secondPayment.allocations.length, 2);

    const paymentDetail = await payments.detail(principal(), issuedInvoice.id);
    assert.equal(paymentDetail.permissions.reconcile, true);
    assert.equal(paymentDetail.invoice.collectionStatus, "PAID");
    assert.equal(paymentDetail.allocations.length, 2);

    const paymentViewer = principal();
    paymentViewer.role = "VIEWER";
    paymentViewer.membership = {
      ...paymentViewer.membership,
      role: "VIEWER"
    };
    const viewerPaymentDetail = await payments.detail(
      paymentViewer,
      issuedInvoice.id
    );
    assert.equal(viewerPaymentDetail.permissions.reconcile, false);
    assert.equal(viewerPaymentDetail.invoice.collectionStatus, "PAID");

    await assert.rejects(
      () =>
        payments.createManualAllocation(principal(), {
          transactionId: "95000000-0000-4000-8000-000000000004",
          allocationId: "96000000-0000-4000-8000-000000000004",
          invoiceId: issuedInvoice.id,
          amountVnd: 1,
          occurredAt: "2026-11-05T03:00:00.000Z"
        }),
      /already fully paid/
    );

    await metering.addReading(principal(), electricityMeterId, {
      id: "94000000-0000-4000-8000-000000000005",
      readingDate: "2026-11-30",
      readingValue: "1200.500"
    });
    await metering.addReading(principal(), waterMeterId, {
      id: "94000000-0000-4000-8000-000000000006",
      readingDate: "2026-11-30",
      readingValue: "59.000"
    });

    await fixturePool.query(
      `INSERT INTO leases (
         id, organization_id, room_id, lease_code, status,
         start_date, base_rent_vnd, deposit_required_vnd, billing_day
       )
       VALUES (
         $1, $2, $3, 'LEASE-RB-2', 'ACTIVE',
         '2026-11-10', 2800000, 2800000, 5
       )`,
      [leaseId2, organizationId, roomId2]
    );
    await fixturePool.query(
      `INSERT INTO lease_residents (
         organization_id, lease_id, resident_id, party_role, joined_on
       )
       VALUES ($1, $2, $3, 'PRIMARY_TENANT', '2026-11-10')`,
      [organizationId, leaseId2, residentId2]
    );

    await service.createCycle(principal(), {
      id: cycleId2,
      propertyId,
      code: "RB-2026-11",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
      dueDate: "2026-12-05"
    });
    const november = await service.generateRentDrafts(principal(), cycleId2);
    assert.equal(november.created, 1);
    assert.equal(november.eligibleLeaseCount, 1);
    assert.equal(november.partialLeaseCount, 1);
    assert.equal(november.reviewRequiredInvoiceCount, 0);
    assert.equal(november.requiresReview, true);

    await assert.rejects(
      () => service.finalizeCycle(principal(), cycleId2),
      /partial-period leases/
    );

    const list = await service.list(principal());
    assert.equal(list.cycles.length, 2);

    const audits = await fixturePool.query<{ action: string }>(
      `SELECT action
       FROM audit_events
       WHERE organization_id = $1
       ORDER BY occurred_at, id`,
      [organizationId]
    );
    for (const action of [
      "PRICING_POLICY_CREATED",
      "METER_CREATED",
      "METER_READING_RECORDED",
      "RENTER_BILLING_CYCLE_CREATED",
      "RENTER_RENT_DRAFTS_GENERATED",
      "RENTER_BILLING_CYCLE_FINALIZED",
      "RENTER_PAYMENT_MANUALLY_ALLOCATED"
    ]) {
      assert.ok(
        audits.rows.some((row) => row.action === action),
        "expected audit action " + action
      );
    }
  } finally {
    await database.onModuleDestroy();
    await cleanup(fixturePool);
    await fixturePool.end();
  }
});

async function cleanupOrg(pool: Pool, orgId: string, uId: string) {
  await pool.query("DELETE FROM renter_payment_allocations WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM renter_payment_transactions WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM renter_invoice_lines WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM renter_invoices WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM renter_billing_cycles WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM meter_readings WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM meters WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM pricing_policy_items WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM pricing_policies WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM lease_command_receipts WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM lease_terminations WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM lease_residents WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM leases WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM residents WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM audit_events WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM organization_entitlement_overrides WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM organization_subscriptions WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM organization_memberships WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM rooms WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM properties WHERE organization_id = $1", [orgId]);
  await pool.query("DELETE FROM organizations WHERE id = $1", [orgId]);
  await pool.query("DELETE FROM users WHERE id = $1", [uId]);
}

test("previous debt carry-forward policy rolls unpaid balance into next cycle and reactively clears upon payment", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const accessControl = new AccessControlService();
  const commercialPolicy = new CommercialPolicyService();
  const pricing = new PricingService(database, accessControl, commercialPolicy);
  const metering = new MeteringService(database, accessControl, commercialPolicy);
  const service = new RenterBillingService(database, accessControl, commercialPolicy, pricing, metering);
  const payments = new RenterPaymentsService(database, accessControl, commercialPolicy);

  const orgId = "12000000-0000-4000-8000-000000000009";
  const uId = "22000000-0000-4000-8000-000000000009";
  const pId = "32000000-0000-4000-8000-000000000009";
  const rId = "42000000-0000-4000-8000-000000000009";
  const lId = "52000000-0000-4000-8000-000000000009";
  const resId = "62000000-0000-4000-8000-000000000009";
  const c1Id = "72000000-0000-4000-8000-000000000009";
  const c2Id = "72000000-0000-4000-8000-00000000000a";
  const polId = "91000000-0000-4000-8000-000000000009";

  const p = (): TenantPrincipal => ({
    userId: uId,
    membershipId: "82000000-0000-4000-8000-000000000009",
    organizationId: orgId,
    organizationName: "Carry Forward Test Org",
    role: "OWNER",
    membership: {
      organizationId: orgId,
      role: "OWNER",
      status: "ACTIVE",
      scopes: [{ type: "ORGANIZATION" }]
    }
  });

  try {
    await cleanupOrg(fixturePool, orgId, uId);

    await fixturePool.query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, 'carry-forward-test@example.invalid', 'Carry Forward Test')`,
      [uId]
    );
    await fixturePool.query(
      `INSERT INTO organizations (id, slug, name, organization_type)
       VALUES ($1, 'carry-forward-test', 'Carry Forward Test', 'INDIVIDUAL')`,
      [orgId]
    );
    await fixturePool.query(
      `INSERT INTO organization_subscriptions (
         organization_id, plan_id, plan_version_id, status
       )
       SELECT $1, p.id, p.current_version_id, 'ACTIVE'
       FROM saas_plans p
       WHERE p.code = 'STARTER'`,
      [orgId]
    );
    await fixturePool.query(
      `INSERT INTO properties (id, organization_id, code, name, property_type)
       VALUES ($1, $2, 'PROP-CF', 'Carry Forward Property', 'BOARDING_HOUSE')`,
      [pId, orgId]
    );
    await fixturePool.query(
      `INSERT INTO rooms (id, organization_id, property_id, code, name)
       VALUES ($1, $2, $3, 'CF101', 'Room CF 101')`,
      [rId, orgId, pId]
    );
    await fixturePool.query(
      `INSERT INTO residents (id, organization_id, full_name, phone)
       VALUES ($1, $2, 'Resident CF', '0909999999')`,
      [resId, orgId]
    );
    await fixturePool.query(
      `INSERT INTO leases (
         id, organization_id, room_id, lease_code, status,
         start_date, base_rent_vnd, deposit_required_vnd, billing_day
       )
       VALUES ($1, $2, $3, 'LEASE-CF-1', 'ACTIVE', '2026-08-01', 3000000, 3000000, 5)`,
      [lId, orgId, rId]
    );
    await fixturePool.query(
      `INSERT INTO lease_residents (organization_id, lease_id, resident_id, party_role, joined_on)
       VALUES ($1, $2, $3, 'PRIMARY_TENANT', '2026-08-01')`,
      [orgId, lId, resId]
    );

    // Create pricing policy
    await pricing.createPolicy(p(), {
      id: polId,
      propertyId: pId,
      name: "Standard CF Pricing",
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      items: []
    });

    // 1. Create cycle 1 (August 2026)
    await service.createCycle(p(), {
      id: c1Id,
      propertyId: pId,
      code: "CF-2026-08",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      dueDate: "2026-09-05"
    });

    // Generate cycle 1 drafts
    const c1Drafts = await service.generateRentDrafts(p(), c1Id);
    assert.equal(c1Drafts.created, 1);
    assert.equal(c1Drafts.eligibleLeaseCount, 1);
    assert.equal(c1Drafts.reviewRequiredInvoiceCount, 0);

    // Check cycle 1 invoice: previousBalance should be 0
    const c1Detail = await service.detail(p(), c1Id);
    assert.equal(c1Detail.invoices.length, 1);
    const inv1 = c1Detail.invoices[0]!;
    assert.equal(inv1.previousBalanceVnd, 0);
    assert.equal(inv1.subtotalVnd, 3000000);
    assert.equal(inv1.totalVnd, 3000000);
    assert.equal(inv1.remainingVnd, 3000000);

    // Finalize cycle 1 (ISSUED)
    await service.finalizeCycle(p(), c1Id);

    // 2. Create cycle 2 (September 2026) - Cycle 1 remains completely unpaid (remaining = 3,000,000)
    await service.createCycle(p(), {
      id: c2Id,
      propertyId: pId,
      code: "CF-2026-09",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      dueDate: "2026-10-05"
    });

    const c2Drafts = await service.generateRentDrafts(p(), c2Id);
    assert.equal(c2Drafts.created, 1);

    let c2Detail = await service.detail(p(), c2Id);
    let inv2 = c2Detail.invoices[0]!;
    assert.equal(inv2.previousBalanceVnd, 3000000, "Cycle 2 must carry forward 3,000,000 previous debt");
    assert.equal(inv2.subtotalVnd, 3000000);
    assert.equal(inv2.totalVnd, 6000000, "Total must be subtotal + previous balance");
    assert.equal(inv2.remainingVnd, 6000000);

    const prevDebtLine = inv2.lines.find((l) => l.type === "PREVIOUS_DEBT");
    assert.ok(prevDebtLine, "Must have PREVIOUS_DEBT line item");
    assert.equal(prevDebtLine.amountVnd, 3000000);
    assert.equal(prevDebtLine.description, "Nợ cũ kỳ trước chuyển sang");

    // 3. Partial payment of 1,000,000 on Cycle 1 invoice
    await payments.createManualAllocation(p(), {
      transactionId: "95000000-0000-4000-8000-000000000009",
      allocationId: "96000000-0000-4000-8000-000000000009",
      invoiceId: inv1.id,
      amountVnd: 1000000,
      occurredAt: "2026-09-02T10:00:00.000Z",
      note: "Partial payment of cycle 1"
    });

    // Refresh Cycle 2 drafts
    await service.generateRentDrafts(p(), c2Id);
    c2Detail = await service.detail(p(), c2Id);
    inv2 = c2Detail.invoices[0]!;
    assert.equal(inv2.previousBalanceVnd, 2000000, "Previous balance should reactively update to 2,000,000");
    assert.equal(inv2.totalVnd, 5000000);
    assert.equal(inv2.remainingVnd, 5000000);

    // 4. Pay remaining 2,000,000 on Cycle 1 invoice
    await payments.createManualAllocation(p(), {
      transactionId: "95000000-0000-4000-8000-00000000000a",
      allocationId: "96000000-0000-4000-8000-00000000000a",
      invoiceId: inv1.id,
      amountVnd: 2000000,
      occurredAt: "2026-09-03T10:00:00.000Z",
      note: "Final payment of cycle 1"
    });

    // Refresh Cycle 2 drafts again
    await service.generateRentDrafts(p(), c2Id);
    c2Detail = await service.detail(p(), c2Id);
    inv2 = c2Detail.invoices[0]!;
    assert.equal(inv2.previousBalanceVnd, 0, "Previous balance should become 0 after full payment");
    assert.equal(inv2.totalVnd, 3000000);
    assert.equal(inv2.remainingVnd, 3000000);
    assert.equal(inv2.lines.some((l) => l.type === "PREVIOUS_DEBT"), false, "PREVIOUS_DEBT line should be removed");

    // Check audit event
    const audits = await fixturePool.query<{ action: string; payload: Record<string, unknown> }>(
      `SELECT action, payload
       FROM audit_events
       WHERE organization_id = $1
         AND action = 'RENTER_RENT_DRAFTS_GENERATED'
       ORDER BY occurred_at DESC
       LIMIT 1`,
      [orgId]
    );
    assert.equal(audits.rows[0]?.payload.previousDebtPolicy, "PREVIOUS_DEBT_CARRY_FORWARD_V1");
  } finally {
    await database.onModuleDestroy();
    await cleanupOrg(fixturePool, orgId, uId);
    await fixturePool.end();
  }
});
