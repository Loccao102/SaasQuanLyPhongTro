import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSameOrganization,
  CrossOrganizationReferenceError
} from "./tenant-scope.js";

test("same-organization reference is accepted", () => {
  assert.doesNotThrow(() => assertSameOrganization("org-a", "org-a"));
});

test("cross-organization reference is rejected", () => {
  assert.throws(
    () => assertSameOrganization("org-a", "org-b"),
    CrossOrganizationReferenceError
  );
});
