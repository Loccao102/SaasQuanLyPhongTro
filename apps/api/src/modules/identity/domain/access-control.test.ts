import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorized, type MembershipAccess } from "./access-control.js";

const organizationId = "org-a";

function membership(overrides: Partial<MembershipAccess> = {}): MembershipAccess {
  return {
    organizationId,
    role: "OWNER",
    status: "ACTIVE",
    scopes: [{ type: "ORGANIZATION" }],
    ...overrides
  };
}

test("owner with organization scope can manage property in the same organization", () => {
  assert.equal(
    isAuthorized(
      membership(),
      "property.manage",
      { organizationId, propertyId: "property-1" }
    ),
    true
  );
});

test("organization scope never crosses tenant boundary", () => {
  assert.equal(
    isAuthorized(
      membership(),
      "property.read",
      { organizationId: "org-b", propertyId: "property-1" }
    ),
    false
  );
});

test("staff can write meter readings but cannot terminate leases", () => {
  const staff = membership({ role: "STAFF" });

  assert.equal(
    isAuthorized(staff, "meter.write", { organizationId, propertyId: "property-1" }),
    true
  );
  assert.equal(
    isAuthorized(staff, "lease.terminate", { organizationId, propertyId: "property-1" }),
    false
  );
});

test("accountant can reconcile payment within granted property scope", () => {
  const accountant = membership({
    role: "ACCOUNTANT",
    scopes: [{ type: "PROPERTY", propertyId: "property-9" }]
  });

  assert.equal(
    isAuthorized(
      accountant,
      "payment.reconcile",
      { organizationId, propertyId: "property-9" }
    ),
    true
  );

  assert.equal(
    isAuthorized(
      accountant,
      "payment.reconcile",
      { organizationId, propertyId: "property-10" }
    ),
    false
  );
});

test("operational group scope grants access only to resources in that group", () => {
  const manager = membership({
    role: "MANAGER",
    scopes: [{ type: "OPERATIONAL_GROUP", operationalGroupId: "west" }]
  });

  assert.equal(
    isAuthorized(
      manager,
      "property.manage",
      {
        organizationId,
        propertyId: "property-1",
        operationalGroupIds: ["west", "priority"]
      }
    ),
    true
  );

  assert.equal(
    isAuthorized(
      manager,
      "property.manage",
      {
        organizationId,
        propertyId: "property-2",
        operationalGroupIds: ["east"]
      }
    ),
    false
  );
});

test("suspended membership cannot access resources even when role and scope allow it", () => {
  assert.equal(
    isAuthorized(
      membership({ status: "SUSPENDED" }),
      "property.read",
      { organizationId, propertyId: "property-1" }
    ),
    false
  );
});

test("viewer cannot mutate property data", () => {
  assert.equal(
    isAuthorized(
      membership({ role: "VIEWER" }),
      "property.manage",
      { organizationId, propertyId: "property-1" }
    ),
    false
  );
});
