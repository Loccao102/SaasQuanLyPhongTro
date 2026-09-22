import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";
import type { DatabaseService } from "../database/database.service.js";
import { CmsGlobalSearchService } from "./cms-global-search.service.js";
import type { PlatformPrincipal } from "./cms.types.js";

class FakeDatabase {
  readonly calls: string[] = [];

  async query<T extends QueryResultRow>(text: string) {
    this.calls.push(text);
    return { rows: [] as T[] };
  }
}

function principal(role: PlatformPrincipal["role"]): PlatformPrincipal {
  return {
    userId: "00000000-0000-0000-0000-000000000001",
    role
  };
}

test("read-only auditor global search does not query restricted operational scopes", async () => {
  const database = new FakeDatabase();
  const service = new CmsGlobalSearchService(
    database as unknown as DatabaseService
  );

  const result = await service.search(
    principal("READ_ONLY_AUDITOR"),
    { query: "abc" }
  );

  assert.equal(database.calls.length, 0);
  assert.deepEqual(result.scopes, {
    organizations: false,
    billing: false,
    jobs: false
  });
  assert.deepEqual(result.items, []);
});

test("support global search only queries organizations", async () => {
  const database = new FakeDatabase();
  const service = new CmsGlobalSearchService(
    database as unknown as DatabaseService
  );

  const result = await service.search(
    principal("SUPPORT_OPERATOR"),
    { query: "habi" }
  );

  assert.equal(database.calls.length, 1);
  assert.match(database.calls[0] ?? "", /FROM organizations o/);
  assert.deepEqual(result.scopes, {
    organizations: true,
    billing: false,
    jobs: false
  });
});

test("ops global search only queries notification jobs", async () => {
  const database = new FakeDatabase();
  const service = new CmsGlobalSearchService(
    database as unknown as DatabaseService
  );

  const result = await service.search(
    principal("OPS_OPERATOR"),
    { query: "recipient" }
  );

  assert.equal(database.calls.length, 1);
  assert.match(database.calls[0] ?? "", /FROM notification_jobs j/);
  assert.deepEqual(result.scopes, {
    organizations: false,
    billing: false,
    jobs: true
  });
});

test("platform admin global search queries every operational scope", async () => {
  const database = new FakeDatabase();
  const service = new CmsGlobalSearchService(
    database as unknown as DatabaseService
  );

  const result = await service.search(
    principal("PLATFORM_ADMIN"),
    { query: "reference" }
  );

  assert.equal(database.calls.length, 4);
  assert.equal(result.scopes.organizations, true);
  assert.equal(result.scopes.billing, true);
  assert.equal(result.scopes.jobs, true);
});
