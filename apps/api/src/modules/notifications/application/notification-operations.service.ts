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

type ProviderRow = QueryResultRow & {
  provider: string;
  control_status: "ACTIVE" | "PAUSED";
  control_reason: string | null;
  control_updated_at: Date | null;
  worker_count: number;
  healthy_workers: number;
  degraded_workers: number;
  last_seen_at: Date | null;
};

type WorkerHeartbeatRow = QueryResultRow & {
  worker_id: string;
  provider: string;
  status: "STARTING" | "HEALTHY" | "DEGRADED" | "STOPPING";
  started_at: Date;
  last_seen_at: Date;
  last_error_code: string | null;
  last_error_message: string | null;
  metadata: unknown;
};

type ProviderControlRow = QueryResultRow & {
  provider: string;
  status: "ACTIVE" | "PAUSED";
  reason: string | null;
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

export interface NotificationProviderOperationsView {
  provider: string;
  status: "ACTIVE" | "PAUSED";
  reason: string | null;
  controlUpdatedAt: string | null;
  workerCount: number;
  healthyWorkers: number;
  degradedWorkers: number;
  lastSeenAt: string | null;
}

export interface NotificationWorkerHeartbeatView {
  workerId: string;
  provider: string;
  status: "STARTING" | "HEALTHY" | "DEGRADED" | "STOPPING";
  startedAt: string;
  lastSeenAt: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  metadata: unknown;
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

  async listProviders(): Promise<NotificationProviderOperationsView[]> {
    const result = await this.database.query<ProviderRow>(
      `WITH providers AS (
         SELECT provider FROM notification_provider_controls
         UNION
         SELECT provider FROM notification_worker_heartbeats
         UNION
         SELECT provider FROM notification_jobs
       )
       SELECT
         p.provider,
         COALESCE(pc.status, 'ACTIVE') AS control_status,
         pc.reason AS control_reason,
         pc.updated_at AS control_updated_at,
         count(wh.worker_id)::int AS worker_count,
         count(wh.worker_id) FILTER (
           WHERE wh.status = 'HEALTHY'
             AND wh.last_seen_at >= now() - interval '60 seconds'
         )::int AS healthy_workers,
         count(wh.worker_id) FILTER (
           WHERE wh.status = 'DEGRADED'
             OR wh.last_seen_at < now() - interval '60 seconds'
         )::int AS degraded_workers,
         max(wh.last_seen_at) AS last_seen_at
       FROM providers p
       LEFT JOIN notification_provider_controls pc
         ON pc.provider = p.provider
       LEFT JOIN notification_worker_heartbeats wh
         ON wh.provider = p.provider
       GROUP BY p.provider, pc.status, pc.reason, pc.updated_at
       ORDER BY p.provider`
    );

    return result.rows.map((row) => ({
      provider: row.provider,
      status: row.control_status,
      reason: row.control_reason,
      controlUpdatedAt: row.control_updated_at?.toISOString() ?? null,
      workerCount: row.worker_count,
      healthyWorkers: row.healthy_workers,
      degradedWorkers: row.degraded_workers,
      lastSeenAt: row.last_seen_at?.toISOString() ?? null
    }));
  }

  async listWorkerHeartbeats(): Promise<NotificationWorkerHeartbeatView[]> {
    const result = await this.database.query<WorkerHeartbeatRow>(
      `SELECT
         worker_id,
         provider,
         status,
         started_at,
         last_seen_at,
         last_error_code,
         last_error_message,
         metadata
       FROM notification_worker_heartbeats
       ORDER BY last_seen_at DESC, worker_id`
    );

    return result.rows.map((row) => ({
      workerId: row.worker_id,
      provider: row.provider,
      status: row.status,
      startedAt: row.started_at.toISOString(),
      lastSeenAt: row.last_seen_at.toISOString(),
      lastErrorCode: row.last_error_code,
      lastErrorMessage: row.last_error_message,
      metadata: row.metadata
    }));
  }

  async reportHeartbeat(input: {
    workerId: string;
    provider: string;
    status: "STARTING" | "HEALTHY" | "DEGRADED" | "STOPPING";
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    metadata?: unknown;
    pauseProviderReason?: string | null;
  }): Promise<void> {
    const workerId = this.requireValue(input.workerId, "workerId");
    const provider = this.requireValue(input.provider, "provider");

    await this.database.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO notification_provider_controls (provider, status)
         VALUES ($1, 'ACTIVE')
         ON CONFLICT (provider) DO NOTHING`,
        [provider]
      );

      if (input.pauseProviderReason?.trim()) {
        await client.query(
          `UPDATE notification_provider_controls
           SET status = 'PAUSED',
               reason = $2,
               updated_by_user_id = NULL,
               updated_at = now()
           WHERE provider = $1`,
          [provider, input.pauseProviderReason.trim()]
        );
      }

      await client.query(
        `INSERT INTO notification_worker_heartbeats (
           worker_id,
           provider,
           status,
           last_error_code,
           last_error_message,
           metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (worker_id)
         DO UPDATE SET
           provider = EXCLUDED.provider,
           status = EXCLUDED.status,
           last_seen_at = now(),
           last_error_code = EXCLUDED.last_error_code,
           last_error_message = EXCLUDED.last_error_message,
           metadata = EXCLUDED.metadata,
           updated_at = now()`,
        [
          workerId,
          provider,
          input.status,
          input.lastErrorCode ?? null,
          input.lastErrorMessage ?? null,
          JSON.stringify(input.metadata ?? {})
        ]
      );
    });
  }

  async setProviderControlInTransaction(
    client: PoolClient,
    input: {
      provider: string;
      status: "ACTIVE" | "PAUSED";
      reason: string;
      actorUserId: string;
    }
  ): Promise<{
    before: NotificationProviderOperationsView;
    after: NotificationProviderOperationsView;
  }> {
    const provider = this.requireValue(input.provider, "provider");

    await client.query(
      `INSERT INTO notification_provider_controls (
         provider,
         status,
         reason,
         updated_by_user_id
       )
       VALUES ($1, 'ACTIVE', NULL, $2)
       ON CONFLICT (provider) DO NOTHING`,
      [provider, input.actorUserId]
    );

    const currentResult = await client.query<ProviderControlRow>(
      `SELECT provider, status, reason, updated_at
       FROM notification_provider_controls
       WHERE provider = $1
       FOR UPDATE`,
      [provider]
    );
    const current = currentResult.rows[0]!;

    const before = await this.providerViewInTransaction(client, provider);

    await client.query(
      `UPDATE notification_provider_controls
       SET status = $2,
           reason = $3,
           updated_by_user_id = $4,
           updated_at = now()
       WHERE provider = $1`,
      [provider, input.status, input.reason, input.actorUserId]
    );

    const after = await this.providerViewInTransaction(client, provider);

    if (
      current.status === input.status &&
      current.reason === input.reason &&
      before.status === after.status
    ) {
      return { before, after };
    }

    return { before, after };
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

  private async providerViewInTransaction(
    client: PoolClient,
    provider: string
  ): Promise<NotificationProviderOperationsView> {
    const result = await client.query<ProviderRow>(
      `SELECT
         $1::text AS provider,
         COALESCE(pc.status, 'ACTIVE') AS control_status,
         pc.reason AS control_reason,
         pc.updated_at AS control_updated_at,
         count(wh.worker_id)::int AS worker_count,
         count(wh.worker_id) FILTER (
           WHERE wh.status = 'HEALTHY'
             AND wh.last_seen_at >= now() - interval '60 seconds'
         )::int AS healthy_workers,
         count(wh.worker_id) FILTER (
           WHERE wh.status = 'DEGRADED'
             OR wh.last_seen_at < now() - interval '60 seconds'
         )::int AS degraded_workers,
         max(wh.last_seen_at) AS last_seen_at
       FROM notification_provider_controls pc
       LEFT JOIN notification_worker_heartbeats wh
         ON wh.provider = pc.provider
       WHERE pc.provider = $1
       GROUP BY pc.status, pc.reason, pc.updated_at`,
      [provider]
    );
    const row = result.rows[0]!;

    return {
      provider: row.provider,
      status: row.control_status,
      reason: row.control_reason,
      controlUpdatedAt: row.control_updated_at?.toISOString() ?? null,
      workerCount: row.worker_count,
      healthyWorkers: row.healthy_workers,
      degradedWorkers: row.degraded_workers,
      lastSeenAt: row.last_seen_at?.toISOString() ?? null
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

  private requireValue(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new Error(field + " is required.");
    }
    return normalized;
  }
}
