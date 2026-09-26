import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";
import { MeteringService } from "../../metering/metering.service.js";
import { LeaseAdminService } from "./lease-admin.service.js";
import { LeaseDraftManagementService } from "./lease-draft-management.service.js";
import { LeaseDepositService } from "./lease-deposit.service.js";
import { LeaseLifecycleApplicationService } from "./lease-lifecycle-application.service.js";
import { LeaseTerminationReadinessService } from "./lease-termination-readiness.service.js";

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
const replacementResidentId = "61000000-0000-4000-8000-000000000003";
const electricityMeterId = "81000000-0000-4000-8000-000000000001";
const waterMeterId = "81000000-0000-4000-8000-000000000002";
const finalReadingId = "91000000-0000-4000-8000-000000000001";
const waterFinalReadingId = "91000000-0000-4000-8000-000000000002";

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
  await pool.query("DELETE FROM meter_readings WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM meters WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM lease_deposit_entries WHERE organization_id = $1", [organizationId]);
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
  const depositService = new LeaseDepositService(
    database,
    accessControl,
    commercialPolicy
  );
  const lifecycleService = new LeaseLifecycleApplicationService(
    database,
    accessControl,
    commercialPolicy
  );
  const meteringService = new MeteringService(
    database,
    accessControl,
    commercialPolicy
  );
  const terminationReadinessService =
    new LeaseTerminationReadinessService(
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

    await assert.rejects(
      () =>
        draftService.replacePrimaryTenant(
          principal(),
          leaseId,
          {
            expectedVersion: 2,
            idempotencyKey: "replace-primary-stale",
            residentId: partyResidentId,
            previousPrimaryDisposition: "CO_TENANT",
            resident: null
          }
        ),
      /changed since it was loaded/
    );

    const replaced = await draftService.replacePrimaryTenant(
      principal(),
      leaseId,
      {
        expectedVersion: 3,
        idempotencyKey: "replace-primary-1",
        residentId: partyResidentId,
        previousPrimaryDisposition: "CO_TENANT",
        resident: null
      }
    );
    const replaceRetry = await draftService.replacePrimaryTenant(
      principal(),
      leaseId,
      {
        expectedVersion: 3,
        idempotencyKey: "replace-primary-1",
        residentId: partyResidentId,
        previousPrimaryDisposition: "CO_TENANT",
        resident: null
      }
    );
    assert.deepEqual(replaceRetry, replaced);
    assert.equal(replaced.previousPrimaryResidentId, residentId);
    assert.equal(replaced.primaryResidentId, partyResidentId);
    assert.equal(replaced.version, 4);

    const removedParty = await draftService.removeParty(
      principal(),
      leaseId,
      residentId
    );
    assert.equal(removedParty.version, 5);

    const replacedWithNew =
      await draftService.replacePrimaryTenant(
        principal(),
        leaseId2,
        {
          expectedVersion: 1,
          idempotencyKey: "replace-primary-2",
          residentId: replacementResidentId,
          previousPrimaryDisposition: "REMOVE",
          resident: {
            fullName: "Le Thi Replacement",
            phone: "0922222222"
          }
        }
      );
    assert.equal(replacedWithNew.primaryResidentId, replacementResidentId);
    assert.equal(replacedWithNew.previousPrimaryDisposition, "REMOVE");
    assert.equal(replacedWithNew.version, 2);

    const lease2OldPrimary = await fixturePool.query(
      `SELECT count(*)::int AS count
       FROM lease_residents
       WHERE organization_id = $1::uuid
         AND lease_id = $2::uuid
         AND resident_id = $3::uuid`,
      [organizationId, leaseId2, residentId]
    );
    assert.equal(lease2OldPrimary.rows[0]?.count, 0);

    const counts = await fixturePool.query(
      `SELECT
         (SELECT count(*)::int FROM leases WHERE organization_id = $1) AS leases,
         (SELECT count(*)::int FROM residents WHERE organization_id = $1) AS residents,
         (SELECT count(*)::int FROM lease_command_receipts WHERE organization_id = $1) AS receipts,
         (SELECT count(*)::int FROM audit_events
            WHERE organization_id = $1 AND action = 'LEASE_DRAFT_CREATED') AS audits,
         (SELECT count(*)::int FROM audit_events
            WHERE organization_id = $1 AND action = 'LEASE_PRIMARY_TENANT_REPLACED') AS primary_replacements`,
      [organizationId]
    );

    assert.deepEqual(counts.rows[0], {
      leases: 2,
      residents: 3,
      receipts: 4,
      audits: 2,
      primary_replacements: 2
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
    assert.equal(detail.lease.primaryResident?.fullName, "Tran Thi Occupant");
    assert.equal(detail.permissions.manage, true);
    assert.equal(detail.parties.length, 1);
    assert.equal(detail.parties[0]?.role, "PRIMARY_TENANT");
    assert.equal(detail.lease.baseRentVnd, 3700000);
    assert.equal(detail.lease.billingDay, 7);
    assert.equal(detail.lease.version, 5);
    assert.ok(
      detail.audit.some((item) => item.action === "LEASE_DRAFT_UPDATED")
    );
    assert.ok(
      detail.audit.some((item) => item.action === "LEASE_PARTY_ADDED")
    );
    assert.ok(
      detail.audit.some((item) => item.action === "LEASE_PARTY_REMOVED")
    );
    assert.ok(
      detail.audit.some(
        (item) =>
          item.action === "LEASE_PRIMARY_TENANT_REPLACED"
      )
    );


    await meteringService.createMeter(principal(), {
      id: electricityMeterId,
      roomId,
      meterType: "ELECTRICITY",
      label: "Điện phòng R1"
    });

    const collectionInput = {
      idempotencyKey: "lease-deposit-collection-1",
      amountVnd: 3500000,
      occurredAt: "2026-10-02T03:00:00.000Z",
      note: "Thu đủ tiền cọc khi nhận phòng"
    };
    const collected = await depositService.recordCollection(
      principal(),
      leaseId,
      collectionInput
    );
    const collectionRetry = await depositService.recordCollection(
      principal(),
      leaseId,
      collectionInput
    );
    assert.deepEqual(collectionRetry, collected);
    await assert.rejects(
      () =>
        depositService.recordCollection(principal(), leaseId, {
          ...collectionInput,
          amountVnd: 100000
        }),
      /different deposit data/
    );
    assert.equal(collected.status, "HELD");
    assert.equal(collected.collectedVnd, 3500000);
    assert.equal(collected.heldVnd, 3500000);
    assert.equal(collected.outstandingVnd, 0);
    assert.equal(collected.entries.length, 1);

    const actor = {
      userId,
      membership: principal().membership
    };
    await lifecycleService.activate({
      actor,
      organizationId,
      leaseId,
      idempotencyKey: "lease-activate-after-deposit"
    });
    await lifecycleService.scheduleTermination({
      actor,
      organizationId,
      leaseId,
      idempotencyKey: "lease-termination-after-deposit",
      effectiveDate: "2026-11-30",
      reason: "Tenant checkout"
    });

    const meterBefore =
      await terminationReadinessService.meterReadiness(
        principal(),
        leaseId
      );
    assert.equal(meterBefore.state, "PENDING");
    assert.equal(meterBefore.effectiveDate, "2026-11-30");
    assert.equal(meterBefore.meters.length, 1);
    assert.equal(meterBefore.meters[0]?.id, electricityMeterId);
    assert.equal(meterBefore.meters[0]?.finalReading, null);

    await assert.rejects(
      () =>
        terminationReadinessService.setManualReadiness(
          principal(),
          leaseId,
          {
            kind: "meter",
            state: "READY",
            reason: "Should be module-owned"
          }
        ),
      /module-owned/
    );

    await meteringService.addReading(
      principal(),
      electricityMeterId,
      {
        id: finalReadingId,
        readingDate: "2026-11-30",
        readingValue: "123.456",
        source: "ADMIN"
      }
    );

    const meterAfter =
      await terminationReadinessService.meterReadiness(
        principal(),
        leaseId
      );
    assert.equal(meterAfter.state, "READY");
    assert.equal(
      meterAfter.meters[0]?.finalReading?.readingValue,
      "123.456"
    );

    const settled = await depositService.settle(principal(), leaseId, {
      idempotencyKey: "lease-deposit-settlement-1",
      refundVnd: 3000000,
      deductionVnd: 500000,
      occurredAt: "2026-11-30T03:00:00.000Z",
      note: "Hoàn cọc sau khi khấu trừ hư hỏng đã xác nhận"
    });
    assert.equal(settled.status, "SETTLED");
    assert.equal(settled.heldVnd, 0);
    assert.equal(settled.refundedVnd, 3000000);
    assert.equal(settled.deductedVnd, 500000);
    assert.equal(settled.entries.length, 3);
    assert.equal(settled.termination.depositReadiness, "READY");
    assert.equal(settled.terminationDepositReadiness, "READY");

    await assert.rejects(
      () =>
        depositService.settle(principal(), leaseId, {
          idempotencyKey: "lease-deposit-settlement-duplicate",
          refundVnd: 0,
          deductionVnd: 0,
          occurredAt: "2026-11-30T04:00:00.000Z",
          note: "Should not settle twice"
        }),
      /already been resolved/
    );

    const terminationReadiness = await fixturePool.query(
      `SELECT meter_readiness, deposit_readiness
       FROM lease_terminations
       WHERE organization_id = $1::uuid
         AND lease_id = $2::uuid
         AND status IN ('SCHEDULED', 'READY')
       LIMIT 1`,
      [organizationId, leaseId]
    );
    assert.equal(
      terminationReadiness.rows[0]?.meter_readiness,
      "READY"
    );
    assert.equal(
      terminationReadiness.rows[0]?.deposit_readiness,
      "READY"
    );

    const depositAudits = await fixturePool.query(
      `SELECT action
       FROM audit_events
       WHERE organization_id = $1::uuid
         AND resource_type = 'LEASE'
         AND resource_id = $2::uuid
         AND action IN ('LEASE_DEPOSIT_COLLECTED', 'LEASE_DEPOSIT_SETTLED')
       ORDER BY occurred_at`,
      [organizationId, leaseId]
    );
    assert.deepEqual(
      depositAudits.rows.map((row) => row.action),
      ["LEASE_DEPOSIT_COLLECTED", "LEASE_DEPOSIT_SETTLED"]
    );

    await lifecycleService.activate({
      actor,
      organizationId,
      leaseId: leaseId2,
      idempotencyKey: "lease2-activate-no-meter"
    });
    await lifecycleService.scheduleTermination({
      actor,
      organizationId,
      leaseId: leaseId2,
      idempotencyKey: "lease2-termination-no-meter",
      effectiveDate: "2026-12-31",
      reason: "No meter readiness baseline"
    });

    const noMeter =
      await terminationReadinessService.meterReadiness(
        principal(),
        leaseId2
      );
    assert.equal(noMeter.state, "NOT_REQUIRED");
    assert.equal(noMeter.meters.length, 0);

    await meteringService.createMeter(principal(), {
      id: waterMeterId,
      roomId: roomId2,
      meterType: "WATER",
      label: "Nước phòng R2"
    });
    const meterAdded =
      await terminationReadinessService.meterReadiness(
        principal(),
        leaseId2
      );
    assert.equal(meterAdded.state, "PENDING");
    assert.equal(meterAdded.meters.length, 1);

    await meteringService.addReading(
      principal(),
      waterMeterId,
      {
        id: waterFinalReadingId,
        readingDate: "2026-12-31",
        readingValue: "45.000",
        source: "ADMIN"
      }
    );
    const meterCompleted =
      await terminationReadinessService.meterReadiness(
        principal(),
        leaseId2
      );
    assert.equal(meterCompleted.state, "READY");
    assert.equal(
      meterCompleted.meters[0]?.finalReading?.readingValue,
      "45.000"
    );
  } finally {
    await database.onModuleDestroy();
    await cleanup(fixturePool);
    await fixturePool.end();
  }
});
