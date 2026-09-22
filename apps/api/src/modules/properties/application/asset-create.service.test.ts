import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type {
  CommercialPolicyService,
  OrganizationCommercialPolicy
} from "../../commercial/application/commercial-policy.service.js";
import { PropertyApplicationService } from "./property-application.service.js";

const policy: OrganizationCommercialPolicy = {
  organizationId: "30000000-0000-0000-0000-000000000001",
  organizationStatus: "ACTIVE",
  subscriptionId: "50000000-0000-0000-0000-000000000001",
  subscriptionStatus: "ACTIVE",
  accessMode: "FULL",
  planCode: "GROWTH",
  planVersionId: "60000000-0000-0000-0000-000000000001",
  entitlements: {
    roomLimit: 60,
    staffLimit: 10,
    automationActionsMonthly: 1000,
    advancedReports: false,
    auditLog: true
  }
};

class NeverTransactionDatabase {
  async withTransaction(): Promise<never> {
    throw new Error("transaction should not start");
  }
}

test("property create requires organization-level property.manage scope", async () => {
  const commercial = {
    lockOrganizationForMutation: async () => undefined,
    loadPolicy: async () => policy,
    assertWriteAllowed: () => undefined
  } as unknown as CommercialPolicyService;

  const service = new PropertyApplicationService(
    new NeverTransactionDatabase() as unknown as DatabaseService,
    new AccessControlService(),
    commercial
  );

  await assert.rejects(
    () =>
      service.create({
        actor: {
          userId: "10000000-0000-0000-0000-000000000001",
          membership: {
            organizationId: policy.organizationId,
            role: "MANAGER",
            status: "ACTIVE",
            scopes: [
              {
                type: "PROPERTY",
                propertyId: "40000000-0000-0000-0000-000000000001"
              }
            ]
          }
        },
        organizationId: policy.organizationId,
        propertyId: "40000000-0000-4000-8000-000000000010",
        code: "TX",
        name: "Thanh Xuan",
        propertyType: "BOARDING_HOUSE"
      }),
    /not authorized to create properties/
  );
});

test("same property create payload is idempotent before write policy assertion", async () => {
  let assertWriteCalls = 0;
  const commercial = {
    lockOrganizationForMutation: async () => undefined,
    loadPolicy: async () => policy,
    assertWriteAllowed: () => {
      assertWriteCalls += 1;
      throw new Error("write assertion should not run for exact retry");
    }
  } as unknown as CommercialPolicyService;

  const fakeClient = {
    query: async () => ({
      rows: [
        {
          id: "40000000-0000-4000-8000-000000000010",
          organization_id: policy.organizationId,
          administrative_area_id: null,
          code: "TX",
          name: "Thanh Xuan",
          property_type: "BOARDING_HOUSE",
          address_text: "12 Nguyen Trai",
          is_active: true
        }
      ],
      rowCount: 1
    })
  };

  const database = {
    withTransaction: async <T>(
      fn: (client: typeof fakeClient) => Promise<T>
    ): Promise<T> => fn(fakeClient)
  } as unknown as DatabaseService;

  const service = new PropertyApplicationService(
    database,
    new AccessControlService(),
    commercial
  );

  const result = await service.create({
    actor: {
      userId: "10000000-0000-0000-0000-000000000001",
      membership: {
        organizationId: policy.organizationId,
        role: "OWNER",
        status: "ACTIVE",
        scopes: [{ type: "ORGANIZATION" }]
      }
    },
    organizationId: policy.organizationId,
    propertyId: "40000000-0000-4000-8000-000000000010",
    code: "TX",
    name: "Thanh Xuan",
    propertyType: "BOARDING_HOUSE",
    addressText: "12 Nguyen Trai"
  });

  assert.equal(result.code, "TX");
  assert.equal(assertWriteCalls, 0);
});
