import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeOrganizationDirectoryCursor,
  encodeOrganizationDirectoryCursor,
  normalizeOrganizationDirectoryFilters
} from "./organization-directory-query.js";

test("organization directory cursor round trips", () => {
  const cursor = {
    createdAt: "2026-09-22T01:02:03.000Z",
    id: "00000000-0000-0000-0000-000000000123"
  };
  assert.deepEqual(
    decodeOrganizationDirectoryCursor(
      encodeOrganizationDirectoryCursor(cursor)
    ),
    cursor
  );
});

test("organization directory normalizes optional filters", () => {
  const filters = normalizeOrganizationDirectoryFilters({
    query: "  habi  ",
    plan: "PRO",
    subscriptionStatus: "PAST_DUE",
    delinquent: "true",
    overLimit: "false",
    limit: "50"
  });

  assert.equal(filters.query, "habi");
  assert.equal(filters.plan, "PRO");
  assert.equal(filters.subscriptionStatus, "PAST_DUE");
  assert.equal(filters.delinquent, true);
  assert.equal(filters.overLimit, false);
  assert.equal(filters.limit, 50);
});

test("organization directory rejects invalid limit", () => {
  assert.throws(() =>
    normalizeOrganizationDirectoryFilters({ limit: "101" })
  );
});

test("organization directory rejects invalid boolean", () => {
  assert.throws(() =>
    normalizeOrganizationDirectoryFilters({ delinquent: "yes" })
  );
});
