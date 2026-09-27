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
      ] as unknown as T[]
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
      ] as unknown as T[]
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

class EmptyFloorPropertyDatabase {
  private queryCount = 0;

  async query<T extends QueryResultRow>(sql: string) {
    this.queryCount++;
    if (sql.includes("FROM properties p")) {
      return {
        rows: [
          {
            id: "40000000-0000-0000-0000-000000000001",
            code: "P1",
            name: "Allowed Property",
            property_type: "BOARDING_HOUSE",
            address_text: null,
            administrative_area_name: null,
            operational_group_ids: [],
            floor_count: 2,
            room_count: 1,
            occupied_room_count: 0
          }
        ] as unknown as T[]
      };
    }

    if (sql.includes("FROM floors")) {
      return {
        rows: [
          { id: "floor-1", code: "T1", name: "Tầng 1", sort_order: 1 },
          { id: "floor-2", code: "T2", name: "Tầng 2", sort_order: 2 }
        ] as unknown as T[]
      };
    }

    if (sql.includes("FROM rooms r")) {
      return {
        rows: [
          {
            room_id: "room-101",
            room_code: "101",
            room_name: "Phòng 101",
            room_sort_order: 1,
            floor_id: "floor-1",
            lease_id: null,
            lease_code: null,
            lease_status: null
          },
          {
            room_id: "room-999",
            room_code: "K1",
            room_name: "Ki-ốt Sân",
            room_sort_order: 2,
            floor_id: null,
            lease_id: null,
            lease_code: null,
            lease_status: null
          }
        ] as unknown as T[]
      };
    }

    return { rows: [] as unknown as T[] };
  }
}

test("property detail includes empty floors and handles unassigned rooms", async () => {
  const service = new AssetReadService(
    new EmptyFloorPropertyDatabase() as unknown as DatabaseService,
    new AccessControlService()
  );

  const result = await service.property(
    principal,
    "40000000-0000-0000-0000-000000000001"
  );

  assert.equal(result.property.name, "Allowed Property");
  // Expect 3 floors: floor-1 (with room 101), floor-2 (with 0 rooms), and unassigned floor (with room K1)
  assert.equal(result.floors.length, 3);

  // Floor 1 has room 101
  const f1 = result.floors.find((f) => f.id === "floor-1");
  assert.ok(f1);
  assert.equal(f1.rooms.length, 1);
  assert.equal(f1.rooms[0]?.code, "101");

  // Floor 2 has 0 rooms (previously this was completely missing bug!)
  const f2 = result.floors.find((f) => f.id === "floor-2");
  assert.ok(f2);
  assert.equal(f2.rooms.length, 0);

  // Unassigned floor
  const unassigned = result.floors.find((f) => f.id === null);
  assert.ok(unassigned);
  assert.equal(unassigned.name, "Chưa gán tầng");
  assert.equal(unassigned.rooms.length, 1);
  assert.equal(unassigned.rooms[0]?.code, "K1");
});

