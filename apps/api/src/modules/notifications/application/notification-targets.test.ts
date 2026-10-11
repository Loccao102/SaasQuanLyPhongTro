import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseService } from "../../database/database.service.js";
import type { AccessControlService } from "../../identity/access-control.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";
import type { AutomationQuotaService } from "../../commercial/application/automation-quota.service.js";
import { NotificationAdminService } from "./notification-admin.service.js";

const principal = {
  organizationId: "12345678-0000-4000-8000-000000000001",
  userId: "12345678-0000-4000-8000-000000000002",
  membership: { role: "OWNER", organizationId: "12345678-0000-4000-8000-000000000001" }
} as unknown as TenantPrincipal;

test("notification tenant recipient picker scopes to current lease parties and send permission", async () => {
  let querySql = "";
  let queryValues: readonly unknown[] = [];
  const db = {
    async query(sql: string, values: readonly unknown[]) {
      querySql = sql;
      queryValues = values;
      return {
        rows: [{
          resident_id: "a0000000-0000-4000-8000-000000000001",
          full_name: "Nguyễn Thị Ánh",
          phone: "0901234567",
          property_id: "b0000000-0000-4000-8000-000000000001",
          property_name: "Cơ sở Hà Nội",
          room_code: "A101",
          lease_code: "HD001"
        }]
      };
    }
  } as unknown as DatabaseService;
  const auth = {
    can: (_: unknown, permission: string) => permission === "notification.send"
  } as unknown as AccessControlService;
  const service = new NotificationAdminService(db, auth, {} as AutomationQuotaService);
  const result = await service.eligibleResidents(principal);
  assert.equal(result.truncated, false);
  assert.deepEqual(queryValues, [principal.organizationId]);
  assert.match(querySql, /l\.organization_id = \$1::uuid/);
  assert.match(querySql, /'ACTIVE', 'TERMINATION_SCHEDULED'/);
  assert.match(querySql, /r\.is_active = true/);
  assert.match(querySql, /lr\.left_on IS NULL OR lr\.left_on > CURRENT_DATE/);
  assert.deepEqual(result.residents, [{
    residentId: "a0000000-0000-4000-8000-000000000001",
    fullName: "Nguyễn Thị Ánh",
    phone: "0901234567",
    propertyId: "b0000000-0000-4000-8000-000000000001",
    propertyName: "Cơ sở Hà Nội",
    roomCode: "A101",
    leaseCode: "HD001"
  }]);
});

test("notification recipient picker rejects users without notification.send permission", async () => {
  const db = { async query() { throw new Error("Should not query tenant data"); } } as unknown as DatabaseService;
  const access = { can: () => false } as unknown as AccessControlService;
  const service = new NotificationAdminService(db, access, {} as AutomationQuotaService);
  await assert.rejects(() => service.eligibleResidents(principal), /notification.send permission denied/);
});
