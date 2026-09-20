import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { MembershipAccess } from "../../identity/domain/access-control.js";
import { LeaseTerminationNotReadyError } from "../domain/lease-lifecycle.js";
import {
  LeaseAuthorizationError,
  LeaseLifecycleApplicationService,
  LeaseNotFoundError
} from "./lease-lifecycle-application.service.js";

const organizationId = "10000000-0000-0000-0000-000000000001";
const otherOrganizationId = "10000000-0000-0000-0000-000000000002";
const actorUserId = "20000000-0000-0000-0000-000000000001";
const propertyId = "30000000-0000-0000-0000-000000000001";
const otherPropertyId = "30000000-0000-0000-0000-000000000002";
const roomId = "40000000-0000-0000-0000-000000000001";
const leaseId = "50000000-0000-0000-0000-000000000001";

function actor(
  membershipOverrides: Partial<MembershipAccess> = {}
) {
  return {
    userId: actorUserId,
    membership: {
      organizationId,
      role: "OWNER" as const,
      status: "ACTIVE" as const,
      scopes: [{ type: "ORGANIZATION" as const }],
      ...membershipOverrides
    }
  };
}

test("lease commands are transactional, authorized, idempotent and auditable", async () => {
  const connectionString = process.env.DATABASE_URL;

  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const service = new LeaseLifecycleApplicationService(
    database,
    new AccessControlService()
  );

  try {
    await fixturePool.query(
      "DELETE FROM audit_events WHERE organization_id = ANY($1::uuid[])",
      [[organizationId, otherOrganizationId]]
    );
    await fixturePool.query(
      "DELETE FROM organizations WHERE id = ANY($1::uuid[])",
      [[organizationId, otherOrganizationId]]
    );
    await fixturePool.query(
      "DELETE FROM users WHERE id = $1",
      [actorUserId]
    );

    await fixturePool.query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, 'leasing-test@example.invalid', 'Leasing Test Actor')`,
      [actorUserId]
    );

    await fixturePool.query(
      `INSERT INTO organizations (id, slug, name, organization_type)
       VALUES
         ($1, 'leasing-test-a', 'Leasing Test A', 'INDIVIDUAL'),
         ($2, 'leasing-test-b', 'Leasing Test B', 'INDIVIDUAL')`,
      [organizationId, otherOrganizationId]
    );

    await fixturePool.query(
      `INSERT INTO properties (
         id, organization_id, code, name, property_type
       ) VALUES ($1, $2, 'P1', 'Property 1', 'BOARDING_HOUSE')`,
      [propertyId, organizationId]
    );

    await fixturePool.query(
      `INSERT INTO properties (
         id, organization_id, code, name, property_type
       ) VALUES ($1, $2, 'P2', 'Property 2', 'BOARDING_HOUSE')`,
      [otherPropertyId, organizationId]
    );

    await fixturePool.query(
      `INSERT INTO rooms (
         id, organization_id, property_id, code, name
       ) VALUES ($1, $2, $3, 'R1', 'Room 1')`,
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
         planned_end_date,
         base_rent_vnd,
         deposit_required_vnd,
         billing_day,
         created_by_user_id,
         updated_by_user_id
       ) VALUES (
         $1, $2, $3, 'LEASE-TEST-1', 'DRAFT',
         '2026-10-01', '2027-09-30',
         3500000, 3500000, 5, $4, $4
       )`,
      [leaseId, organizationId, roomId, actorUserId]
    );

    await assert.rejects(
      () =>
        service.activate({
          actor: actor({
            scopes: [{ type: "PROPERTY", propertyId: otherPropertyId }]
          }),
          organizationId,
          leaseId,
          idempotencyKey: "unauthorized-activate"
        }),
      LeaseAuthorizationError
    );

    await assert.rejects(
      () =>
        service.activate({
          actor: actor({ organizationId: otherOrganizationId }),
          organizationId: otherOrganizationId,
          leaseId,
          idempotencyKey: "cross-tenant-activate"
        }),
      LeaseNotFoundError
    );

    const firstActivation = await service.activate({
      actor: actor(),
      organizationId,
      leaseId,
      idempotencyKey: "activate-1"
    });

    const retriedActivation = await service.activate({
      actor: actor(),
      organizationId,
      leaseId,
      idempotencyKey: "activate-1"
    });

    assert.deepEqual(retriedActivation, firstActivation);
    assert.equal(firstActivation.lease.status, "ACTIVE");
    assert.equal(firstActivation.lease.version, 2);

    const activationAudit = await fixturePool.query(
      `SELECT count(*)::int AS count
       FROM audit_events
       WHERE organization_id = $1
         AND resource_id = $2
         AND action = 'LEASE_ACTIVATED'`,
      [organizationId, leaseId]
    );

    assert.equal(
      Number((activationAudit.rows[0] as Record<string, unknown>).count),
      1
    );

    await assert.rejects(
      () =>
        fixturePool.query(
          `INSERT INTO leases (
             organization_id,
             room_id,
             lease_code,
             status,
             start_date,
             base_rent_vnd,
             deposit_required_vnd
           ) VALUES (
             $1, $2, 'LEASE-CONFLICT', 'ACTIVE',
             '2026-11-01', 3500000, 3500000
           )`,
          [organizationId, roomId]
        ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
    );

    const scheduled = await service.scheduleTermination({
      actor: actor(),
      organizationId,
      leaseId,
      idempotencyKey: "schedule-1",
      effectiveDate: "2027-03-15",
      reason: "Người thuê chuyển đi"
    });

    assert.equal(scheduled.lease.status, "TERMINATION_SCHEDULED");

    await assert.rejects(
      () =>
        service.finalizeTermination({
          actor: actor(),
          organizationId,
          leaseId,
          idempotencyKey: "finalize-1"
        }),
      LeaseTerminationNotReadyError
    );

    const failedReceipt = await fixturePool.query(
      `SELECT count(*)::int AS count
       FROM lease_command_receipts
       WHERE organization_id = $1
         AND idempotency_key = 'finalize-1'`,
      [organizationId]
    );

    assert.equal(
      Number((failedReceipt.rows[0] as Record<string, unknown>).count),
      0
    );

    await fixturePool.query(
      `UPDATE lease_terminations
       SET meter_readiness = 'READY',
           financial_readiness = 'READY',
           deposit_readiness = 'NOT_REQUIRED',
           status = 'READY'
       WHERE organization_id = $1
         AND lease_id = $2
         AND status = 'SCHEDULED'`,
      [organizationId, leaseId]
    );

    const finalized = await service.finalizeTermination({
      actor: actor(),
      organizationId,
      leaseId,
      idempotencyKey: "finalize-1"
    });

    const finalizedRetry = await service.finalizeTermination({
      actor: actor(),
      organizationId,
      leaseId,
      idempotencyKey: "finalize-1"
    });

    assert.deepEqual(finalizedRetry, finalized);
    assert.equal(finalized.lease.status, "TERMINATED");
    assert.equal(finalized.lease.version, 4);

    const terminatedAudit = await fixturePool.query(
      `SELECT count(*)::int AS count
       FROM audit_events
       WHERE organization_id = $1
         AND resource_id = $2
         AND action = 'LEASE_TERMINATED'`,
      [organizationId, leaseId]
    );

    assert.equal(
      Number((terminatedAudit.rows[0] as Record<string, unknown>).count),
      1
    );
  } finally {
    await database.onModuleDestroy();
    await fixturePool.query(
      "DELETE FROM audit_events WHERE organization_id = ANY($1::uuid[])",
      [[organizationId, otherOrganizationId]]
    );
    await fixturePool.query(
      "DELETE FROM organizations WHERE id = ANY($1::uuid[])",
      [[organizationId, otherOrganizationId]]
    );
    await fixturePool.query("DELETE FROM users WHERE id = $1", [actorUserId]);
    await fixturePool.end();
  }
});
