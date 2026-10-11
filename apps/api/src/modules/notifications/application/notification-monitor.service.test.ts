import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseService } from "../../database/database.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";
import { NotificationMonitorService } from "./notification-monitor.service.js";

const organizationId = "10000000-0000-4000-8000-000000000001";
const campaignId = "10000000-0000-4000-8000-000000000002";
const jobId = "10000000-0000-4000-8000-000000000003";

function build(role = "OWNER") {
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      const exists = params[0] === organizationId ||
        (sql.includes("SELECT id FROM notification_jobs") && params[1] === organizationId);
      if (!exists) return { rowCount: 0, rows: [] };
      if (sql.includes("COALESCE(pc.status")) {
        return {
          rowCount: 1, rows: [{
            status: "RUNNING",
            last_error_code: null,
            last_error_message: null,
            provider_status: "ACTIVE",
            provider_reason: null
          }]
        };
      }
      return { rowCount: 1, rows: [{ id: jobId }] };
    }
  } as unknown as DatabaseService;
  const principal = {
    organizationId,
    role
  } as TenantPrincipal;
  return { monitor: new NotificationMonitorService(db), principal };
}

test("Zalo monitor requires an admin and never starts automatically", async () => {
  const { monitor, principal } = build();
  const initial = await monitor.get(principal, campaignId, jobId);
  assert.equal(initial.watching, false);
  assert.equal(initial.frame, null);

  const staff = { ...principal, role: "STAFF" } as TenantPrincipal;
  await assert.rejects(
    () => monitor.setWatching(staff, campaignId, jobId, true),
    /Only organization admins/
  );
});

test("Zalo screenshot is ephemeral, opt-in, and never returned after stop", async () => {
  const { monitor, principal } = build();
  const photo = "data:image/jpeg;base64," + Buffer.from("sample").toString("base64");
  assert.equal((await monitor.publish(organizationId, jobId, {
    stage: "OPENING_ZALO",
    attemptNumber: 1,
    image: photo
  })).ok, false);

  await monitor.setWatching(principal, campaignId, jobId, true);
  assert.equal(monitor.active(organizationId, jobId, 1).watching, true);
  assert.equal((await monitor.publish(organizationId, jobId, {
    stage: "WAITING_FOR_SEARCH",
    attemptNumber: 1,
    image: photo
  })).ok, true);
  const watched = await monitor.get(principal, campaignId, jobId);
  assert.equal(watched.frame?.image, photo);
  assert.equal(watched.frame?.stage, "WAITING_FOR_SEARCH");

  await monitor.setWatching(principal, campaignId, jobId, false);
  assert.equal(monitor.active(organizationId, jobId, 1).watching, false);
  const after = await monitor.get(principal, campaignId, jobId);
  assert.equal(after.frame, null);
});

test("Zalo monitor rejects a frame with malformed or oversized image data", async () => {
  const { monitor, principal } = build();
  await monitor.setWatching(principal, campaignId, jobId, true);
  assert.equal((await monitor.publish(organizationId, jobId, {
    stage: "SEARCHING_PHONE",
    attemptNumber: 1,
    image: "data:text/html;base64,PGgxPk1hbGljaW91czwvaDE+"
  })).ok, false);
  assert.equal((await monitor.publish(organizationId, jobId, {
    stage: "SEARCHING_PHONE",
    attemptNumber: 1,
    image: "data:image/jpeg;base64," + "A".repeat(200001)
  })).ok, false);
});
