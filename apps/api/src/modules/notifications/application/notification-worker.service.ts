import { Injectable } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { AutomationQuotaService } from "../../commercial/application/automation-quota.service.js";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
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
  status: NotificationJobStatus;
  verification_state: NotificationVerificationState;
  attempt_count: number;
  max_attempts: number;
  quota_reservation_id: string;
  channel: string;
  message_body: string;
  message_body_override: string | null;
  latest_attempt_number: number | null;
  latest_attempt_status: "RUNNING" | "FINISHED" | null;
  latest_attempt_started_at: Date | null;
  has_unknown_delivery: boolean;
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
  deliveryReplayCheckRequired: boolean;
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
    private readonly quota: AutomationQuotaService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  claimNext(provider: string): Promise<ClaimedNotificationJob | null> {
    const normalizedProvider = provider.trim();
    if (!normalizedProvider) {
      throw new Error("provider is required.");
    }
    const runningTimeoutSeconds = this.runningTimeoutSeconds();

    return this.database.withTransaction(async (client) => {
      const result = await client.query<ClaimRow>(
        `SELECT
           j.id::text,
           j.organization_id::text,
           j.campaign_id::text,
           j.recipient_key,
           j.recipient_display_name,
           j.provider,
           j.status,
           j.verification_state,
           j.attempt_count,
           j.max_attempts,
           c.quota_reservation_id::text,
           c.channel,
           c.message_body,
           j.message_body_override,
           latest_attempt.attempt_number AS latest_attempt_number,
           latest_attempt.status AS latest_attempt_status,
           latest_attempt.started_at AS latest_attempt_started_at,
           EXISTS (
             SELECT 1
             FROM notification_attempts uncertain_attempt
             WHERE uncertain_attempt.organization_id = j.organization_id
               AND uncertain_attempt.job_id = j.id
               AND uncertain_attempt.outcome = 'UNKNOWN'
           ) AS has_unknown_delivery
         FROM notification_jobs j
         JOIN notification_campaigns c
           ON c.organization_id = j.organization_id
          AND c.id = j.campaign_id
         JOIN organizations o
           ON o.id = j.organization_id
          AND o.status = 'ACTIVE'
         JOIN organization_subscriptions s
           ON s.organization_id = j.organization_id
          AND s.status IN (
            'TRIALING',
            'ACTIVE',
            'PAST_DUE',
            'GRACE_PERIOD'
          )
         LEFT JOIN notification_provider_controls pc
           ON pc.provider = j.provider
         LEFT JOIN LATERAL (
           SELECT
             attempt_number,
             status,
             started_at
           FROM notification_attempts attempt
           WHERE attempt.organization_id = j.organization_id
             AND attempt.job_id = j.id
           ORDER BY attempt_number DESC
           LIMIT 1
         ) latest_attempt ON true
         WHERE j.provider = $1
           AND COALESCE(pc.status, 'ACTIVE') = 'ACTIVE'
           AND (
             j.status = 'QUEUED'
             OR (
               j.status = 'RETRY_WAIT'
               AND j.next_attempt_at IS NOT NULL
               AND j.next_attempt_at <= now()
             )
             OR (
               j.status = 'RUNNING'
               AND COALESCE(latest_attempt.started_at, j.updated_at) <=
                 now() - make_interval(secs => $2::int)
             )
           )
           AND c.status IN ('QUEUED', 'RUNNING')
         ORDER BY
           CASE WHEN j.status = 'RUNNING' THEN 0 ELSE 1 END,
           COALESCE(j.next_attempt_at, latest_attempt.started_at, j.created_at),
           j.created_at,
           j.id
         FOR UPDATE OF j SKIP LOCKED
         LIMIT 1`,
        [normalizedProvider, runningTimeoutSeconds]
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }

      const recoveringStaleAttempt = row.status === "RUNNING";
      const deliveryReplayCheckRequired =
        recoveringStaleAttempt || row.has_unknown_delivery;

      if (recoveringStaleAttempt) {
        const validRunningAttempt =
          row.latest_attempt_number === row.attempt_count &&
          row.latest_attempt_status === "RUNNING";

        if (!validRunningAttempt) {
          await client.query(
            `UPDATE notification_jobs
             SET status = 'MANUAL_REVIEW',
                 verification_state = 'UNKNOWN',
                 next_attempt_at = NULL,
                 last_error_code = 'STALE_ATTEMPT_STATE_INVALID',
                 last_error_message =
                   'Stale RUNNING job has no matching RUNNING attempt.',
                 evidence = evidence || $3::jsonb,
                 updated_at = now()
             WHERE organization_id = $1
               AND id = $2`,
            [
              row.organization_id,
              row.id,
              JSON.stringify({
                recovery: "stale-running",
                expectedAttemptNumber: row.attempt_count
              })
            ]
          );
          await this.refreshCampaignStatus(
            client,
            row.organization_id,
            row.campaign_id
          );
          return null;
        }

        const recoveredAttempt = await client.query(
          `UPDATE notification_attempts
           SET status = 'FINISHED',
               outcome = 'UNKNOWN',
               error_code = 'STALE_ATTEMPT_RECLAIMED',
               error_message =
                 'Worker did not complete the notification attempt before the stale timeout.',
               evidence = evidence || $4::jsonb,
               finished_at = now()
           WHERE organization_id = $1
             AND job_id = $2
             AND attempt_number = $3
             AND status = 'RUNNING'`,
          [
            row.organization_id,
            row.id,
            row.attempt_count,
            JSON.stringify({
              recovery: "stale-running",
              timeoutSeconds: runningTimeoutSeconds
            })
          ]
        );
        if (recoveredAttempt.rowCount !== 1) {
          throw new NotificationJobStateConflictError(
            "Stale running notification attempt could not be recovered."
          );
        }

        if (row.attempt_count >= row.max_attempts) {
          await client.query(
            `UPDATE notification_jobs
             SET status = 'MANUAL_REVIEW',
                 verification_state = 'UNKNOWN',
                 next_attempt_at = NULL,
                 last_error_code = 'STALE_ATTEMPT_MAX_ATTEMPTS',
                 last_error_message =
                   'Stale attempt reached the automatic retry limit and requires operator review.',
                 evidence = evidence || $3::jsonb,
                 updated_at = now()
             WHERE organization_id = $1
               AND id = $2`,
            [
              row.organization_id,
              row.id,
              JSON.stringify({
                recovery: "stale-running",
                attemptNumber: row.attempt_count,
                maxAttempts: row.max_attempts
              })
            ]
          );
          await this.refreshCampaignStatus(
            client,
            row.organization_id,
            row.campaign_id
          );
          return null;
        }
      }

      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        row.organization_id
      );

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
             verification_state = $4,
             last_error_code = NULL,
             last_error_message = NULL,
             updated_at = now()
         WHERE organization_id = $1
           AND id = $2`,
        [
          row.organization_id,
          row.id,
          attemptNumber,
          deliveryReplayCheckRequired ? "UNKNOWN" : "NOT_ATTEMPTED"
        ]
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
        messageBody: row.message_body_override ?? row.message_body,
        attemptNumber,
        maxAttempts: row.max_attempts,
        deliveryReplayCheckRequired
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

      await this.refreshCampaignStatus(
        client,
        input.organizationId,
        job.campaign_id
      );

      return {
        jobId: input.jobId,
        status: decision.jobStatus,
        verificationState: decision.verificationState
      };
    });
  }

  private runningTimeoutSeconds(): number {
    const raw =
      process.env.NOTIFICATION_RUNNING_TIMEOUT_SECONDS?.trim() ?? "";
    if (!raw) return 600;

    const value = Number(raw);
    if (!Number.isInteger(value) || value < 60 || value > 86400) {
      throw new Error(
        "NOTIFICATION_RUNNING_TIMEOUT_SECONDS must be an integer between 60 and 86400."
      );
    }
    return value;
  }

  private async refreshCampaignStatus(
    client: PoolClient,
    organizationId: string,
    campaignId: string
  ): Promise<void> {
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
      [organizationId, campaignId]
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
      [organizationId, campaignId, campaignStatus]
    );
  }
}
