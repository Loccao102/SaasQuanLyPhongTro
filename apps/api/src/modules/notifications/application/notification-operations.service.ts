import { Injectable } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service.js";

type JobListRow = QueryResultRow & {
  id: string;
  organization_id: string;
  organization_name: string;
  campaign_id: string;
  campaign_status: string;
  recipient_key: string;
  recipient_display_name: string | null;
  provider: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: Date | null;
  verification_state: string;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: Date;
  updated_at: Date;
};

export interface NotificationJobOperationsView {
  id: string;
  organizationId: string;
  organizationName: string;
  campaignId: string;
  campaignStatus: string;
  recipientKey: string;
  recipientDisplayName: string | null;
  provider: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  verificationState: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export class NotificationJobRetryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationJobRetryConflictError";
  }
}

@Injectable()
export class NotificationOperationsService {
  constructor(private readonly database: DatabaseService) {}

  async listJobs(limit = 200): Promise<NotificationJobOperationsView[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const result = await this.database.query<JobListRow>(
      `SELECT
         j.id::text,
         j.organization_id::text,
         o.name AS organization_name,
         j.campaign_id::text,
         c.status AS campaign_status,
         j.recipient_key,
         j.recipient_display_name,
         j.provider,
         j.status,
         j.attempt_count,
         j.max_attempts,
         j.next_attempt_at,
         j.verification_state,
         j.last_error_code,
         j.last_error_message,
         j.created_at,
         j.updated_at
       FROM notification_jobs j
       JOIN notification_campaigns c
         ON c.organization_id = j.organization_id
        AND c.id = j.campaign_id
       JOIN organizations o ON o.id = j.organization_id
       ORDER BY
         CASE j.status
           WHEN 'MANUAL_REVIEW' THEN 0
           WHEN 'FAILED' THEN 1
           WHEN 'RETRY_WAIT' THEN 2
           WHEN 'RUNNING' THEN 3
           ELSE 4
         END,
         j.updated_at DESC
       LIMIT $1`,
      [safeLimit]
    );
    return result.rows.map((row) => this.mapJob(row));
  }

  async retryJobInTransaction(
    client: PoolClient,
    jobId: string
  ): Promise<{
    before: NotificationJobOperationsView;
    after: NotificationJobOperationsView;
  }> {
    const currentResult = await client.query<JobListRow>(
      `SELECT
         j.id::text,
         j.organization_id::text,
         o.name AS organization_name,
         j.campaign_id::text,
         c.status AS campaign_status,
         j.recipient_key,
         j.recipient_display_name,
         j.provider,
         j.status,
         j.attempt_count,
         j.max_attempts,
         j.next_attempt_at,
         j.verification_state,
         j.last_error_code,
         j.last_error_message,
         j.created_at,
         j.updated_at
       FROM notification_jobs j
       JOIN notification_campaigns c
         ON c.organization_id = j.organization_id
        AND c.id = j.campaign_id
       JOIN organizations o ON o.id = j.organization_id
       WHERE j.id = $1
       FOR UPDATE OF j, c`,
      [jobId]
    );
    const current = currentResult.rows[0];
    if (!current) {
      throw new NotificationJobRetryConflictError("Job was not found.");
    }
    if (current.campaign_status === "CANCELLED") {
      throw new NotificationJobRetryConflictError(
        "Cancelled campaign cannot retry jobs."
      );
    }
    if (
      current.status !== "FAILED" &&
      current.status !== "MANUAL_REVIEW"
    ) {
      throw new NotificationJobRetryConflictError(
        "Only FAILED or MANUAL_REVIEW jobs can be retried."
      );
    }

    const before = this.mapJob(current);
    await client.query(
      `UPDATE notification_jobs
       SET status = 'QUEUED',
           max_attempts = GREATEST(max_attempts, attempt_count + 1),
           next_attempt_at = now(),
           verification_state = 'NOT_ATTEMPTED',
           last_error_code = NULL,
           last_error_message = NULL,
           evidence = '{}'::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [jobId]
    );
    await client.query(
      `UPDATE notification_campaigns
       SET status = 'QUEUED',
           updated_at = now()
       WHERE organization_id = $1
         AND id = $2
         AND status NOT IN ('PAUSED', 'CANCELLED')`,
      [current.organization_id, current.campaign_id]
    );

    const updatedResult = await client.query<JobListRow>(
      `SELECT
         j.id::text,
         j.organization_id::text,
         o.name AS organization_name,
         j.campaign_id::text,
         c.status AS campaign_status,
         j.recipient_key,
         j.recipient_display_name,
         j.provider,
         j.status,
         j.attempt_count,
         j.max_attempts,
         j.next_attempt_at,
         j.verification_state,
         j.last_error_code,
         j.last_error_message,
         j.created_at,
         j.updated_at
       FROM notification_jobs j
       JOIN notification_campaigns c
         ON c.organization_id = j.organization_id
        AND c.id = j.campaign_id
       JOIN organizations o ON o.id = j.organization_id
       WHERE j.id = $1`,
      [jobId]
    );

    return {
      before,
      after: this.mapJob(updatedResult.rows[0]!)
    };
  }

  private mapJob(row: JobListRow): NotificationJobOperationsView {
    return {
      id: row.id,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      campaignId: row.campaign_id,
      campaignStatus: row.campaign_status,
      recipientKey: row.recipient_key,
      recipientDisplayName: row.recipient_display_name,
      provider: row.provider,
      status: row.status,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      nextAttemptAt: row.next_attempt_at?.toISOString() ?? null,
      verificationState: row.verification_state,
      lastErrorCode: row.last_error_code,
      lastErrorMessage: row.last_error_message,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  }
}
