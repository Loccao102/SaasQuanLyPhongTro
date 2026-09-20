import assert from "node:assert/strict";
import test from "node:test";
import { platformRoleHasPermission } from "./platform-access.js";

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
