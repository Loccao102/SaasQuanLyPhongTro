import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";
import type { DatabaseService } from "../database/database.service.js";
import { CmsBillingDetailService } from "./cms-billing-detail.service.js";
import type { PlatformPrincipal } from "./cms.types.js";

class FakeDatabase {
  readonly queries: Array<{ text: string; values?: unknown[] }> = [];

  async query<T extends QueryResultRow>(text: string, values?: unknown[]) {
    this.queries.push({ text, values });

    // Handle count query
    if (text.includes("SELECT count(*)::text AS total")) {
      return { rows: [{ total: "1" }] as unknown as T[] };
    }

    // Handle items query
    if (text.includes("FROM saas_subscription_invoices i") && text.includes("LIMIT")) {
      return {
        rows: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            organization_id: "22222222-2222-2222-2222-222222222222",
            organization_name: "Nhà Trọ Sài Gòn",
            organization_slug: "nha-tro-sai-gon",
            subscription_id: "33333333-3333-3333-3333-333333333333",
            plan_id: "44444444-4444-4444-4444-444444444444",
            plan_version_id: "55555555-5555-5555-5555-555555555555",
            plan_code: "GROWTH",
            billing_interval: "MONTHLY",
            period_start: new Date("2026-09-01T00:00:00Z"),
            period_end: new Date("2026-10-01T00:00:00Z"),
            amount_vnd: "499000",
            payment_reference: "SUB123456",
            status: "PAID",
            issued_at: new Date("2026-09-01T00:00:00Z"),
            due_at: new Date("2026-09-05T00:00:00Z"),
            paid_at: new Date("2026-09-02T10:00:00Z"),
            created_at: new Date("2026-09-01T00:00:00Z"),
            updated_at: new Date("2026-09-02T10:00:00Z"),
            paid_amount_vnd: "499000",
            remaining_amount_vnd: "0",
            is_overdue: false
          }
        ] as unknown as T[]
      };
    }

    // Handle overall stats query
    if (text.includes("total_revenue_vnd")) {
      return {
        rows: [
          {
            total_invoices: "10",
            paid_invoices: "8",
            open_invoices: "2",
            void_invoices: "0",
            total_revenue_vnd: "3992000",
            pending_revenue_vnd: "998000",
            monthly_revenue_vnd: "3992000",
            yearly_revenue_vnd: "0"
          }
        ] as unknown as T[]
      };
    }

    // Handle plan breakdown
    if (text.includes("invoice_count")) {
      return {
        rows: [
          {
            plan_code: "GROWTH",
            invoice_count: "8",
            paid_count: "8",
            revenue_vnd: "3992000"
          }
        ] as unknown as T[]
      };
    }

    // Handle subscription distribution
    if (text.includes("FROM organization_subscriptions s")) {
      return {
        rows: [
          {
            plan_code: "GROWTH",
            status: "ACTIVE",
            count: "5"
          }
        ] as unknown as T[]
      };
    }

    return { rows: [] as T[] };
  }
}

function principal(role: PlatformPrincipal["role"]): PlatformPrincipal {
  return {
    userId: "00000000-0000-0000-0000-000000000001",
    role
  };
}

test("listInvoices rejects principal without platform.billing.read permission", async () => {
  const database = new FakeDatabase();
  const service = new CmsBillingDetailService(
    database as unknown as DatabaseService
  );

  await assert.rejects(
    () => service.listInvoices(principal("SUPPORT_OPERATOR"), {}),
    /Platform permission denied/
  );
});

test("listInvoices returns mapped items, pagination, and statistics for authorized principal", async () => {
  const database = new FakeDatabase();
  const service = new CmsBillingDetailService(
    database as unknown as DatabaseService
  );

  const result = await service.listInvoices(principal("PLATFORM_ADMIN"), {
    status: "PAID",
    plan: "GROWTH",
    q: "Sài Gòn",
    page: 1,
    limit: 20
  });

  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item?.id, "11111111-1111-1111-1111-111111111111");
  assert.equal(item?.organizationName, "Nhà Trọ Sài Gòn");
  assert.equal(item?.planCode, "GROWTH");
  assert.equal(item?.amountVnd, 499000);
  assert.equal(item?.paidAmountVnd, 499000);
  assert.equal(item?.status, "PAID");
  assert.equal(item?.paymentReference, "SUB123456");

  // Check pagination
  assert.equal(result.pagination.total, 1);
  assert.equal(result.pagination.page, 1);
  assert.equal(result.pagination.limit, 20);

  // Check statistics
  assert.equal(result.statistics.totalRevenueVnd, 3992000);
  assert.equal(result.statistics.pendingRevenueVnd, 998000);
  assert.equal(result.statistics.paidInvoicesCount, 8);
  assert.equal(result.statistics.openInvoicesCount, 2);
  assert.equal(result.statistics.planBreakdown.length, 1);
  assert.equal(result.statistics.planBreakdown[0]?.planCode, "GROWTH");
  assert.equal(result.statistics.subscriptionDistribution[0]?.count, 5);

  // Verify SQL queries included filters
  const countQuery = database.queries.find((q) =>
    q.text.includes("SELECT count(*)::text AS total")
  );
  assert.ok(countQuery);
  assert.match(countQuery.text, /i\.status = \$1/);
  assert.match(countQuery.text, /UPPER\(p\.code\) = UPPER\(\$2\)/);
  assert.match(countQuery.text, /o\.name ILIKE \$3/);
  assert.deepEqual(countQuery.values, ["PAID", "GROWTH", "%Sài Gòn%"]);
});
