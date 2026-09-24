import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { AutomationQuotaService } from "../../commercial/application/automation-quota.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";

type CampaignRow = QueryResultRow & {
  id: string;
  organization_id: string;
  quota_reservation_id: string;
  channel: string;
  provider: string;
  message_body: string;
  status: string;
  total_recipients: number;
  created_at: Date;
  updated_at: Date;
  queued: number;
  running: number;
  retry_waiting: number;
  sent: number;
  failed: number;
  manual_review: number;
  cancelled: number;
};

type JobRow = QueryResultRow & {
  id: string;
  recipient_key: string;
  recipient_display_name: string | null;
  status: string;
  attempt_count: number;
  max_attempts: number;
  verification_state: string;
  last_error_code: string | null;
  last_error_message: string | null;
  updated_at: Date;
};

@Injectable()
export class NotificationAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly quota: AutomationQuotaService
  ) {}

  async list(principal: TenantPrincipal) {
    this.require(principal, "notification.read");
    const result = await this.db.query<CampaignRow>(this.summarySql(), [
      principal.organizationId
    ]);
    return {
      organization: {
        id: principal.organizationId,
        name: principal.organizationName
      },
      campaigns: result.rows.map((row) => this.mapCampaign(row))
    };
  }

  async detail(principal: TenantPrincipal, campaignId: string) {
    this.require(principal, "notification.read");
    const campaignResult = await this.db.query<CampaignRow>(
      this.summarySql("AND c.id = $2::uuid"),
      [principal.organizationId, campaignId]
    );
    const campaign = campaignResult.rows[0];
    if (!campaign) {
      throw new NotFoundException("Notification campaign was not found.");
    }

    const jobs = await this.db.query<JobRow>(
      `SELECT
         id::text,
         recipient_key,
         recipient_display_name,
         status,
         attempt_count,
         max_attempts,
         verification_state,
         last_error_code,
         last_error_message,
         updated_at
       FROM notification_jobs
       WHERE organization_id = $1::uuid
         AND campaign_id = $2::uuid
       ORDER BY
         CASE status
           WHEN 'MANUAL_REVIEW' THEN 0
           WHEN 'FAILED' THEN 1
           WHEN 'RETRY_WAIT' THEN 2
           WHEN 'RUNNING' THEN 3
           WHEN 'QUEUED' THEN 4
           ELSE 5
         END,
         updated_at DESC,
         id`,
      [principal.organizationId, campaignId]
    );

    return {
      campaign: this.mapCampaign(campaign),
      permissions: {
        send: this.accessControl.can(principal.membership, "notification.send", {
          organizationId: principal.organizationId
        })
      },
      jobs: jobs.rows.map((row) => ({
        id: row.id,
        recipientKey: row.recipient_key,
        recipientDisplayName: row.recipient_display_name,
        status: row.status,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        verificationState: row.verification_state,
        lastErrorCode: row.last_error_code,
        lastErrorMessage: row.last_error_message,
        updatedAt: row.updated_at.toISOString()
      }))
    };
  }

  async pause(principal: TenantPrincipal, campaignId: string, reason: string) {
    return this.withCampaignMutation(principal, campaignId, async (client, row) => {
      if (row.status === "CANCELLED" || row.status === "COMPLETED") {
        throw new ConflictException("Campaign cannot be paused in its current state.");
      }
      await client.query(
        `UPDATE notification_campaigns
         SET status = 'PAUSED', updated_at = now()
         WHERE organization_id = $1::uuid AND id = $2::uuid`,
        [principal.organizationId, campaignId]
      );
      await this.audit(client, principal, campaignId, "NOTIFICATION_CAMPAIGN_PAUSED", {
        reason
      });
      return this.summaryInTransaction(client, principal.organizationId, campaignId);
    });
  }

  async resume(principal: TenantPrincipal, campaignId: string) {
    return this.withCampaignMutation(principal, campaignId, async (client, row) => {
      if (row.status !== "PAUSED") {
        throw new ConflictException("Only a paused campaign can be resumed.");
      }
      const aggregate = await client.query<QueryResultRow & {
        pending: number;
        running: number;
      }>(
        `SELECT
           count(*) FILTER (WHERE status IN ('QUEUED','RETRY_WAIT'))::int AS pending,
           count(*) FILTER (WHERE status = 'RUNNING')::int AS running
         FROM notification_jobs
         WHERE organization_id = $1::uuid AND campaign_id = $2::uuid`,
        [principal.organizationId, campaignId]
      );
      const counts = aggregate.rows[0]!;
      const nextStatus = counts.running > 0 ? "RUNNING" : counts.pending > 0 ? "QUEUED" : "COMPLETED";
      await client.query(
        `UPDATE notification_campaigns
         SET status = $3, updated_at = now()
         WHERE organization_id = $1::uuid AND id = $2::uuid`,
        [principal.organizationId, campaignId, nextStatus]
      );
      await this.audit(client, principal, campaignId, "NOTIFICATION_CAMPAIGN_RESUMED", {
        nextStatus
      });
      return this.summaryInTransaction(client, principal.organizationId, campaignId);
    });
  }

  async cancel(principal: TenantPrincipal, campaignId: string, reason: string) {
    return this.withCampaignMutation(principal, campaignId, async (client, row) => {
      if (row.status === "CANCELLED" || row.status === "COMPLETED") {
        throw new ConflictException("Campaign cannot be cancelled in its current state.");
      }

      await client.query(
        `UPDATE notification_jobs
         SET status = 'CANCELLED',
             next_attempt_at = NULL,
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND campaign_id = $2::uuid
           AND status IN ('QUEUED','RETRY_WAIT')`,
        [principal.organizationId, campaignId]
      );
      await client.query(
        `UPDATE notification_campaigns
         SET status = 'CANCELLED', updated_at = now()
         WHERE organization_id = $1::uuid AND id = $2::uuid`,
        [principal.organizationId, campaignId]
      );
      await this.quota.releaseInTransaction(client, {
        organizationId: principal.organizationId,
        reservationId: row.quota_reservation_id
      });
      await this.audit(client, principal, campaignId, "NOTIFICATION_CAMPAIGN_CANCELLED", {
        reason,
        runningJobsMayFinish: true
      });
      return this.summaryInTransaction(client, principal.organizationId, campaignId);
    });
  }

  async retryFailed(principal: TenantPrincipal, campaignId: string) {
    return this.withCampaignMutation(principal, campaignId, async (client, row) => {
      if (row.status === "CANCELLED") {
        throw new ConflictException("Cancelled campaign cannot retry jobs.");
      }
      const result = await client.query(
        `UPDATE notification_jobs
         SET status = 'QUEUED',
             max_attempts = GREATEST(max_attempts, attempt_count + 1),
             next_attempt_at = now(),
             verification_state = 'NOT_ATTEMPTED',
             last_error_code = NULL,
             last_error_message = NULL,
             evidence = '{}'::jsonb,
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND campaign_id = $2::uuid
           AND status IN ('FAILED','MANUAL_REVIEW')`,
        [principal.organizationId, campaignId]
      );
      const retried = result.rowCount ?? 0;
      if (retried === 0) {
        throw new ConflictException("Campaign has no failed/manual-review jobs to retry.");
      }
      await client.query(
        `UPDATE notification_campaigns
         SET status = CASE WHEN status = 'PAUSED' THEN 'PAUSED' ELSE 'QUEUED' END,
             updated_at = now()
         WHERE organization_id = $1::uuid AND id = $2::uuid`,
        [principal.organizationId, campaignId]
      );
      await this.audit(client, principal, campaignId, "NOTIFICATION_CAMPAIGN_RETRY_REQUESTED", {
        retried
      });
      return this.summaryInTransaction(client, principal.organizationId, campaignId);
    });
  }

  private async withCampaignMutation<T>(
    principal: TenantPrincipal,
    campaignId: string,
    operation: (client: PoolClient, row: CampaignRow) => Promise<T>
  ): Promise<T> {
    this.require(principal, "notification.send");
    return this.db.withTransaction(async (client) => {
      const result = await client.query<CampaignRow>(
        `SELECT
           c.id::text,
           c.organization_id::text,
           c.quota_reservation_id::text,
           c.channel,
           c.provider,
           c.message_body,
           c.status,
           c.total_recipients,
           c.created_at,
           c.updated_at,
           0::int AS queued,
           0::int AS running,
           0::int AS retry_waiting,
           0::int AS sent,
           0::int AS failed,
           0::int AS manual_review,
           0::int AS cancelled
         FROM notification_campaigns c
         WHERE c.organization_id = $1::uuid
           AND c.id = $2::uuid
         FOR UPDATE`,
        [principal.organizationId, campaignId]
      );
      const row = result.rows[0];
      if (!row) {
        throw new NotFoundException("Notification campaign was not found.");
      }
      return operation(client, row);
    });
  }

  private require(
    principal: TenantPrincipal,
    permission: "notification.read" | "notification.send"
  ): void {
    if (
      !this.accessControl.can(principal.membership, permission, {
        organizationId: principal.organizationId
      })
    ) {
      throw new ForbiddenException(permission + " permission denied.");
    }
  }

  private summarySql(extra = ""): string {
    return `SELECT
       c.id::text,
       c.organization_id::text,
       c.quota_reservation_id::text,
       c.channel,
       c.provider,
       c.message_body,
       c.status,
       c.total_recipients,
       c.created_at,
       c.updated_at,
       count(*) FILTER (WHERE j.status = 'QUEUED')::int AS queued,
       count(*) FILTER (WHERE j.status = 'RUNNING')::int AS running,
       count(*) FILTER (WHERE j.status = 'RETRY_WAIT')::int AS retry_waiting,
       count(*) FILTER (WHERE j.status = 'SENT')::int AS sent,
       count(*) FILTER (WHERE j.status = 'FAILED')::int AS failed,
       count(*) FILTER (WHERE j.status = 'MANUAL_REVIEW')::int AS manual_review,
       count(*) FILTER (WHERE j.status = 'CANCELLED')::int AS cancelled
     FROM notification_campaigns c
     LEFT JOIN notification_jobs j
       ON j.organization_id = c.organization_id
      AND j.campaign_id = c.id
     WHERE c.organization_id = $1::uuid
     ${extra}
     GROUP BY c.id
     ORDER BY c.created_at DESC
     LIMIT 200`;
  }

  private async summaryInTransaction(
    client: PoolClient,
    organizationId: string,
    campaignId: string
  ) {
    const result = await client.query<CampaignRow>(
      this.summarySql("AND c.id = $2::uuid"),
      [organizationId, campaignId]
    );
    return this.mapCampaign(result.rows[0]!);
  }

  private mapCampaign(row: CampaignRow) {
    return {
      id: row.id,
      channel: row.channel,
      provider: row.provider,
      messageBody: row.message_body,
      status: row.status,
      totalRecipients: row.total_recipients,
      queued: row.queued,
      running: row.running,
      retryWaiting: row.retry_waiting,
      sent: row.sent,
      failed: row.failed,
      manualReview: row.manual_review,
      cancelled: row.cancelled,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  }

  private async audit(
    client: PoolClient,
    principal: TenantPrincipal,
    campaignId: string,
    action: string,
    metadata: Readonly<Record<string, unknown>>
  ) {
    await client.query(
      `INSERT INTO audit_events (
         organization_id, actor_user_id, action, resource_type, resource_id, metadata
       )
       VALUES ($1, $2, $3, 'NOTIFICATION_CAMPAIGN', $4, $5::jsonb)`,
      [
        principal.organizationId,
        principal.userId,
        action,
        campaignId,
        JSON.stringify(metadata)
      ]
    );
  }
}
