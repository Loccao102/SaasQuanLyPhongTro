import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";
import { LeaseAdminService } from "./lease-admin.service.js";
import { LeaseDraftManagementService } from "./lease-draft-management.service.js";

const organizationId = "11000000-0000-4000-8000-000000000001";
const userId = "21000000-0000-4000-8000-000000000001";
const propertyId = "31000000-0000-4000-8000-000000000001";
const otherPropertyId = "31000000-0000-4000-8000-000000000002";
const roomId = "41000000-0000-4000-8000-000000000001";
const roomId2 = "41000000-0000-4000-8000-000000000002";
const leaseId = "51000000-0000-4000-8000-000000000001";
const leaseId2 = "51000000-0000-4000-8000-000000000002";
const residentId = "61000000-0000-4000-8000-000000000001";
const partyResidentId = "61000000-0000-4000-8000-000000000002";

function principal(
  scopes: TenantPrincipal["membership"]["scopes"] = [
    { type: "ORGANIZATION" as const }
  ]
): TenantPrincipal {
  return {
    userId,
    membershipId: "71000000-0000-4000-8000-000000000001",
    organizationId,
    organizationName: "Lease Admin Test",
    role: "OWNER",
    membership: {
      organizationId,
      role: "OWNER",
      status: "ACTIVE",
      scopes
    }
  };
}

async function cleanup(pool: Pool): Promise<void> {
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
  await pool.query("DELETE FROM floors WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM properties WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

test("admin leasing creates a draft idempotently and filters reads by property scope", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const accessControl = new AccessControlService();
  const commercialPolicy = new CommercialPolicyService();
  const service = new LeaseAdminService(
    database,
    accessControl,
    commercialPolicy
  );
  const draftService = new LeaseDraftManagementService(
    database,
    accessControl,
    commercialPolicy
  );

  try {
    await cleanup(fixturePool);

    await fixturePool.query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, 'lease-admin-test@example.invalid', 'Lease Admin Test')`,
      [userId]
    );

    await fixturePool.query(
      `INSERT INTO organizations (id, slug, name, organization_type)
       VALUES ($1, 'lease-admin-test', 'Lease Admin Test', 'INDIVIDUAL')`,
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
       ) VALUES
       ($1, $3, 'P1', 'Property 1', 'BOARDING_HOUSE'),
       ($2, $3, 'P2', 'Property 2', 'BOARDING_HOUSE')`,
      [propertyId, otherPropertyId, organizationId]
    );

    await fixturePool.query(
      `INSERT INTO rooms (
         id, organization_id, property_id, code, name
       ) VALUES
       ($1, $3, $4, 'R1', 'Room 1'),
       ($2, $3, $4, 'R2', 'Room 2')`,
      [roomId, roomId2, organizationId, propertyId]
    );

    const input = {
      leaseId,
      residentId,
      idempotencyKey: "lease-admin-create-1",
      roomId,
      leaseCode: "LEASE-ADMIN-1",
      startDate: "2026-10-01",
      plannedEndDate: "2027-09-30",
      baseRentVnd: 3500000,
      depositRequiredVnd: 3500000,
      billingDay: 5,
      primaryResident: {
        fullName: "Nguyen Van Test",
        phone: "0900000000",
        email: "tenant@example.invalid"
      }
    };

    const first = await service.createDraft(principal(), input);
    const retry = await service.createDraft(principal(), input);

    assert.deepEqual(retry, first);
    assert.equal(first.status, "DRAFT");
    assert.equal(first.leaseId, leaseId);

    const reused = await service.createDraft(principal(), {
      leaseId: leaseId2,
      residentId,
      idempotencyKey: "lease-admin-create-2",
      roomId: roomId2,
      leaseCode: "LEASE-ADMIN-2",
      startDate: "2026-10-15",
      plannedEndDate: null,
      baseRentVnd: 3600000,
      depositRequiredVnd: 3600000,
      billingDay: 5,
      primaryResident: null
    });
    assert.equal(reused.residentId, residentId);

    const residentSearch = await draftService.searchResidents(
      principal([{ type: "PROPERTY", propertyId }]),
      propertyId,
      "Nguyen"
    );
    assert.equal(residentSearch.residents.length, 1);
    assert.equal(residentSearch.residents[0]?.id, residentId);

    const updated = await draftService.updateDraft(principal(), leaseId, {
      expectedVersion: 1,
      leaseCode: "LEASE-ADMIN-1",
      startDate: "2026-10-01",
      plannedEndDate: "2027-09-30",
      baseRentVnd: 3700000,
      depositRequiredVnd: 3500000,
      billingDay: 7
    });
    assert.equal(updated.version, 2);

    const addedParty = await draftService.addParty(principal(), leaseId, {
      residentId: partyResidentId,
      partyRole: "OCCUPANT",
      resident: {
        fullName: "Tran Thi Occupant",
        phone: "0911111111"
      }
    });
    assert.equal(addedParty.version, 3);

    const removedParty = await draftService.removeParty(
      principal(),
      leaseId,
      partyResidentId
    );
    assert.equal(removedParty.version, 4);

    const counts = await fixturePool.query(
      `SELECT
         (SELECT count(*)::int FROM leases WHERE organization_id = $1) AS leases,
         (SELECT count(*)::int FROM residents WHERE organization_id = $1) AS residents,
         (SELECT count(*)::int FROM lease_command_receipts WHERE organization_id = $1) AS receipts,
         (SELECT count(*)::int FROM audit_events
            WHERE organization_id = $1 AND action = 'LEASE_DRAFT_CREATED') AS audits`,
      [organizationId]
    );

    assert.deepEqual(counts.rows[0], {
      leases: 2,
      residents: 2,
      receipts: 2,
      audits: 2
    });

    const allowed = await service.list(
      principal([{ type: "PROPERTY", propertyId }])
    );
    assert.equal(allowed.leases.length, 2);
    assert.ok(allowed.leases.some((item) => item.code === "LEASE-ADMIN-1"));
    assert.ok(allowed.leases.some((item) => item.code === "LEASE-ADMIN-2"));

    const denied = await service.list(
      principal([{ type: "PROPERTY", propertyId: otherPropertyId }])
    );
    assert.equal(denied.leases.length, 0);

    const detail = await service.detail(
      principal([{ type: "PROPERTY", propertyId }]),
      leaseId
    );
    assert.equal(detail.lease.primaryResident?.fullName, "Nguyen Van Test");
    assert.equal(detail.permissions.manage, true);
    assert.equal(detail.parties.length, 1);
    assert.equal(detail.lease.baseRentVnd, 3700000);
    assert.equal(detail.lease.billingDay, 7);
    assert.equal(detail.lease.version, 4);
    assert.ok(
      detail.audit.some((item) => item.action === "LEASE_DRAFT_UPDATED")
    );
    assert.ok(
      detail.audit.some((item) => item.action === "LEASE_PARTY_ADDED")
    );
    assert.ok(
      detail.audit.some((item) => item.action === "LEASE_PARTY_REMOVED")
    );
  } finally {
    await database.onModuleDestroy();
    await cleanup(fixturePool);
    await fixturePool.end();
  }
});
