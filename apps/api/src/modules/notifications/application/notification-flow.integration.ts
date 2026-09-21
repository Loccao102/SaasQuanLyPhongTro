import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { AutomationQuotaService } from "../../commercial/application/automation-quota.service.js";
import {
  CommercialPolicyService,
  CommercialWriteRestrictedError
} from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { MembershipAccess } from "../../identity/domain/access-control.js";
import { NotificationCampaignService } from "./notification-campaign.service.js";
import { NotificationOperationsService } from "./notification-operations.service.js";
import { NotificationWorkerService } from "./notification-worker.service.js";

const organizationId = "c1000000-0000-0000-0000-000000000001";
const actorUserId = "c2000000-0000-0000-0000-000000000001";
const membershipId = "c3000000-0000-0000-0000-000000000001";

function actor() {
  const membership: MembershipAccess = {
    organizationId,
    role: "OWNER",
    status: "ACTIVE",
    scopes: [{ type: "ORGANIZATION" }]
  };

  return {
    userId: actorUserId,
    membership
  };
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    "DELETE FROM notification_attempts WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM notification_jobs WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM notification_campaigns WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM automation_quota_consumptions WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM automation_quota_reservations WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM automation_quota_periods WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM organization_entitlement_overrides WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM organization_subscriptions WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM audit_events WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM organization_memberships WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
  await pool.query("DELETE FROM users WHERE id = $1", [actorUserId]);
}

test("notification campaign and worker flow is durable, quota-safe and evidence-aware", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set for integration test.");

  const fixturePool = new Pool({ connectionString });
  const database = new DatabaseService();
  const accessControl = new AccessControlService();
  const commercialPolicy = new CommercialPolicyService();
  const quota = new AutomationQuotaService(database, commercialPolicy);
  const campaigns = new NotificationCampaignService(
    database,
    accessControl,
    quota
  );
  const worker = new NotificationWorkerService(
    database,
    quota,
    commercialPolicy
  );
  const operations = new NotificationOperationsService(database);

  try {
    await cleanup(fixturePool);

    await fixturePool.query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, 'notification-owner@example.invalid', 'Notification Owner')`,
      [actorUserId]
    );

    await fixturePool.query(
      `INSERT INTO organizations (
         id, slug, name, organization_type, status
       )
       VALUES (
         $1, 'notification-test-org', 'Notification Test Org', 'INDIVIDUAL', 'ACTIVE'
       )`,
      [organizationId]
    );

    await fixturePool.query(
      `INSERT INTO organization_memberships (
         id, organization_id, user_id, role, status
       )
       VALUES ($1, $2, $3, 'OWNER', 'ACTIVE')`,
      [membershipId, organizationId, actorUserId]
    );

    await fixturePool.query(
      `INSERT INTO organization_subscriptions (
         organization_id,
         plan_id,
         plan_version_id,
         status
       )
       SELECT $1, p.id, p.current_version_id, 'ACTIVE'
       FROM saas_plans p
       WHERE p.code = 'STARTER'`,
      [organizationId]
    );

    await fixturePool.query(
      `INSERT INTO organization_entitlement_overrides (
         organization_id,
         entitlement_key,
         value,
         reason,
         created_by_user_id
       )
       VALUES (
         $1,
         'automation_actions_monthly',
         '2'::jsonb,
         'Notification integration quota',
         $2
       )`,
      [organizationId, actorUserId]
    );

    const campaign = await campaigns.create({
      actor: actor(),
      organizationId,
      idempotencyKey: "notification-campaign-001",
      channel: "ZALO",
      provider: "PLAYWRIGHT_ZALO",
      messageBody: "Tiền phòng tháng này đã được cập nhật.",
      recipients: [
        {
          recipientKey: "zalo-user-002",
          recipientDisplayName: "Người thuê B"
        },
        {
          recipientKey: "zalo-user-001",
          recipientDisplayName: "Người thuê A"
        }
      ]
    });

    const replayedCampaign = await campaigns.create({
      actor: actor(),
      organizationId,
      idempotencyKey: "notification-campaign-001",
      channel: "ZALO",
      provider: "PLAYWRIGHT_ZALO",
      messageBody: "Tiền phòng tháng này đã được cập nhật.",
      recipients: [
        {
          recipientKey: "zalo-user-001",
          recipientDisplayName: "Người thuê A"
        },
        {
          recipientKey: "zalo-user-002",
          recipientDisplayName: "Người thuê B"
        }
      ]
    });

    assert.deepEqual(replayedCampaign, campaign);
    assert.equal(campaign.totalRecipients, 2);
    assert.equal(campaign.queued, 2);

    const quotaAfterCampaign = await fixturePool.query<{
      reserved_actions: number;
      consumed_actions: number;
    }>(
      `SELECT reserved_actions, consumed_actions
       FROM automation_quota_periods
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(quotaAfterCampaign.rows[0]?.reserved_actions, 2);
    assert.equal(quotaAfterCampaign.rows[0]?.consumed_actions, 0);

    const firstClaim = await worker.claimNext("PLAYWRIGHT_ZALO");
    assert.ok(firstClaim);
    assert.equal(firstClaim.recipientKey, "zalo-user-001");
    assert.equal(firstClaim.attemptNumber, 1);

    const retryWait = await worker.completeAttempt({
      organizationId,
      jobId: firstClaim.id,
      attemptNumber: 1,
      result: {
        kind: "TRANSIENT_FAILURE",
        errorCode: "TIMEOUT",
        errorMessage: "Provider UI timed out"
      }
    });
    assert.equal(retryWait.status, "RETRY_WAIT");

    const quotaAfterFirstAttempt = await fixturePool.query<{
      reserved_actions: number;
      consumed_actions: number;
    }>(
      `SELECT reserved_actions, consumed_actions
       FROM automation_quota_periods
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(quotaAfterFirstAttempt.rows[0]?.reserved_actions, 1);
    assert.equal(quotaAfterFirstAttempt.rows[0]?.consumed_actions, 1);

    await fixturePool.query(
      `UPDATE notification_jobs
       SET next_attempt_at = now() - interval '1 second'
       WHERE organization_id = $1
         AND id = $2`,
      [organizationId, firstClaim.id]
    );

    const retryClaim = await worker.claimNext("PLAYWRIGHT_ZALO");
    assert.ok(retryClaim);
    assert.equal(retryClaim.id, firstClaim.id);
    assert.equal(retryClaim.attemptNumber, 2);

    const quotaDuringRetry = await fixturePool.query<{
      reserved_actions: number;
      consumed_actions: number;
    }>(
      `SELECT reserved_actions, consumed_actions
       FROM automation_quota_periods
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(quotaDuringRetry.rows[0]?.reserved_actions, 1);
    assert.equal(quotaDuringRetry.rows[0]?.consumed_actions, 1);

    const sentFirst = await worker.completeAttempt({
      organizationId,
      jobId: retryClaim.id,
      attemptNumber: 2,
      result: {
        kind: "SENT_CONFIRMED",
        recipientVerified: true,
        sendVerified: true,
        providerReference: "provider-message-001",
        evidence: { confirmation: "visible" }
      }
    });
    assert.equal(sentFirst.status, "SENT");
    assert.equal(sentFirst.verificationState, "VERIFIED");

    const secondClaim = await worker.claimNext("PLAYWRIGHT_ZALO");
    assert.ok(secondClaim);
    assert.equal(secondClaim.recipientKey, "zalo-user-002");

    const unknownSecond = await worker.completeAttempt({
      organizationId,
      jobId: secondClaim.id,
      attemptNumber: 1,
      result: {
        kind: "UNKNOWN",
        errorCode: "AMBIGUOUS_SEND_STATE",
        errorMessage: "Could not verify provider confirmation",
        evidence: { providerUiChanged: true }
      }
    });
    assert.equal(unknownSecond.status, "MANUAL_REVIEW");
    assert.notEqual(unknownSecond.status, "SENT");

    const quotaAfterBothRecipients = await fixturePool.query<{
      reserved_actions: number;
      consumed_actions: number;
    }>(
      `SELECT reserved_actions, consumed_actions
       FROM automation_quota_periods
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(quotaAfterBothRecipients.rows[0]?.reserved_actions, 0);
    assert.equal(quotaAfterBothRecipients.rows[0]?.consumed_actions, 2);

    const jobsBeforeRetry = await operations.listJobs();
    const secondJob = jobsBeforeRetry.find((job) => job.id === secondClaim.id);
    assert.ok(secondJob);
    assert.equal(secondJob.status, "MANUAL_REVIEW");

    const retryRequest = await database.withTransaction((client) =>
      operations.retryJobInTransaction(client, secondClaim.id)
    );
    assert.equal(retryRequest.before.status, "MANUAL_REVIEW");
    assert.equal(retryRequest.after.status, "QUEUED");

    await fixturePool.query(
      `UPDATE organization_subscriptions
       SET status = 'SUSPENDED',
           version = version + 1,
           updated_at = now()
       WHERE organization_id = $1`,
      [organizationId]
    );

    await assert.rejects(
      () => worker.claimNext("PLAYWRIGHT_ZALO"),
      CommercialWriteRestrictedError
    );

    await fixturePool.query(
      `UPDATE organization_subscriptions
       SET status = 'ACTIVE',
           version = version + 1,
           updated_at = now()
       WHERE organization_id = $1`,
      [organizationId]
    );

    const manualRetryClaim = await worker.claimNext("PLAYWRIGHT_ZALO");
    assert.ok(manualRetryClaim);
    assert.equal(manualRetryClaim.id, secondClaim.id);
    assert.equal(manualRetryClaim.attemptNumber, 2);

    const sentSecond = await worker.completeAttempt({
      organizationId,
      jobId: manualRetryClaim.id,
      attemptNumber: 2,
      result: {
        kind: "SENT_CONFIRMED",
        recipientVerified: true,
        sendVerified: true,
        providerReference: "provider-message-002"
      }
    });
    assert.equal(sentSecond.status, "SENT");

    const finalCampaign = await fixturePool.query<{
      status: string;
    }>(
      `SELECT status
       FROM notification_campaigns
       WHERE organization_id = $1
         AND id = $2`,
      [organizationId, campaign.id]
    );
    assert.equal(finalCampaign.rows[0]?.status, "COMPLETED");

    const finalQuota = await fixturePool.query<{
      reserved_actions: number;
      consumed_actions: number;
    }>(
      `SELECT reserved_actions, consumed_actions
       FROM automation_quota_periods
       WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(finalQuota.rows[0]?.reserved_actions, 0);
    assert.equal(finalQuota.rows[0]?.consumed_actions, 2);

    const reservation = await fixturePool.query<{
      status: string;
      consumed_actions: number;
      released_actions: number;
    }>(
      `SELECT status, consumed_actions, released_actions
       FROM automation_quota_reservations
       WHERE organization_id = $1
         AND id = $2`,
      [organizationId, campaign.quotaReservationId]
    );
    assert.equal(reservation.rows[0]?.status, "COMPLETED");
    assert.equal(reservation.rows[0]?.consumed_actions, 2);
    assert.equal(reservation.rows[0]?.released_actions, 0);

    const attempts = await fixturePool.query<{
      job_id: string;
      count: number;
    }>(
      `SELECT job_id::text, count(*)::int AS count
       FROM notification_attempts
       WHERE organization_id = $1
       GROUP BY job_id
       ORDER BY job_id`,
      [organizationId]
    );

    const attemptCounts = new Map(
      attempts.rows.map((row) => [row.job_id, row.count])
    );
    assert.equal(attemptCounts.get(firstClaim.id), 2);
    assert.equal(attemptCounts.get(secondClaim.id), 2);
  } finally {
    await database.onModuleDestroy();
    await cleanup(fixturePool);
    await fixturePool.end();
  }
});
