import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import { MembershipApplicationService } from "../../identity/application/membership-application.service.js";
import type { MembershipAccess } from "../../identity/domain/access-control.js";
import { RoomApplicationService } from "../../properties/application/room-application.service.js";
import {
  CommercialPolicyService,
  CommercialResourceLimitExceededError,
  CommercialWriteRestrictedError
} from "./commercial-policy.service.js";

const organizationId = "a1000000-0000-0000-0000-000000000001";
const actorUserId = "a2000000-0000-0000-0000-000000000001";
const invitedUserId = "a2000000-0000-0000-0000-000000000002";
const ownerMembershipId = "a3000000-0000-0000-0000-000000000001";
const invitedMembershipId = "a3000000-0000-0000-0000-000000000002";
const propertyId = "a4000000-0000-0000-0000-000000000001";
const roomId = "a5000000-0000-0000-0000-000000000001";
const secondRoomId = "a5000000-0000-0000-0000-000000000002";
const thirdRoomId = "a5000000-0000-0000-0000-000000000003";

function actor() {
  const membership: MembershipAccess = {
    organizationId,
    role: "OWNER",
    status: "ACTIVE",
    scopes: [{ type: "ORGANIZATION" }]
  };

  return {
    userId: actorUserId,
    membership
  };
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM audit_events WHERE organization_id = $1", [
    organizationId
  ]);
  await pool.query("DELETE FROM rooms WHERE organization_id = $1", [
    organizationId
  ]);
  await pool.query("DELETE FROM properties WHERE organization_id = $1", [
    organizationId
  ]);
  await pool.query(
    "DELETE FROM organization_entitlement_overrides WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM organization_subscriptions WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM organization_memberships WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
    [actorUserId, invitedUserId]
  ]);
}

test("tenant resource increases enforce effective commercial limits transactionally", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const accessControl = new AccessControlService();
  const commercialPolicy = new CommercialPolicyService();
  const rooms = new RoomApplicationService(
    database,
    accessControl,
    commercialPolicy
  );
  const memberships = new MembershipApplicationService(
    database,
    accessControl,
    commercialPolicy
  );

  try {
    await cleanup(fixturePool);

    await fixturePool.query(
      `INSERT INTO users (id, email, display_name)
       VALUES
         ($1, 'entitlement-owner@example.invalid', 'Entitlement Owner'),
         ($2, 'entitlement-invite@example.invalid', 'Entitlement Invite')`,
      [actorUserId, invitedUserId]
    );

    await fixturePool.query(
      `INSERT INTO organizations (
         id, slug, name, organization_type, status
       )
       VALUES (
         $1, 'entitlement-test-org', 'Entitlement Test Org', 'INDIVIDUAL', 'ACTIVE'
       )`,
      [organizationId]
    );

    await fixturePool.query(
      `INSERT INTO organization_memberships (
         id, organization_id, user_id, role, status
       )
       VALUES
         ($1, $3, $4, 'OWNER', 'ACTIVE'),
         ($2, $3, $5, 'STAFF', 'INVITED')`,
      [
        ownerMembershipId,
        invitedMembershipId,
        organizationId,
        actorUserId,
        invitedUserId
      ]
    );

    await fixturePool.query(
      `INSERT INTO properties (
         id, organization_id, code, name, property_type
       )
       VALUES (
         $1, $2, 'ENTITLEMENT-P1', 'Entitlement Property', 'BOARDING_HOUSE'
       )`,
      [propertyId, organizationId]
    );

    await fixturePool.query(
      `INSERT INTO organization_subscriptions (
         organization_id,
         plan_id,
         plan_version_id,
         status
       )
       SELECT $1, p.id, p.current_version_id, 'ACTIVE'
       FROM saas_plans p
       WHERE p.code = 'STARTER'`,
      [organizationId]
    );

    await fixturePool.query(
      `INSERT INTO organization_entitlement_overrides (
         organization_id,
         entitlement_key,
         value,
         reason,
         created_by_user_id
       )
       VALUES
         ($1, 'room_limit', '1'::jsonb, 'Integration room limit', $2),
         ($1, 'staff_limit', '1'::jsonb, 'Integration staff limit', $2)`,
      [organizationId, actorUserId]
    );

    const firstRoom = await rooms.create({
      actor: actor(),
      organizationId,
      roomId,
      propertyId,
      code: "R1",
      name: "Room 1"
    });

    const retriedRoom = await rooms.create({
      actor: actor(),
      organizationId,
      roomId,
      propertyId,
      code: "R1",
      name: "Room 1"
    });

    assert.deepEqual(retriedRoom, firstRoom);

    const roomAudit = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM audit_events
       WHERE organization_id = $1
         AND action = 'ROOM_CREATED'
         AND resource_id = $2`,
      [organizationId, roomId]
    );
    assert.equal(roomAudit.rows[0]?.count, 1);

    await assert.rejects(
      () =>
        rooms.create({
          actor: actor(),
          organizationId,
          roomId: secondRoomId,
          propertyId,
          code: "R2",
          name: "Room 2"
        }),
      CommercialResourceLimitExceededError
    );

    await assert.rejects(
      () =>
        memberships.activate({
          actor: actor(),
          organizationId,
          membershipId: invitedMembershipId
        }),
      CommercialResourceLimitExceededError
    );

    await fixturePool.query(
      `UPDATE organization_entitlement_overrides
       SET value = '2'::jsonb
       WHERE organization_id = $1
         AND entitlement_key = 'staff_limit'
         AND revoked_at IS NULL`,
      [organizationId]
    );

    const activatedMembership = await memberships.activate({
      actor: actor(),
      organizationId,
      membershipId: invitedMembershipId
    });
    assert.equal(activatedMembership.status, "ACTIVE");

    const retriedMembership = await memberships.activate({
      actor: actor(),
      organizationId,
      membershipId: invitedMembershipId
    });
    assert.deepEqual(retriedMembership, activatedMembership);

    const membershipAudit = await fixturePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM audit_events
       WHERE organization_id = $1
         AND action = 'MEMBERSHIP_ACTIVATED'
         AND resource_id = $2`,
      [organizationId, invitedMembershipId]
    );
    assert.equal(membershipAudit.rows[0]?.count, 1);

    await fixturePool.query(
      `UPDATE organization_entitlement_overrides
       SET value = '3'::jsonb
       WHERE organization_id = $1
         AND entitlement_key = 'room_limit'
         AND revoked_at IS NULL`,
      [organizationId]
    );
    await fixturePool.query(
      `UPDATE organization_subscriptions
       SET status = 'SUSPENDED',
           version = version + 1,
           updated_at = now()
       WHERE organization_id = $1`,
      [organizationId]
    );

    const replayAfterSuspension = await rooms.create({
      actor: actor(),
      organizationId,
      roomId,
      propertyId,
      code: "R1",
      name: "Room 1"
    });
    assert.deepEqual(replayAfterSuspension, firstRoom);

    const membershipReplayAfterSuspension = await memberships.activate({
      actor: actor(),
      organizationId,
      membershipId: invitedMembershipId
    });
    assert.deepEqual(membershipReplayAfterSuspension, activatedMembership);

    await assert.rejects(
      () =>
        rooms.create({
          actor: actor(),
          organizationId,
          roomId: thirdRoomId,
          propertyId,
          code: "R3",
          name: "Room 3"
        }),
      CommercialWriteRestrictedError
    );
  } finally {
    await database.onModuleDestroy();
    await cleanup(fixturePool);
    await fixturePool.end();
  }
});
