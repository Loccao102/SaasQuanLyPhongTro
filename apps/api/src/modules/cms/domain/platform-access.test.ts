import assert from "node:assert/strict";
import test from "node:test";
import {
  platformPermissionsForRole,
  platformRoleHasPermission
} from "./platform-access.js";

test("platform admin has settings permission", () => {
  assert.equal(
    platformRoleHasPermission("PLATFORM_ADMIN", "platform.settings.manage"),
    true
  );
});

test("support operator cannot change plans", () => {
  assert.equal(
    platformRoleHasPermission("SUPPORT_OPERATOR", "platform.plans.manage"),
    false
  );
});

test("ops operator can manage jobs but not settings", () => {
  assert.equal(
    platformRoleHasPermission("OPS_OPERATOR", "platform.jobs.manage"),
    true
  );
  assert.equal(
    platformRoleHasPermission("OPS_OPERATOR", "platform.settings.manage"),
    false
  );
});

test("only platform admin gets entitlement override management by default", () => {
  assert.equal(
    platformRoleHasPermission(
      "PLATFORM_ADMIN",
      "platform.entitlements.manage"
    ),
    true
  );
  assert.equal(
    platformRoleHasPermission(
      "SUPPORT_OPERATOR",
      "platform.entitlements.manage"
    ),
    false
  );
  assert.equal(
    platformRoleHasPermission(
      "OPS_OPERATOR",
      "platform.entitlements.manage"
    ),
    false
  );
});

test("subscription lifecycle management is platform-admin only by default", () => {
  assert.equal(
    platformRoleHasPermission(
      "PLATFORM_ADMIN",
      "platform.subscriptions.manage"
    ),
    true
  );
  assert.equal(
    platformRoleHasPermission(
      "SUPPORT_OPERATOR",
      "platform.subscriptions.manage"
    ),
    false
  );
  assert.equal(
    platformRoleHasPermission(
      "OPS_OPERATOR",
      "platform.subscriptions.manage"
    ),
    false
  );
});

test("billing permissions are platform-admin only by default", () => {
  assert.equal(
    platformRoleHasPermission("PLATFORM_ADMIN", "platform.billing.read"),
    true
  );
  assert.equal(
    platformRoleHasPermission("PLATFORM_ADMIN", "platform.billing.manage"),
    true
  );

  for (const role of [
    "SUPPORT_OPERATOR",
    "OPS_OPERATOR",
    "READ_ONLY_AUDITOR"
  ] as const) {
    assert.equal(
      platformRoleHasPermission(role, "platform.billing.read"),
      false
    );
    assert.equal(
      platformRoleHasPermission(role, "platform.billing.manage"),
      false
    );
  }
});

test("permission bootstrap returns only capabilities granted to the role", () => {
  const support = platformPermissionsForRole("SUPPORT_OPERATOR");
  assert.deepEqual(
    support,
    [
      "platform.cms.read",
      "platform.organizations.inspect",
      "platform.audit.read"
    ]
  );

  const ops = platformPermissionsForRole("OPS_OPERATOR");
  assert.deepEqual(
    ops,
    [
      "platform.cms.read",
      "platform.jobs.read",
      "platform.jobs.manage",
      "platform.audit.read",
      "platform.logs.read"
    ]
  );
});
