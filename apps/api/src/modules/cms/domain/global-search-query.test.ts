import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGlobalSearchInput } from "./global-search-query.js";

test("global search trims query and applies default scope limit", () => {
  assert.deepEqual(
    normalizeGlobalSearchInput({ query: "  HAB-123  " }),
    { query: "HAB-123", limit: 8 }
  );
});

test("global search accepts bounded custom limit", () => {
  assert.equal(
    normalizeGlobalSearchInput({ query: "org", limit: "20" }).limit,
    20
  );
});

test("global search rejects too-short query", () => {
  assert.throws(() => normalizeGlobalSearchInput({ query: "x" }));
});

test("global search rejects unsafe limit", () => {
  assert.throws(() =>
    normalizeGlobalSearchInput({ query: "invoice", limit: "21" })
  );
});
