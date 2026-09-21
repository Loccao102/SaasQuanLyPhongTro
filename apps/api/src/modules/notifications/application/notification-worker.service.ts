import { Injectable } from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { AutomationQuotaService } from "../../commercial/application/automation-quota.service.js";
import { DatabaseService } from "../../database/database.service.js";
import {
  decideNotificationCompletion,
  type NotificationJobStatus,
  type NotificationVerificationState
} from "../domain/notification-lifecycle.js";
import type { NotificationProviderResult } from "../domain/notification-provider.js";

type ClaimRow = QueryResultRow & {
  id: string;
  organization_id: string;
  campaign_id: string;
  recipient_key: string;
  recipient_display_name: string | null;
  provider: string;
  attempt_count: number;
  max_attempts: number;
  quota_reservation_id: string;
  channel: string;
  message_body: string;
};

type JobRow = QueryResultRow & {
  id: string;
  organization_id: string;
  campaign_id: string;
  status: NotificationJobStatus;
  attempt_count: number;
  max_attempts: number;
  provider: string;
};

export interface ClaimedNotificationJob {
  id: string;
  organizationId: string;
  campaignId: string;
  recipientKey: string;
  recipientDisplayName: string | null;
  provider: string;
  channel: string;
  messageBody: string;
  attemptNumber: number;
  maxAttempts: number;
}

export class NotificationJobStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationJobStateConflictError";
  }
}

@Injectable()
export class NotificationWorkerService {
  constructor(
    private readonly database: DatabaseService,
    private readonly quota: AutomationQuotaService
  ) {}

  claimNext(provider: string): Promise<ClaimedNotificationJob | null> {
    const normalizedProvider = provider.trim();
    if (!normalizedProvider) {
      throw new Error("provider is required.");
    }

    return this.database.withTransaction(async (client) => {
      const result = await client.query<ClaimRow>(
        `SELECT
           j.id::text,
           j.organization_id::text,
           j.campaign_id::text,
           j.recipient_key,
           j.recipient_display_name,
           j.provider,
           j.attempt_count,
           j.max_attempts,
           c.quota_reservation_id::text,
           c.channel,
           c.message_body
         FROM notification_jobs j
         JOIN notification_campaigns c
           ON c.organization_id = j.organization_id
          AND c.id = j.campaign_id
         WHERE j.provider = $1
           AND (
             j.status = 'QUEUED'
             OR (
               j.status = 'RETRY_WAIT'
               AND j.next_attempt_at IS NOT NULL
               AND j.next_attempt_at <= now()
             )
           )
           AND c.status IN ('QUEUED', 'RUNNING')
         ORDER BY
           COALESCE(j.next_attempt_at, j.created_at),
           j.created_at,
           j.id
         FOR UPDATE OF j SKIP LOCKED
         LIMIT 1`,
        [normalizedProvider]
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }

      await this.quota.consumeInTransaction(client, {
        organizationId: row.organization_id,
        reservationId: row.quota_reservation_id,
        consumptionKey: "notification-job:" + row.id,
        quantity: 1
      });

      const attemptNumber = row.attempt_count + 1;
      await client.query(
        `UPDATE notification_jobs
         SET status = 'RUNNING',
             attempt_count = $3,
             next_attempt_at = NULL,
             verification_state = 'NOT_ATTEMPTED',
             last_error_code = NULL,
             last_error_message = NULL,
             updated_at = now()
         WHERE organization_id = $1
           AND id = $2`,
        [row.organization_id, row.id, attemptNumber]
      );

      await client.query(
        `INSERT INTO notification_attempts (
           organization_id,
           job_id,
           attempt_number,
           provider,
           status
         )
         VALUES ($1, $2, $3, $4, 'RUNNING')`,
        [row.organization_id, row.id, attemptNumber, row.provider]
      );

      await client.query(
        `UPDATE notification_campaigns
         SET status = CASE
               WHEN status = 'QUEUED' THEN 'RUNNING'
               ELSE status
             END,
             updated_at = now()
         WHERE organization_id = $1
           AND id = $2`,
        [row.organization_id, row.campaign_id]
      );

      return {
        id: row.id,
        organizationId: row.organization_id,
        campaignId: row.campaign_id,
        recipientKey: row.recipient_key,
        recipientDisplayName: row.recipient_display_name,
        provider: row.provider,
        channel: row.channel,
        messageBody: row.message_body,
        attemptNumber,
        maxAttempts: row.max_attempts
      };
    });
  }

  completeAttempt(input: {
    organizationId: string;
    jobId: string;
    attemptNumber: number;
    result: NotificationProviderResult;
  }): Promise<{
    jobId: string;
    status: NotificationJobStatus;
    verificationState: NotificationVerificationState;
  }> {
    return this.database.withTransaction(async (client) => {
      const jobResult = await client.query<JobRow>(
        `SELECT
           id::text,
           organization_id::text,
           campaign_id::text,
           status,
           attempt_count,
           max_attempts,
           provider
         FROM notification_jobs
         WHERE organization_id = $1
           AND id = $2
         FOR UPDATE`,
        [input.organizationId, input.jobId]
      );
      const job = jobResult.rows[0];
      if (!job) {
        throw new NotificationJobStateConflictError("Job was not found.");
      }
      if (
        job.status !== "RUNNING" ||
        job.attempt_count !== input.attemptNumber
      ) {
        throw new NotificationJobStateConflictError(
          "Job is not running at the supplied attempt number."
        );
      }

      const attemptResult = await client.query(
        `SELECT id
         FROM notification_attempts
         WHERE organization_id = $1
           AND job_id = $2
           AND attempt_number = $3
           AND status = 'RUNNING'
         FOR UPDATE`,
        [input.organizationId, input.jobId, input.attemptNumber]
      );
      if (attemptResult.rowCount !== 1) {
        throw new NotificationJobStateConflictError(
          "Running notification attempt was not found."
        );
      }

      const decision = decideNotificationCompletion({
        result: input.result,
        attemptCount: job.attempt_count,
        maxAttempts: job.max_attempts
      });

      const errorCode =
        "errorCode" in input.result ? input.result.errorCode ?? null : null;
      const errorMessage =
        "errorMessage" in input.result
          ? input.result.errorMessage ?? null
          : null;
      const providerReference =
        "providerReference" in input.result
          ? input.result.providerReference ?? null
          : null;
      const evidence = {
        ...(input.result.evidence ?? {}),
        ...(providerReference ? { providerReference } : {})
      };

      await client.query(
        `UPDATE notification_attempts
         SET status = 'FINISHED',
             outcome = $4,
             error_code = $5,
             error_message = $6,
             evidence = $7::jsonb,
             finished_at = now()
         WHERE organization_id = $1
           AND job_id = $2
           AND attempt_number = $3`,
        [
          input.organizationId,
          input.jobId,
          input.attemptNumber,
          decision.attemptOutcome,
          errorCode,
          errorMessage,
          JSON.stringify(evidence)
        ]
      );

      await client.query(
        `UPDATE notification_jobs
         SET status = $3,
             verification_state = $4,
             next_attempt_at = CASE
               WHEN $5::int IS NULL THEN NULL
               ELSE now() + ($5::int * interval '1 second')
             END,
             last_error_code = $6,
             last_error_message = $7,
             evidence = $8::jsonb,
             sent_at = CASE
               WHEN $3 = 'SENT' THEN now()
               ELSE sent_at
             END,
             updated_at = now()
         WHERE organization_id = $1
           AND id = $2`,
        [
          input.organizationId,
          input.jobId,
          decision.jobStatus,
          decision.verificationState,
          decision.retryDelaySeconds,
          errorCode,
          errorMessage,
          JSON.stringify(evidence)
        ]
      );

      const aggregate = await client.query<
        QueryResultRow & {
          pending: number;
          failed: number;
          review: number;
          sent: number;
        }
      >(
        `SELECT
           count(*) FILTER (
             WHERE status IN ('QUEUED', 'RUNNING', 'RETRY_WAIT')
           )::int AS pending,
           count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
           count(*) FILTER (WHERE status = 'MANUAL_REVIEW')::int AS review,
           count(*) FILTER (WHERE status = 'SENT')::int AS sent
         FROM notification_jobs
         WHERE organization_id = $1
           AND campaign_id = $2`,
        [input.organizationId, job.campaign_id]
      );
      const counts = aggregate.rows[0]!;
      const campaignStatus =
        counts.pending > 0
          ? "RUNNING"
          : counts.review > 0
            ? "MANUAL_REVIEW"
            : counts.failed > 0
              ? "PARTIAL_FAILED"
              : "COMPLETED";

      await client.query(
        `UPDATE notification_campaigns
         SET status = CASE
               WHEN status IN ('PAUSED', 'CANCELLED') THEN status
               ELSE $3
             END,
             updated_at = now()
         WHERE organization_id = $1
           AND id = $2`,
        [input.organizationId, job.campaign_id, campaignStatus]
      );

      return {
        jobId: input.jobId,
        status: decision.jobStatus,
        verificationState: decision.verificationState
      };
    });
  }
}
