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
    if (sql.includes("SELECT id FROM properties WHERE")) {
      return { rows: [] as unknown as T[] };
    }
    return { rows: [{ id: "mock-uuid-1234" }] as unknown as T[] };
  }

  async withTransaction<T>(action: (client: unknown) => Promise<T>): Promise<T> {
    const mockClient = {
      query: async (sql: string) => {
        this.queries.push(sql);
        return { rows: [{ id: "mock-tx-uuid-1234" }] };
      }
    };
    return action(mockClient);
  }
}

class MockCommercialPolicy {
  async assertTenantWriteAllowed() {}
}

test("excel template generation and parsing roundtrip", () => {
  const buffer = generatePropertyImportTemplateWorkbook();
  assert.ok(buffer.length > 0);

  const payload = parsePropertyImportWorkbook(buffer);
  assert.equal(payload.property.code, "HM-01");
  assert.equal(payload.property.name, "Nhà trọ Hoàng Mai 1");
  assert.equal(payload.property.provinceName, "Hà Nội");
  assert.equal(payload.property.districtName, "Quận Hoàng Mai");
  assert.equal(payload.property.wardName, "Phường Tương Mai");
  assert.equal(payload.floors.length, 3);
  assert.equal(payload.rooms.length, 5);
  assert.equal(payload.equipments.length, 5);
});

test("property import validation catches missing property name and duplicate codes", async () => {
  const service = new PropertyImportService(
    new MockDatabase() as unknown as DatabaseService,
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

test("property import execute creates property, floors, rooms, and equipment in a transaction", async () => {
  const db = new MockDatabase();
  const service = new PropertyImportService(
    db as unknown as DatabaseService,
    new MockCommercialPolicy() as unknown as CommercialPolicyService
  );

  const validPayload: PropertyImportPayload = {
    property: {
      code: "HM-TEST",
      name: "Nhà trọ Test",
      propertyType: "BOARDING_HOUSE",
      provinceName: "Hà Nội",
      districtName: "Quận Hoàng Mai",
      wardName: "Phường Tương Mai",
      addressText: "279 Hoàng Mai"
    },
    floors: [
      { code: "T1", name: "Tầng 1", sortOrder: 1 }
    ],
    rooms: [
      { code: "101", name: "Phòng 101", floorCode: "T1", sortOrder: 1 }
    ],
    equipments: [
      {
        roomCode: "101",
        name: "Điều hòa",
        brand: "Daikin",
        quantity: 1,
        conditionStatus: "GOOD",
        compensationValueVnd: 5000000
      }
    ]
  };

  const result = await service.execute(principal, validPayload);
  assert.equal(result.propertyCode, "HM-TEST");
  assert.equal(result.propertyName, "Nhà trọ Test");
  assert.equal(result.floorCount, 1);
  assert.equal(result.roomCount, 1);
  assert.equal(result.equipmentCount, 1);
  assert.ok(db.queries.some((q) => q.includes("INSERT INTO administrative_areas")));
  assert.ok(db.queries.some((q) => q.includes("INSERT INTO properties")));
  assert.ok(db.queries.some((q) => q.includes("INSERT INTO floors")));
  assert.ok(db.queries.some((q) => q.includes("INSERT INTO rooms")));
  assert.ok(db.queries.some((q) => q.includes("INSERT INTO room_equipment")));
});
