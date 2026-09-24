import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { AutomationQuotaService } from "../commercial/application/automation-quota.service.js";
import { CommercialPolicyService } from "../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../database/database.service.js";
import { AccessControlService } from "../identity/access-control.service.js";
import type { TenantPrincipal } from "../identity/tenant-principal.js";
import { NotificationCampaignService } from "../notifications/application/notification-campaign.service.js";
import { NotificationWorkerService } from "../notifications/application/notification-worker.service.js";
import { RenterPaymentsService } from "../renter-payments/renter-payments.service.js";
import { RenterInvoiceNotificationService } from "./renter-invoice-notification.service.js";
import { RenterPublicInvoiceService } from "./renter-public-invoice.service.js";

const org = "aa000000-0000-4000-8000-000000000001";
const user = "aa000000-0000-4000-8000-000000000002";
const membership = "aa000000-0000-4000-8000-000000000003";
const property = "aa000000-0000-4000-8000-000000000004";
const room1 = "aa000000-0000-4000-8000-000000000005";
const room2 = "aa000000-0000-4000-8000-000000000006";
const resident1 = "aa000000-0000-4000-8000-000000000007";
const resident2 = "aa000000-0000-4000-8000-000000000008";
const lease1 = "aa000000-0000-4000-8000-000000000009";
const lease2 = "aa000000-0000-4000-8000-00000000000a";
const cycle = "aa000000-0000-4000-8000-00000000000b";
const invoice1 = "aa000000-0000-4000-8000-00000000000c";
const invoice2 = "aa000000-0000-4000-8000-00000000000d";

const principal: TenantPrincipal = {
  userId: user,
  membershipId: membership,
  organizationId: org,
  organizationName: "Invoice Notify Test",
  role: "OWNER",
  membership: {
    organizationId: org,
    role: "OWNER",
    status: "ACTIVE",
    scopes: [{ type: "ORGANIZATION" }]
  }
};

async function cleanup(pool: Pool) {
  await pool.query("DELETE FROM notification_campaigns WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM automation_quota_reservations WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM automation_quota_periods WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM renter_invoice_public_links WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM renter_invoice_lines WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM renter_invoices WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM renter_billing_cycles WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM lease_residents WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM leases WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM residents WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM rooms WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM properties WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM membership_scopes WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM organization_memberships WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM organization_entitlement_overrides WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM organization_subscriptions WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM audit_events WHERE organization_id = $1", [org]);
  await pool.query("DELETE FROM organizations WHERE id = $1", [org]);
  await pool.query("DELETE FROM users WHERE id = $1", [user]);
}

test("finalized billing cycle creates idempotent personalized invoice jobs with fresh public links", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString);

  const oldBase = process.env.PUBLIC_INVOICE_BASE_URL;
  process.env.PUBLIC_INVOICE_BASE_URL = "https://pay.example.test";

  const pool = new Pool({ connectionString });
  const db = new DatabaseService();
  const access = new AccessControlService();
  const commercial = new CommercialPolicyService();
  const quota = new AutomationQuotaService(db, commercial);
  const campaigns = new NotificationCampaignService(db, access, quota);
  const payments = new RenterPaymentsService(db, access, commercial);
  const publicInvoices = new RenterPublicInvoiceService(
    db,
    access,
    commercial,
    payments
  );
  const notifications = new RenterInvoiceNotificationService(
    db,
    access,
    commercial,
    campaigns,
    publicInvoices
  );
  const worker = new NotificationWorkerService(db, quota, commercial);

  try {
    await cleanup(pool);

    await pool.query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, 'invoice-notify@example.invalid', 'Invoice Notify')`,
      [user]
    );
    await pool.query(
      `INSERT INTO organizations (id, slug, name, organization_type, status)
       VALUES ($1, 'invoice-notify-test', 'Invoice Notify Test', 'INDIVIDUAL', 'ACTIVE')`,
      [org]
    );
    await pool.query(
      `INSERT INTO organization_memberships (
         id, organization_id, user_id, role, status
       ) VALUES ($1, $2, $3, 'OWNER', 'ACTIVE')`,
      [membership, org, user]
    );
    await pool.query(
      `INSERT INTO membership_scopes (
         organization_id, membership_id, scope_type
       ) VALUES ($1, $2, 'ORGANIZATION')`,
      [org, membership]
    );
    await pool.query(
      `INSERT INTO organization_subscriptions (
         organization_id, plan_id, plan_version_id, status
       )
       SELECT $1, id, current_version_id, 'ACTIVE'
       FROM saas_plans
       WHERE code = 'STARTER'`,
      [org]
    );
    await pool.query(
      `INSERT INTO properties (id, organization_id, code, name, property_type)
       VALUES ($1, $2, 'NTF', 'Nhà trọ Notify', 'BOARDING_HOUSE')`,
      [property, org]
    );
    await pool.query(
      `INSERT INTO rooms (id, organization_id, property_id, code, name)
       VALUES
         ($1, $3, $4, '101', 'Phòng 101'),
         ($2, $3, $4, '102', 'Phòng 102')`,
      [room1, room2, org, property]
    );
    await pool.query(
      `INSERT INTO residents (id, organization_id, full_name, phone)
       VALUES
         ($1, $3, 'Nguyễn A', '0901234567'),
         ($2, $3, 'Nguyễn A', '0901234567')`,
      [resident1, resident2, org]
    );
    await pool.query(
      `INSERT INTO leases (
         id, organization_id, room_id, lease_code, status,
         start_date, base_rent_vnd, deposit_required_vnd, billing_day
       ) VALUES
         ($1, $3, $4, 'LEASE-N1', 'ACTIVE', '2026-09-01', 1000000, 0, 5),
         ($2, $3, $5, 'LEASE-N2', 'ACTIVE', '2026-09-01', 1200000, 0, 5)`,
      [lease1, lease2, org, room1, room2]
    );
    await pool.query(
      `INSERT INTO lease_residents (
         organization_id, lease_id, resident_id, party_role, joined_on
       ) VALUES
         ($1, $2, $3, 'PRIMARY_TENANT', '2026-09-01'),
         ($1, $4, $5, 'PRIMARY_TENANT', '2026-09-01')`,
      [org, lease1, resident1, lease2, resident2]
    );
    await pool.query(
      `INSERT INTO renter_billing_cycles (
         id, organization_id, property_id, cycle_code,
         period_start, period_end, due_date, status, finalized_at
       ) VALUES (
         $1, $2, $3, '2026-09', '2026-09-01', '2026-09-30',
         '2026-10-05', 'FINALIZED', now()
       )`,
      [cycle, org, property]
    );
    await pool.query(
      `INSERT INTO renter_invoices (
         id, organization_id, billing_cycle_id, property_id, room_id, lease_id,
         invoice_number, payment_reference, status,
         period_start, period_end, due_date,
         property_name_snapshot, room_code_snapshot, lease_code_snapshot,
         primary_resident_name_snapshot,
         subtotal_vnd, adjustment_vnd, previous_balance_vnd, total_vnd,
         paid_vnd, remaining_vnd, collection_status,
         calculation_status, review_reasons, issued_at
       ) VALUES
         (
           $1, $3, $4, $5, $6, $7,
           'INV-N1', 'RENTNOTIFY001', 'ISSUED',
           '2026-09-01', '2026-09-30', '2026-10-05',
           'Nhà trọ Notify', '101', 'LEASE-N1', 'Nguyễn A',
           1000000, 0, 0, 1000000, 0, 1000000, 'UNPAID',
           'READY', '[]'::jsonb, now()
         ),
         (
           $2, $3, $4, $5, $8, $9,
           'INV-N2', 'RENTNOTIFY002', 'ISSUED',
           '2026-09-01', '2026-09-30', '2026-10-05',
           'Nhà trọ Notify', '102', 'LEASE-N2', 'Nguyễn A',
           1200000, 0, 0, 1200000, 0, 1200000, 'UNPAID',
           'READY', '[]'::jsonb, now()
         )`,
      [invoice1, invoice2, org, cycle, property, room1, lease1, room2, lease2]
    );

    const first = await notifications.createCycleCampaign(
      principal,
      cycle,
      "invoice-notify-2026-09"
    );
    assert.equal(first.replayed, false);
    assert.equal(first.invoiceCount, 2);
    assert.equal(first.recipientCount, 1);
    assert.equal(first.skippedInvoiceCount, 0);
    assert.equal(first.campaign.totalRecipients, 1);

    const linksBefore = await pool.query<{ invoice_id: string; token_hash: string }>(
      `SELECT invoice_id::text, token_hash
       FROM renter_invoice_public_links
       WHERE organization_id = $1 AND status = 'ACTIVE'
       ORDER BY invoice_id`,
      [org]
    );
    assert.equal(linksBefore.rows.length, 2);

    const replay = await notifications.createCycleCampaign(
      principal,
      cycle,
      "invoice-notify-2026-09"
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.campaign.id, first.campaign.id);

    const linksAfter = await pool.query<{ invoice_id: string; token_hash: string }>(
      `SELECT invoice_id::text, token_hash
       FROM renter_invoice_public_links
       WHERE organization_id = $1 AND status = 'ACTIVE'
       ORDER BY invoice_id`,
      [org]
    );
    assert.deepEqual(linksAfter.rows, linksBefore.rows);

    const job = await worker.claimNext("PLAYWRIGHT_ZALO");
    assert.ok(job);
    assert.equal(job.recipientKey, "0901234567");
    assert.match(job.messageBody, /Phòng 101: 1\.000\.000đ/);
    assert.match(job.messageBody, /Phòng 102: 1\.200\.000đ/);
    assert.equal(
      (job.messageBody.match(/https:\/\/pay\.example\.test\/i\/habi_inv_/g) ?? []).length,
      2
    );

    const audit = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM audit_events
       WHERE organization_id = $1
         AND action = 'RENTER_INVOICE_NOTIFICATION_CAMPAIGN_CREATED'
         AND resource_id = $2`,
      [org, cycle]
    );
    assert.equal(audit.rows[0]?.count, 1);
  } finally {
    await db.onModuleDestroy();
    await cleanup(pool);
    await pool.end();
    if (oldBase === undefined) {
      delete process.env.PUBLIC_INVOICE_BASE_URL;
    } else {
      process.env.PUBLIC_INVOICE_BASE_URL = oldBase;
    }
  }
});
