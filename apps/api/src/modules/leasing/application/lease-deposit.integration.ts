import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";
import { LeaseAdminService } from "./lease-admin.service.js";
import { LeaseDepositService } from "./lease-deposit.service.js";

const organizationId = "12000000-0000-4000-8000-000000000001";
const otherOrganizationId = "12000000-0000-4000-8000-000000000002";
const userId = "22000000-0000-4000-8000-000000000001";
const propertyId = "32000000-0000-4000-8000-000000000001";
const roomId = "42000000-0000-4000-8000-000000000001";
const leaseId = "52000000-0000-4000-8000-000000000001";
const residentId = "62000000-0000-4000-8000-000000000001";

function principal(
  orgId: string = organizationId,
  role: TenantPrincipal["role"] = "OWNER"
): TenantPrincipal {
  return {
    userId,
    membershipId: "72000000-0000-4000-8000-000000000001",
    organizationId: orgId,
    organizationName: "Lease Deposit Test Org",
    role,
    membership: {
      organizationId: orgId,
      role,
      status: "ACTIVE",
      scopes: [{ type: "ORGANIZATION" as const }]
    }
  };
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM lease_deposit_movements WHERE organization_id IN ($1, $2)", [organizationId, otherOrganizationId]);
  await pool.query("DELETE FROM lease_deposits WHERE organization_id IN ($1, $2)", [organizationId, otherOrganizationId]);
  await pool.query("DELETE FROM lease_command_receipts WHERE organization_id IN ($1, $2)", [organizationId, otherOrganizationId]);
  await pool.query("DELETE FROM lease_terminations WHERE organization_id IN ($1, $2)", [organizationId, otherOrganizationId]);
  await pool.query("DELETE FROM lease_residents WHERE organization_id IN ($1, $2)", [organizationId, otherOrganizationId]);
  await pool.query("DELETE FROM leases WHERE organization_id IN ($1, $2)", [organizationId, otherOrganizationId]);
  await pool.query("DELETE FROM residents WHERE organization_id IN ($1, $2)", [organizationId, otherOrganizationId]);
  await pool.query("DELETE FROM audit_events WHERE organization_id IN ($1, $2)", [organizationId, otherOrganizationId]);
  await pool.query("DELETE FROM organization_subscriptions WHERE organization_id IN ($1, $2)", [organizationId, otherOrganizationId]);
  await pool.query("DELETE FROM organization_memberships WHERE organization_id IN ($1, $2)", [organizationId, otherOrganizationId]);
  await pool.query("DELETE FROM rooms WHERE organization_id IN ($1, $2)", [organizationId, otherOrganizationId]);
  await pool.query("DELETE FROM floors WHERE organization_id IN ($1, $2)", [organizationId, otherOrganizationId]);
  await pool.query("DELETE FROM properties WHERE organization_id IN ($1, $2)", [organizationId, otherOrganizationId]);
  await pool.query("DELETE FROM organizations WHERE id IN ($1, $2)", [organizationId, otherOrganizationId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

test("deposit collection, idempotency, settlement, and termination readiness integration", async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Skip integration test when DATABASE_URL is not configured
    return;
  }

  const pool = new Pool({ connectionString });
  const database = new DatabaseService();
  const accessControl = new AccessControlService();
  const commercialPolicy = new CommercialPolicyService();
  const depositService = new LeaseDepositService(database, accessControl, commercialPolicy);
  const adminService = new LeaseAdminService(database, accessControl, commercialPolicy, depositService);

  try {
    await cleanup(pool);

    await pool.query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, 'lease-deposit-test@example.invalid', 'Lease Deposit Test User')`,
      [userId]
    );

    await pool.query(
      `INSERT INTO organizations (id, slug, name, organization_type)
       VALUES
         ($1, 'lease-deposit-test', 'Lease Deposit Test Org', 'INDIVIDUAL'),
         ($2, 'other-org-test', 'Other Org', 'INDIVIDUAL')`,
      [organizationId, otherOrganizationId]
    );

    await pool.query(
      `INSERT INTO organization_subscriptions (
         organization_id, plan_id, plan_version_id, status
       )
       SELECT $1, p.id, p.current_version_id, 'ACTIVE'
       FROM saas_plans p
       WHERE p.code = 'STARTER'`,
      [organizationId]
    );

    await pool.query(
      `INSERT INTO properties (id, organization_id, code, name, property_type)
       VALUES ($1, $2, 'PROP-DEP', 'Deposit Test Property', 'BOARDING_HOUSE')`,
      [propertyId, organizationId]
    );

    await pool.query(
      `INSERT INTO rooms (id, organization_id, property_id, code, name)
       VALUES ($1, $2, $3, 'ROOM-DEP', 'Deposit Room')`,
      [roomId, organizationId, propertyId]
    );

    await pool.query(
      `INSERT INTO residents (id, organization_id, full_name, phone)
       VALUES ($1, $2, 'Nguyen Van Coc', '0901234567')`,
      [residentId, organizationId]
    );

    await pool.query(
      `INSERT INTO leases (
         id, organization_id, room_id, lease_code, status,
         start_date, base_rent_vnd, deposit_required_vnd, billing_day
       ) VALUES ($1, $2, $3, 'LEASE-DEP-01', 'ACTIVE', '2026-10-01', 4000000, 3000000, 1)`,
      [leaseId, organizationId, roomId]
    );

    await pool.query(
      `INSERT INTO lease_residents (
         organization_id, lease_id, resident_id, party_role, joined_on
       ) VALUES ($1, $2, $3, 'PRIMARY_TENANT', '2026-10-01')`,
      [organizationId, leaseId, residentId]
    );

    // 1. Initial summary before collection
    const initialDetail = await adminService.detail(principal(), leaseId);
    assert.equal(initialDetail.deposit.status, "UNPAID");
    assert.equal(initialDetail.deposit.depositRequiredVnd, 3000000);
    assert.equal(initialDetail.deposit.totalCollectedVnd, 0);
    assert.equal(initialDetail.deposit.remainingHeldVnd, 0);
    assert.equal(initialDetail.deposit.movements.length, 0);

    // 2. Collect partial deposit (2,000,000 VND)
    const collectKey1 = "deposit-collect-1";
    const partialCollect = await depositService.collectDeposit(principal(), leaseId, {
      idempotencyKey: collectKey1,
      amountVnd: 2000000,
      paymentMethod: "BANK_TRANSFER",
      reference: "FT2609001",
      notes: "Cọc đợt 1"
    });

    assert.equal(partialCollect.status, "PARTIALLY_PAID");
    assert.equal(partialCollect.totalCollectedVnd, 2000000);
    assert.equal(partialCollect.remainingHeldVnd, 2000000);
    assert.equal(partialCollect.movements.length, 1);
    assert.equal(partialCollect.movements[0]?.movementType, "COLLECTION");

    // Idempotency: replaying collectKey1 returns exact same response
    const replayCollect = await depositService.collectDeposit(principal(), leaseId, {
      idempotencyKey: collectKey1,
      amountVnd: 2000000
    });
    assert.equal(replayCollect.totalCollectedVnd, 2000000);

    // 3. Collect remaining deposit (1,000,000 VND) -> becomes HELD
    const fullCollect = await depositService.collectDeposit(principal(), leaseId, {
      idempotencyKey: "deposit-collect-2",
      amountVnd: 1000000,
      paymentMethod: "CASH",
      notes: "Cọc đợt 2 đủ"
    });
    assert.equal(fullCollect.status, "HELD");
    assert.equal(fullCollect.totalCollectedVnd, 3000000);
    assert.equal(fullCollect.remainingHeldVnd, 3000000);
    assert.equal(fullCollect.movements.length, 2);

    // 4. Schedule termination to test auto-readiness integration
    await pool.query(
      `INSERT INTO lease_terminations (
         organization_id, lease_id, status, effective_date, reason,
         meter_readiness, financial_readiness, deposit_readiness
       ) VALUES ($1, $2, 'SCHEDULED', '2027-04-30', 'Tra phong som', 'READY', 'READY', 'PENDING')`,
      [organizationId, leaseId]
    );

    // Verify termination deposit_readiness is PENDING
    const termBefore = await pool.query<{ deposit_readiness: string; status: string }>(
      "SELECT deposit_readiness, status FROM lease_terminations WHERE organization_id = $1 AND lease_id = $2",
      [organizationId, leaseId]
    );
    assert.equal(termBefore.rows[0]?.deposit_readiness, "PENDING");
    assert.equal(termBefore.rows[0]?.status, "SCHEDULED");

    // 5. Settle deposit: 500,000 VND deduction (hư hỏng thiết bị) + 2,500,000 VND refund
    const settleKey = "deposit-settle-1";
    const settled = await depositService.settleDeposit(principal(), leaseId, {
      idempotencyKey: settleKey,
      deductionAmountVnd: 500000,
      refundAmountVnd: 2500000,
      deductionReason: "Khấu trừ sửa máy lạnh",
      refundReference: "REF-260901",
      notes: "Quyết toán hoàn tất chuyển khoản trả khách"
    });

    assert.equal(settled.status, "SETTLED");
    assert.equal(settled.totalDeductedVnd, 500000);
    assert.equal(settled.totalRefundedVnd, 2500000);
    assert.equal(settled.remainingHeldVnd, 0);
    assert.equal(settled.movements.length, 4); // 2 collections + 1 deduction + 1 refund

    // Idempotency: replaying settleKey returns same result
    const replaySettle = await depositService.settleDeposit(principal(), leaseId, {
      idempotencyKey: settleKey,
      deductionAmountVnd: 500000,
      refundAmountVnd: 2500000
    });
    assert.equal(replaySettle.status, "SETTLED");

    // 6. Verify termination deposit_readiness automatically transitioned to READY
    // and overall status became READY because meter and financial readiness were READY!
    const termAfter = await pool.query<{ deposit_readiness: string; status: string }>(
      "SELECT deposit_readiness, status FROM lease_terminations WHERE organization_id = $1 AND lease_id = $2",
      [organizationId, leaseId]
    );
    assert.equal(termAfter.rows[0]?.deposit_readiness, "READY");
    assert.equal(termAfter.rows[0]?.status, "READY");

    // 7. Verify lease detail API reflects the full deposit ledger and updated readiness
    const detailAfter = await adminService.detail(principal(), leaseId);
    assert.equal(detailAfter.deposit.status, "SETTLED");
    assert.equal(detailAfter.deposit.remainingHeldVnd, 0);
    assert.equal(detailAfter.termination?.readiness.deposit, "READY");
    assert.equal(detailAfter.termination?.status, "READY");

    // 8. Tenant isolation check: other organization cannot read or mutate this deposit
    await assert.rejects(
      () =>
        depositService.collectDeposit(principal(otherOrganizationId), leaseId, {
          idempotencyKey: "cross-org-attempt",
          amountVnd: 1000000
        }),
      /Lease was not found|Lease read permission denied/
    );
  } finally {
    await cleanup(pool);
    await pool.end();
  }
});
