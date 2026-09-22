import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";
import type { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";
import { AssetReadService } from "./asset-read.service.js";

const principal: TenantPrincipal = {
  userId: "10000000-0000-0000-0000-000000000001",
  membershipId: "20000000-0000-0000-0000-000000000001",
  organizationId: "30000000-0000-0000-0000-000000000001",
  organizationName: "Test Org",
  role: "STAFF",
  membership: {
    organizationId: "30000000-0000-0000-0000-000000000001",
    role: "STAFF",
    status: "ACTIVE",
    scopes: [
      {
        type: "PROPERTY",
        propertyId: "40000000-0000-0000-0000-000000000001"
      }
    ]
  }
};

class OverviewDatabase {
  async query<T extends QueryResultRow>() {
    return {
      rows: [
        {
          id: "40000000-0000-0000-0000-000000000001",
          code: "A",
          name: "Allowed",
          property_type: "BOARDING_HOUSE",
          address_text: null,
          administrative_area_name: null,
          operational_group_ids: [],
          floor_count: 1,
          room_count: 4,
          occupied_room_count: 3
        },
        {
          id: "40000000-0000-0000-0000-000000000002",
          code: "B",
          name: "Denied",
          property_type: "BOARDING_HOUSE",
          address_text: null,
          administrative_area_name: null,
          operational_group_ids: [],
          floor_count: 2,
          room_count: 8,
          occupied_room_count: 7
        }
      ] as T[]
    };
  }
}

test("asset overview returns only properties allowed by membership scope", async () => {
  const service = new AssetReadService(
    new OverviewDatabase() as unknown as DatabaseService,
    new AccessControlService()
  );

  const result = await service.overview(principal);

  assert.equal(result.properties.length, 1);
  assert.equal(result.properties[0]?.name, "Allowed");
  assert.deepEqual(result.summary, {
    propertyCount: 1,
    floorCount: 1,
    roomCount: 4,
    occupiedRoomCount: 3,
    vacantRoomCount: 1
  });
});

class PropertyDatabase {
  async query<T extends QueryResultRow>() {
    return {
      rows: [
        {
          id: "40000000-0000-0000-0000-000000000002",
          code: "B",
          name: "Denied",
          property_type: "BOARDING_HOUSE",
          address_text: null,
          administrative_area_name: null,
          operational_group_ids: [],
          floor_count: 1,
          room_count: 2,
          occupied_room_count: 1
        }
      ] as T[]
    };
  }
}

test("property detail rejects a resource outside membership scope", async () => {
  const service = new AssetReadService(
    new PropertyDatabase() as unknown as DatabaseService,
    new AccessControlService()
  );

  await assert.rejects(
    () =>
      service.property(
        principal,
        "40000000-0000-0000-0000-000000000002"
      ),
    /Property scope denied/
  );
});
