import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { CommercialPolicyService } from "../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";
import { MeteringService } from "./metering.service.js";
import { StaffMeteringService } from "./staff-metering.service.js";

const organizationId = "13000000-0000-4000-8000-000000000001";
const userId = "23000000-0000-4000-8000-000000000001";
const propertyId = "33000000-0000-4000-8000-000000000001";
const deniedPropertyId = "33000000-0000-4000-8000-000000000002";
const roomId = "43000000-0000-4000-8000-000000000001";
const deniedRoomId = "43000000-0000-4000-8000-000000000002";
const electricityMeterId = "53000000-0000-4000-8000-000000000001";
const waterMeterId = "53000000-0000-4000-8000-000000000002";
const deniedMeterId = "53000000-0000-4000-8000-000000000003";

function principal(): TenantPrincipal {
  return {
    userId,
    membershipId: "63000000-0000-4000-8000-000000000001",
    organizationId,
    organizationName: "Staff Metering Test",
    role: "STAFF",
    membership: {
      organizationId,
      role: "STAFF",
      status: "ACTIVE",
      scopes: [{ type: "PROPERTY", propertyId }]
    }
  };
}

async function cleanup(pool: Pool) {
  await pool.query("DELETE FROM meter_readings WHERE organization_id = $1", [
    organizationId
  ]);
  await pool.query("DELETE FROM meters WHERE organization_id = $1", [
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
  await pool.query("DELETE FROM audit_events WHERE organization_id = $1", [
    organizationId
  ]);
  await pool.query("DELETE FROM rooms WHERE organization_id = $1", [
    organizationId
  ]);
  await pool.query("DELETE FROM properties WHERE organization_id = $1", [
    organizationId
  ]);
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

test("Staff metering checklist is scope-aware and offline retries are idempotent", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const accessControl = new AccessControlService();
  const commercialPolicy = new CommercialPolicyService();
  const metering = new MeteringService(
    database,
    accessControl,
    commercialPolicy
  );
  const staffMetering = new StaffMeteringService(
    database,
    accessControl,
    metering
  );

  try {
    await cleanup(fixturePool);

    await fixturePool.query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, 'staff-metering-test@example.invalid', 'Staff Metering')`,
      [userId]
    );
    await fixturePool.query(
      `INSERT INTO organizations (id, slug, name, organization_type)
       VALUES ($1, 'staff-metering-test', 'Staff Metering Test', 'INDIVIDUAL')`,
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
       VALUES
       ($1, $3, 'STAFF-A', 'Allowed Property', 'BOARDING_HOUSE'),
       ($2, $3, 'STAFF-B', 'Denied Property', 'BOARDING_HOUSE')`,
      [propertyId, deniedPropertyId, organizationId]
    );
    await fixturePool.query(
      `INSERT INTO rooms (
         id, organization_id, property_id, code, name
       )
       VALUES
       ($1, $3, $4, 'A101', 'Room A101'),
       ($2, $3, $5, 'B101', 'Room B101')`,
      [
        roomId,
        deniedRoomId,
        organizationId,
        propertyId,
        deniedPropertyId
      ]
    );
    await fixturePool.query(
      `INSERT INTO meters (
         id, organization_id, room_id, meter_type, unit
       )
       VALUES
       ($1, $4, $5, 'ELECTRICITY', 'KWH'),
       ($2, $4, $5, 'WATER', 'M3'),
       ($3, $4, $6, 'ELECTRICITY', 'KWH')`,
      [
        electricityMeterId,
        waterMeterId,
        deniedMeterId,
        organizationId,
        roomId,
        deniedRoomId
      ]
    );

    await fixturePool.query(
      `INSERT INTO meter_readings (
         id, organization_id, meter_id, reading_date, reading_value, source
       )
       VALUES
       ('73000000-0000-4000-8000-000000000001', $1, $2, '2026-07-31', 800, 'ADMIN'),
       ('73000000-0000-4000-8000-000000000002', $1, $2, '2026-08-31', 900, 'ADMIN'),
       ('73000000-0000-4000-8000-000000000003', $1, $2, '2026-09-30', 1000, 'ADMIN'),
       ('73000000-0000-4000-8000-000000000004', $1, $3, '2026-09-30', 50, 'ADMIN'),
       ('73000000-0000-4000-8000-000000000005', $1, $4, '2026-09-30', 10, 'ADMIN')`,
      [
        organizationId,
        electricityMeterId,
        waterMeterId,
        deniedMeterId
      ]
    );

    const before = await staffMetering.checklist(principal(), "2026-10-31");
    assert.equal(before.properties.length, 1);
    assert.equal(before.properties[0]?.id, propertyId);
    assert.equal(before.properties[0]?.writeAllowed, true);
    assert.equal(before.summary.roomCount, 1);
    assert.equal(before.summary.completedRoomCount, 0);
    assert.equal(before.properties[0]?.rooms[0]?.code, "A101");
    assert.equal(
      before.properties[0]?.rooms[0]?.electricity?.previousReading?.readingValue,
      "1000.000"
    );
    assert.equal(
      before.properties[0]?.rooms[0]?.electricity?.baselineUsage,
      "100.000"
    );

    const electricity = await staffMetering.addStaffReading(
      principal(),
      electricityMeterId,
      {
        id: "83000000-0000-4000-8000-000000000001",
        readingDate: "2026-10-31",
        readingValue: "1150.000"
      }
    );
    assert.equal(electricity.source, "STAFF");
    assert.deepEqual(
      await staffMetering.addStaffReading(principal(), electricityMeterId, {
        id: "83000000-0000-4000-8000-000000000001",
        readingDate: "2026-10-31",
        readingValue: "1150.000"
      }),
      electricity
    );

    await assert.rejects(
      () =>
        staffMetering.addStaffReading(principal(), electricityMeterId, {
          id: "83000000-0000-4000-8000-000000000002",
          readingDate: "2026-10-31",
          readingValue: "1160.000"
        }),
      (error: unknown) => {
        if (
          typeof error !== "object" ||
          error === null ||
          !("getResponse" in error) ||
          typeof error.getResponse !== "function"
        ) {
          return false;
        }
        const response = error.getResponse() as { code?: string };
        return response.code === "METER_READING_DATE_CONFLICT";
      }
    );

    await staffMetering.addStaffReading(principal(), waterMeterId, {
      id: "83000000-0000-4000-8000-000000000003",
      readingDate: "2026-10-31",
      readingValue: "55.000"
    });

    const after = await staffMetering.checklist(principal(), "2026-10-31");
    assert.equal(after.summary.completedRoomCount, 1);
    assert.equal(
      after.properties[0]?.rooms[0]?.electricity?.currentReading?.readingValue,
      "1150.000"
    );
    assert.equal(
      after.properties[0]?.rooms[0]?.water?.currentReading?.readingValue,
      "55.000"
    );

    await assert.rejects(
      () =>
        staffMetering.addStaffReading(principal(), deniedMeterId, {
          id: "83000000-0000-4000-8000-000000000004",
          readingDate: "2026-10-31",
          readingValue: "15.000"
        }),
      /Meter scope denied/
    );

    const audits = await fixturePool.query<{ action: string }>(
      `SELECT action
       FROM audit_events
       WHERE organization_id = $1
       ORDER BY occurred_at, id`,
      [organizationId]
    );
    assert.equal(
      audits.rows.filter((row) => row.action === "METER_READING_RECORDED").length,
      2
    );
  } finally {
    await database.onModuleDestroy();
    await cleanup(fixturePool);
    await fixturePool.end();
  }
});
