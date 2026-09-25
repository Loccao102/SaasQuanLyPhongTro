import assert from "node:assert/strict";
import test from "node:test";
import { LeaseTerminationReadinessService } from "./lease-termination-readiness.service.js";

function createMockDb(queries: Record<string, (sql: string, params: unknown[]) => unknown>) {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      for (const [key, handler] of Object.entries(queries)) {
        if (sql.includes(key)) {
          return handler(sql, params);
        }
      }
      return { rows: [], rowCount: 0 };
    }
  };

  return {
    withTransaction: async <T>(fn: (c: typeof client) => Promise<T>): Promise<T> => {
      return fn(client);
    },
    query: client.query
  };
}

function mockPrincipal() {
  return {
    userId: "00000000-0000-0000-0000-000000000001",
    organizationId: "00000000-0000-0000-0000-000000000010",
    role: "OWNER" as const,
    membership: {
      id: "mem-1",
      role: "OWNER" as const,
      status: "ACTIVE" as const,
      organizationScope: true,
      propertyScopes: [],
      operationalGroupScopes: []
    },
    email: "owner@example.com",
    fullName: "Owner User",
    organizationName: "Test Org"
  };
}

test("setManualReadiness requires a non-empty reason", async () => {
  const service = new LeaseTerminationReadinessService(
    createMockDb({}) as any,
    { can: () => true } as any,
    { assertTenantWriteAllowed: async () => {} } as any
  );

  await assert.rejects(
    () =>
      service.setManualReadiness(mockPrincipal(), "00000000-0000-0000-0000-000000000100", {
        kind: "meter",
        state: "READY",
        reason: "   "
      }),
    /A reason is required/
  );
});

test("syncReadinessFromSystem derives READY when deposit is settled, no debt, and meters read", async () => {
  const queries = {
    "FROM leases l": () => ({
      rows: [
        {
          lease_id: "00000000-0000-0000-0000-000000000100",
          room_id: "00000000-0000-0000-0000-000000000200",
          property_id: "00000000-0000-0000-0000-000000000300",
          lease_status: "TERMINATION_SCHEDULED",
          termination_id: "00000000-0000-0000-0000-000000000400",
          termination_effective_date: "2026-10-31",
          operational_group_ids: []
        }
      ],
      rowCount: 1
    }),
    "FROM lease_deposits": () => ({
      rows: [{ remaining_held_vnd: "0", deposit_required_vnd: "3000000" }],
      rowCount: 1
    }),
    "FROM renter_invoices": () => ({
      rows: [{ unpaid_count: "0" }],
      rowCount: 1
    }),
    "FROM meters m": () => ({
      rows: [
        { meter_id: "m-elec", max_reading_date: "2026-10-31" },
        { meter_id: "m-water", max_reading_date: "2026-10-31" }
      ],
      rowCount: 2
    }),
    "UPDATE lease_terminations": (_sql: string, params: unknown[]) => {
      // params: [orgId, terminationId, meterReady, financialReady, depositReady]
      assert.equal(params[2], "READY");
      assert.equal(params[3], "READY");
      assert.equal(params[4], "READY");
      return {
        rows: [
          {
            meter_readiness: "READY",
            financial_readiness: "READY",
            deposit_readiness: "READY",
            status: "READY"
          }
        ],
        rowCount: 1
      };
    },
    "INSERT INTO audit_events": () => ({ rows: [], rowCount: 1 })
  };

  const service = new LeaseTerminationReadinessService(
    createMockDb(queries) as any,
    { can: () => true } as any,
    { assertTenantWriteAllowed: async () => {} } as any
  );

  const result = await service.syncReadinessFromSystem(
    mockPrincipal(),
    "00000000-0000-0000-0000-000000000100"
  );

  assert.equal(result.meter, "READY");
  assert.equal(result.financial, "READY");
  assert.equal(result.deposit, "READY");
  assert.equal(result.status, "READY");
});

test("recordFinalMeterReading records reading and updates meter readiness", async () => {
  const queries = {
    "FROM leases l": () => ({
      rows: [
        {
          lease_id: "00000000-0000-0000-0000-000000000100",
          room_id: "00000000-0000-0000-0000-000000000200",
          property_id: "00000000-0000-0000-0000-000000000300",
          lease_status: "TERMINATION_SCHEDULED",
          termination_id: "00000000-0000-0000-0000-000000000400",
          termination_effective_date: "2026-10-31",
          operational_group_ids: []
        }
      ],
      rowCount: 1
    }),
    "meter_type, unit\n         FROM meters": () => ({
      rows: [{ id: "m-elec", meter_type: "ELECTRICITY", unit: "KWH" }],
      rowCount: 1
    }),
    "INSERT INTO meter_readings": () => ({ rows: [], rowCount: 1 }),
    "INSERT INTO audit_events": () => ({ rows: [], rowCount: 1 }),
    "NOT EXISTS": () => ({
      // no remaining meters without reading
      rows: [],
      rowCount: 0
    }),
    "UPDATE lease_terminations": (_sql: string, params: unknown[]) => {
      assert.equal(params[2], "READY");
      return {
        rows: [
          {
            meter_readiness: "READY",
            financial_readiness: "READY",
            deposit_readiness: "READY",
            status: "READY"
          }
        ],
        rowCount: 1
      };
    }
  };

  const service = new LeaseTerminationReadinessService(
    createMockDb(queries) as any,
    { can: () => true } as any,
    { assertTenantWriteAllowed: async () => {} } as any
  );

  const result = await service.recordFinalMeterReading(
    mockPrincipal(),
    "00000000-0000-0000-0000-000000000100",
    {
      meterId: "m-elec",
      readingDate: "2026-10-31",
      readingValue: 245.5
    }
  );

  assert.equal(result.meter, "READY");
  assert.equal(result.reading.readingValue, "245.500");
});
