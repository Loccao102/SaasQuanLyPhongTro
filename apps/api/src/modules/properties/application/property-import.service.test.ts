import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";
import type { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import type { DatabaseService } from "../../database/database.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";
import {
  generatePropertyImportTemplateWorkbook,
  parsePropertyImportWorkbook,
  type PropertyImportPayload
} from "./excel-property.helper.js";
import { PropertyImportService } from "./property-import.service.js";

const principal: TenantPrincipal = {
  userId: "10000000-0000-0000-0000-000000000001",
  membershipId: "20000000-0000-0000-0000-000000000001",
  organizationId: "30000000-0000-0000-0000-000000000001",
  organizationName: "Test Org",
  role: "OWNER",
  membership: {
    organizationId: "30000000-0000-0000-0000-000000000001",
    role: "OWNER",
    status: "ACTIVE",
    scopes: []
  }
};

class MockDatabase {
  public queries: string[] = [];

  async query<T extends QueryResultRow>(sql: string, _params?: unknown[]) {
    this.queries.push(sql);
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("FROM property_operational_groups")) {
      return { rows: [] as unknown as T[] };
    }
    if (normalized.includes("FROM properties")) {
      return {
        rows: [
          {
            id: "target-prop-uuid-1",
            code: "EXISTING-01",
            name: "Cơ sở Đang Hoạt Động",
            property_type: "BOARDING_HOUSE",
            address_text: "123 Đường Láng",
            administrative_area_id: "area-uuid"
          }
        ] as unknown as T[]
      };
    }
    if (normalized.includes("FROM floors")) {
      return {
        rows: [
          { id: "floor-t1", code: "T1", name: "Tầng 1", sort_order: 1 },
          { id: "floor-t2", code: "T2", name: "Tầng 2", sort_order: 2 }
        ] as unknown as T[]
      };
    }
    if (normalized.includes("FROM rooms")) {
      if (normalized.includes("count(*)::int")) {
        return { rows: [{ count: 5 }] as unknown as T[] };
      }
      return {
        rows: [{ id: "room-101", code: "101", name: "Phòng 101" }] as unknown as T[]
      };
    }
    return { rows: [{ id: "mock-uuid-1234" }] as unknown as T[] };
  }

  async withTransaction<T>(action: (client: unknown) => Promise<T>): Promise<T> {
    const mockClient = {
      query: async (sql: string, params?: unknown[]) => {
        this.queries.push(sql + (params ? " " + JSON.stringify(params) : ""));
        const normalized = sql.replace(/\s+/g, " ");
        if (normalized.includes("FROM property_operational_groups")) {
          return { rows: [] };
        }
        if (normalized.includes("FROM properties")) {
          return {
            rows: [
              {
                id: "target-prop-uuid-1",
                code: "EXISTING-01",
                name: "Cơ sở Đang Hoạt Động",
                administrative_area_id: "area-uuid"
              }
            ]
          };
        }
        if (normalized.includes("FROM floors")) {
          return { rows: [{ id: "floor-t1", code: "T1" }] };
        }
        if (normalized.includes("FROM rooms")) {
          return { rows: [{ id: "room-101", code: "101" }] };
        }
        return { rows: [{ id: "mock-tx-uuid-1234" }] };
      }
    };
    return action(mockClient);
  }
}

class MockCommercialPolicy {
  async assertTenantWriteAllowed() {
    return { planVersionId: "plan-version-1" };
  }
  async loadPolicy() {
    return {
      entitlements: { roomLimit: 100, staffLimit: 10 }
    };
  }
  assertResourceIncreaseAllowed() {}
}

test("excel template generation and parsing roundtrip", () => {
  const buffer = generatePropertyImportTemplateWorkbook();
  assert.ok(buffer.length > 0);

  const payload = parsePropertyImportWorkbook(buffer);
  assert.ok(payload.property);
  assert.ok(payload.floors);
  assert.ok(payload.rooms);
  assert.ok(payload.equipments);
  assert.equal(payload.property.code, "HM-01");
  assert.equal(payload.property.name, "Nhà trọ Hoàng Mai 1");
  assert.equal(payload.property.provinceName, "Hà Nội");
  assert.equal(payload.property.districtName, "Quận Hoàng Mai");
  assert.equal(payload.property.wardName, "Phường Tương Mai");
  assert.equal(payload.floors.length, 3);
  assert.equal(payload.rooms.length, 5);
  assert.equal(payload.equipments.length, 5);
});

test("tailored excel template generation for existing property", async () => {
  const db = new MockDatabase();
  const service = new PropertyImportService(
    db as unknown as DatabaseService,
    new MockCommercialPolicy() as unknown as CommercialPolicyService
  );

  const { buffer, filename } = await service.generateTemplate(
    principal,
    "target-prop-uuid-1"
  );
  assert.ok(buffer.length > 0);
  assert.equal(filename, "Mau_Nhap_Phong_EXISTING-01.xlsx");

  const payload = parsePropertyImportWorkbook(buffer);
  assert.ok(payload.property);
  assert.ok(payload.floors);
  assert.equal(payload.property.code, "EXISTING-01");
  assert.equal(payload.property.name, "Cơ sở Đang Hoạt Động");
  assert.ok(payload.floors.length >= 2);
});

test("property import validation catches missing property name and duplicate codes", async () => {
  const mockDb = new MockDatabase();
  // Override property check to simulate code not yet existing
  mockDb.query = async <T extends QueryResultRow>(sql: string): Promise<{ rows: T[] }> => {
    if (sql.includes("SELECT id FROM properties WHERE")) {
      return { rows: [] };
    }
    if (sql.includes("count(*)::int AS count FROM rooms")) {
      return { rows: [{ count: 0 } as unknown as T] };
    }
    return { rows: [] };
  };

  const service = new PropertyImportService(
    mockDb as unknown as DatabaseService,
    new MockCommercialPolicy() as unknown as CommercialPolicyService
  );

  const invalidPayload: PropertyImportPayload = {
    property: {
      code: "",
      name: "",
      propertyType: "BOARDING_HOUSE"
    },
    floors: [
      { code: "T1", name: "Tầng 1" },
      { code: "T1", name: "Tầng 1 trùng" }
    ],
    rooms: [
      { code: "101", name: "" },
      { code: "101", name: "101 trùng" }
    ],
    equipments: [
      { roomCode: "999", name: "Điều hòa", quantity: 0, compensationValueVnd: -100 }
    ]
  };

  const report = await service.validate(principal, invalidPayload);
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.section === "PROPERTY"));
  assert.ok(report.errors.some((e) => e.section === "FLOORS" && e.message.includes("trùng")));
  assert.ok(report.errors.some((e) => e.section === "ROOMS" && e.message.includes("trùng")));
  assert.ok(report.errors.some((e) => e.section === "EQUIPMENTS" && e.message.includes("không tồn tại")));
});

test("property import into existing property validates correctly and detects new vs existing rooms", async () => {
  const db = new MockDatabase();
  const service = new PropertyImportService(
    db as unknown as DatabaseService,
    new MockCommercialPolicy() as unknown as CommercialPolicyService
  );

  const payload: PropertyImportPayload = {
    mode: "EXISTING_PROPERTY",
    targetPropertyId: "target-prop-uuid-1",
    autoCreateMeters: true,
    property: {
      code: "EXISTING-01",
      name: "Cơ sở Đang Hoạt Động",
      propertyType: "BOARDING_HOUSE"
    },
    floors: [{ code: "T1", name: "Tầng 1" }],
    rooms: [
      { code: "101", name: "Phòng 101 Cũ", floorCode: "T1" },
      { code: "102", name: "Phòng 102 Mới", floorCode: "T1" }
    ],
    equipments: [
      {
        roomCode: "101",
        name: "Quạt treo tường",
        quantity: 1
      }
    ]
  };

  const report = await service.validate(principal, payload);
  assert.equal(report.isValid, true);
  assert.equal(report.summary.isExistingProperty, true);
  assert.equal(report.summary.propertyCode, "EXISTING-01");
  assert.equal(report.summary.roomCount, 2);
  assert.equal(report.summary.newRoomCount, 1);
  assert.equal(report.summary.existingRoomCount, 1);
  assert.ok(report.warnings.some((w) => w.includes("đã có sẵn trong cơ sở")));
});

test("property import execute into existing property provisions rooms, equipment and auto meters", async () => {
  const db = new MockDatabase();
  const service = new PropertyImportService(
    db as unknown as DatabaseService,
    new MockCommercialPolicy() as unknown as CommercialPolicyService
  );

  const payload: PropertyImportPayload = {
    mode: "EXISTING_PROPERTY",
    targetPropertyId: "target-prop-uuid-1",
    autoCreateMeters: true,
    property: {
      code: "EXISTING-01",
      name: "Cơ sở Đang Hoạt Động",
      propertyType: "BOARDING_HOUSE"
    },
    floors: [{ code: "T1", name: "Tầng 1" }],
    rooms: [
      { code: "101", name: "Phòng 101 Cũ", floorCode: "T1" },
      { code: "102", name: "Phòng 102 Mới", floorCode: "T1" }
    ],
    equipments: [
      {
        roomCode: "102",
        name: "Bình nóng lạnh",
        quantity: 1
      }
    ]
  };

  const result = await service.execute(principal, payload);
  assert.equal(result.propertyId, "target-prop-uuid-1");
  assert.equal(result.propertyCode, "EXISTING-01");
  assert.equal(result.roomCount, 2);
  assert.equal(result.newRoomCount, 1);
  assert.equal(result.existingRoomCount, 1);
  assert.equal(result.metersCreatedCount, 2); // 1 new room * 2 meters (ELECTRICITY + WATER)
  assert.ok(db.queries.some((q) => q.includes("INSERT INTO meters")));
  assert.ok(db.queries.some((q) => q.includes("PROPERTY_ROOMS_BULK_IMPORTED")));
});
