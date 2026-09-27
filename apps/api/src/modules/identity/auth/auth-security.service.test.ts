import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseService } from "../../database/database.service.js";
import { AuthSecurityService } from "./auth-security.service.js";

function serviceWithCounts(counts: number[]) {
  const queries: Array<{ text: string; values: readonly unknown[] }> = [];
  const db = {
    async query(text: string, values: readonly unknown[] = []) {
      queries.push({ text, values });
      if (text.includes("RETURNING attempt_count")) {
        return {
          rows: [{ attempt_count: counts.shift() ?? 1 }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    }
  } as unknown as DatabaseService;

  return { service: new AuthSecurityService(db), queries };
}

test("password login limiter uses hashed keys instead of raw email/IP", async () => {
  const previousKey = process.env.AUTH_SECURITY_HMAC_KEY;
  process.env.AUTH_SECURITY_HMAC_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef";

  try {
    const { service, queries } = serviceWithCounts([1, 1]);
    await service.assertPasswordLoginAllowed(
      "Owner@Example.com",
      "203.0.113.10"
    );

    const rateQueries = queries.filter((item) =>
      item.text.includes("auth_rate_limit_buckets")
    );
    assert.equal(rateQueries.length >= 2, true);

    for (const item of rateQueries.slice(0, 2)) {
      const serialized = JSON.stringify(
        item.values.map((value) =>
          Buffer.isBuffer(value) ? value.toString("hex") : value
        )
      );
      assert.equal(serialized.includes("owner@example.com"), false);
      assert.equal(serialized.includes("203.0.113.10"), false);
    }
  } finally {
    if (previousKey === undefined) {
      delete process.env.AUTH_SECURITY_HMAC_KEY;
    } else {
      process.env.AUTH_SECURITY_HMAC_KEY = previousKey;
    }
  }
});

test("password change limiter blocks after configured threshold", async () => {
  const previousLimit = process.env.AUTH_PASSWORD_CHANGE_MAX_PER_WINDOW;
  process.env.AUTH_PASSWORD_CHANGE_MAX_PER_WINDOW = "1";

  try {
    const { service } = serviceWithCounts([2]);
    await assert.rejects(
      () => service.assertPasswordChangeAllowed("00000000-0000-4000-8000-000000000001"),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes("Có quá nhiều yêu cầu xác thực")
    );
  } finally {
    if (previousLimit === undefined) {
      delete process.env.AUTH_PASSWORD_CHANGE_MAX_PER_WINDOW;
    } else {
      process.env.AUTH_PASSWORD_CHANGE_MAX_PER_WINDOW = previousLimit;
    }
  }
});
