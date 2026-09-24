import { Injectable } from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";
import type {
  ApiRuntimeMetrics,
  OperationalSnapshot,
  WorkerHealthView,
  WorkerRole,
  WorkerStatus
} from "./observability.types.js";

type WorkerHeartbeatRow = QueryResultRow & {
  worker_id: string;
  role: WorkerRole;
  provider: string | null;
  status: WorkerStatus;
  last_seen_at: Date;
  stale_after_seconds: number;
  last_error_code: string | null;
  last_seen_age_seconds: number;
  is_stale: boolean;
};

type NotificationSummaryRow = QueryResultRow & {
  pending_count: string;
  failed_count: string;
  manual_review_count: string;
  sent_24h_count: string;
  failed_24h_count: string;
  manual_review_24h_count: string;
  oldest_pending_age_seconds: string | null;
};

type BillingWebhookSummaryRow = QueryResultRow & {
  received_count: string;
  processing_count: string;
  review_required_count: string;
  failed_count: string;
  stale_processing_count: string;
  processed_24h_count: string;
  oldest_backlog_age_seconds: string | null;
};

type RenterPaymentWebhookSummaryRow = QueryResultRow & {
  received_count: string;
  processing_count: string;
  review_required_count: string;
  failed_count: string;
  stale_processing_count: string;
  processed_24h_count: string;
  invalid_signature_24h_count: string;
  oldest_backlog_age_seconds: string | null;
};

type ReconciliationCursorRow = QueryResultRow & {
  provider: string;
  scope_key: string;
  initialized: boolean;
  last_success_age_seconds: string;
};

const API_LATENCY_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000];

@Injectable()
export class ObservabilityService {
  private requestCount = 0;
  private errorCount = 0;
  private durationSumMs = 0;
  private durationMaxMs = 0;
  private readonly latencyBucketCounts = new Map<number, number>(
    API_LATENCY_BUCKETS_MS.map((bucket) => [bucket, 0])
  );

  constructor(private readonly database: DatabaseService) {}

  observeHttpRequest(statusCode: number, durationMs: number): void {
    this.requestCount += 1;
    if (statusCode >= 500) {
      this.errorCount += 1;
    }
    this.durationSumMs += durationMs;
    this.durationMaxMs = Math.max(this.durationMaxMs, durationMs);

    for (const bucket of API_LATENCY_BUCKETS_MS) {
      if (durationMs <= bucket) {
        this.latencyBucketCounts.set(
          bucket,
          (this.latencyBucketCounts.get(bucket) ?? 0) + 1
        );
      }
    }
  }

  async reportWorkerHeartbeat(input: {
    workerId: string;
    role: WorkerRole;
    provider?: string | null;
    status: WorkerStatus;
    staleAfterSeconds: number;
    lastErrorCode?: string | null;
    metadata?: unknown;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO system_worker_heartbeats (
         worker_id,
         role,
         provider,
         status,
         stale_after_seconds,
         last_error_code,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (worker_id)
       DO UPDATE SET
         role = EXCLUDED.role,
         provider = EXCLUDED.provider,
         status = EXCLUDED.status,
         stale_after_seconds = EXCLUDED.stale_after_seconds,
         last_seen_at = now(),
         last_error_code = EXCLUDED.last_error_code,
         metadata = EXCLUDED.metadata,
         updated_at = now()`,
      [
        input.workerId,
        input.role,
        input.provider ?? null,
        input.status,
        input.staleAfterSeconds,
        input.lastErrorCode ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
  }

  async getOperationalSnapshot(): Promise<OperationalSnapshot> {
    const [
      workerResult,
      notificationResult,
      webhookResult,
      renterPaymentWebhookResult,
      reconciliationResult
    ] = await Promise.all([
        this.database.query<WorkerHeartbeatRow>(
          `SELECT
             worker_id,
             role,
             provider,
             status,
             last_seen_at,
             stale_after_seconds,
             last_error_code,
             EXTRACT(
               EPOCH FROM GREATEST(now() - last_seen_at, interval '0 seconds')
             )::double precision AS last_seen_age_seconds,
             (
               now() >
               last_seen_at + make_interval(secs => stale_after_seconds)
             ) AS is_stale
           FROM system_worker_heartbeats
           ORDER BY role, last_seen_at DESC, worker_id`
        ),
        this.database.query<NotificationSummaryRow>(
          `SELECT
             count(*) FILTER (
               WHERE status IN ('QUEUED', 'RETRY_WAIT', 'RUNNING')
             )::text AS pending_count,
             count(*) FILTER (WHERE status = 'FAILED')::text AS failed_count,
             count(*) FILTER (
               WHERE status = 'MANUAL_REVIEW'
             )::text AS manual_review_count,
             count(*) FILTER (
               WHERE status = 'SENT'
                 AND updated_at >= now() - interval '24 hours'
             )::text AS sent_24h_count,
             count(*) FILTER (
               WHERE status = 'FAILED'
                 AND updated_at >= now() - interval '24 hours'
             )::text AS failed_24h_count,
             count(*) FILTER (
               WHERE status = 'MANUAL_REVIEW'
                 AND updated_at >= now() - interval '24 hours'
             )::text AS manual_review_24h_count,
             EXTRACT(
               EPOCH FROM GREATEST(
                 now() - min(COALESCE(next_attempt_at, created_at)) FILTER (
                   WHERE status IN ('QUEUED', 'RETRY_WAIT', 'RUNNING')
                 ),
                 interval '0 seconds'
               )
             )::text AS oldest_pending_age_seconds
           FROM notification_jobs`
        ),
        this.database.query<BillingWebhookSummaryRow>(
          `WITH timeout_config AS (
             SELECT COALESCE(
               (
                 SELECT (value #>> '{}')::int
                 FROM system_settings
                 WHERE key = 'billing_webhook_processing_timeout_seconds'
               ),
               300
             ) AS timeout_seconds
           )
           SELECT
             count(*) FILTER (
               WHERE processing_status = 'RECEIVED'
             )::text AS received_count,
             count(*) FILTER (
               WHERE processing_status = 'PROCESSING'
             )::text AS processing_count,
             count(*) FILTER (
               WHERE processing_status = 'REVIEW_REQUIRED'
             )::text AS review_required_count,
             count(*) FILTER (
               WHERE processing_status = 'FAILED'
             )::text AS failed_count,
             count(*) FILTER (
               WHERE processing_status = 'PROCESSING'
                 AND processing_started_at IS NOT NULL
                 AND processing_started_at <=
                   now() - make_interval(
                     secs => timeout_config.timeout_seconds
                   )
             )::text AS stale_processing_count,
             count(*) FILTER (
               WHERE processing_status = 'PROCESSED'
                 AND processed_at >= now() - interval '24 hours'
             )::text AS processed_24h_count,
             EXTRACT(
               EPOCH FROM GREATEST(
                 now() - min(received_at) FILTER (
                   WHERE processing_status IN (
                     'RECEIVED',
                     'PROCESSING',
                     'REVIEW_REQUIRED',
                     'FAILED'
                   )
                 ),
                 interval '0 seconds'
               )
             )::text AS oldest_backlog_age_seconds
           FROM saas_billing_webhook_events
           CROSS JOIN timeout_config
           GROUP BY timeout_config.timeout_seconds`
        ),
        this.database.query<RenterPaymentWebhookSummaryRow>(
          `WITH timeout_config AS (
             SELECT COALESCE(
               (
                 SELECT (value #>> '{}')::int
                 FROM system_settings
                 WHERE key = 'renter_payment_webhook_processing_timeout_seconds'
               ),
               300
             ) AS timeout_seconds
           )
           SELECT
             count(*) FILTER (
               WHERE processing_status = 'RECEIVED'
             )::text AS received_count,
             count(*) FILTER (
               WHERE processing_status = 'PROCESSING'
             )::text AS processing_count,
             count(*) FILTER (
               WHERE processing_status = 'REVIEW_REQUIRED'
             )::text AS review_required_count,
             count(*) FILTER (
               WHERE processing_status = 'FAILED'
             )::text AS failed_count,
             count(*) FILTER (
               WHERE processing_status = 'PROCESSING'
                 AND processing_started_at IS NOT NULL
                 AND processing_started_at <=
                   now() - make_interval(
                     secs => timeout_config.timeout_seconds
                   )
             )::text AS stale_processing_count,
             count(*) FILTER (
               WHERE processing_status = 'PROCESSED'
                 AND processed_at >= now() - interval '24 hours'
             )::text AS processed_24h_count,
             count(*) FILTER (
               WHERE signature_status = 'INVALID'
                 AND received_at >= now() - interval '24 hours'
             )::text AS invalid_signature_24h_count,
             EXTRACT(
               EPOCH FROM GREATEST(
                 now() - min(received_at) FILTER (
                   WHERE processing_status IN (
                     'RECEIVED',
                     'PROCESSING',
                     'REVIEW_REQUIRED',
                     'FAILED'
                   )
                 ),
                 interval '0 seconds'
               )
             )::text AS oldest_backlog_age_seconds
           FROM renter_payment_webhook_events
           CROSS JOIN timeout_config
           GROUP BY timeout_config.timeout_seconds`
        ),
        this.database.query<ReconciliationCursorRow>(
          `SELECT
             provider,
             scope_key,
             (last_success_at IS NOT NULL) AS initialized,
             EXTRACT(
               EPOCH FROM GREATEST(
                 now() - COALESCE(last_success_at, created_at),
                 interval '0 seconds'
               )
             )::text AS last_success_age_seconds
           FROM renter_payment_reconciliation_cursors
           ORDER BY provider, scope_key`
        )
      ]);

    const notifications = notificationResult.rows[0];
    const webhooks = webhookResult.rows[0];
    const renterPaymentWebhooks = renterPaymentWebhookResult.rows[0];

    return {
      generatedAt: new Date().toISOString(),
      api: this.apiRuntimeMetrics(),
      database: this.database.getRuntimeStats(),
      workers: workerResult.rows.map((row): WorkerHealthView => ({
        workerId: row.worker_id,
        role: row.role,
        provider: row.provider,
        status: row.status,
        lastSeenAt: row.last_seen_at.toISOString(),
        lastSeenAgeSeconds: Math.max(
          0,
          Number(row.last_seen_age_seconds ?? 0)
        ),
        staleAfterSeconds: row.stale_after_seconds,
        stale: row.is_stale,
        lastErrorCode: row.last_error_code
      })),
      notifications: {
        pending: Number(notifications?.pending_count ?? 0),
        failed: Number(notifications?.failed_count ?? 0),
        manualReview: Number(notifications?.manual_review_count ?? 0),
        sent24h: Number(notifications?.sent_24h_count ?? 0),
        failed24h: Number(notifications?.failed_24h_count ?? 0),
        manualReview24h: Number(
          notifications?.manual_review_24h_count ?? 0
        ),
        oldestPendingAgeSeconds: Math.max(
          0,
          Number(notifications?.oldest_pending_age_seconds ?? 0)
        )
      },
      billingWebhooks: {
        received: Number(webhooks?.received_count ?? 0),
        processing: Number(webhooks?.processing_count ?? 0),
        reviewRequired: Number(webhooks?.review_required_count ?? 0),
        failed: Number(webhooks?.failed_count ?? 0),
        staleProcessing: Number(webhooks?.stale_processing_count ?? 0),
        processed24h: Number(webhooks?.processed_24h_count ?? 0),
        oldestBacklogAgeSeconds: Math.max(
          0,
          Number(webhooks?.oldest_backlog_age_seconds ?? 0)
        )
      },
      renterPaymentWebhooks: {
        received: Number(renterPaymentWebhooks?.received_count ?? 0),
        processing: Number(renterPaymentWebhooks?.processing_count ?? 0),
        reviewRequired: Number(
          renterPaymentWebhooks?.review_required_count ?? 0
        ),
        failed: Number(renterPaymentWebhooks?.failed_count ?? 0),
        staleProcessing: Number(
          renterPaymentWebhooks?.stale_processing_count ?? 0
        ),
        processed24h: Number(
          renterPaymentWebhooks?.processed_24h_count ?? 0
        ),
        invalidSignature24h: Number(
          renterPaymentWebhooks?.invalid_signature_24h_count ?? 0
        ),
        oldestBacklogAgeSeconds: Math.max(
          0,
          Number(renterPaymentWebhooks?.oldest_backlog_age_seconds ?? 0)
        )
      },
      renterPaymentReconciliation: {
        streams: reconciliationResult.rows.map((row) => ({
          provider: row.provider,
          scopeKey: row.scope_key,
          initialized: row.initialized,
          lastSuccessAgeSeconds: Math.max(
            0,
            Number(row.last_success_age_seconds ?? 0)
          )
        }))
      }
    };
  }

  private apiRuntimeMetrics(): ApiRuntimeMetrics {
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      durationSumMs: this.durationSumMs,
      durationMaxMs: this.durationMaxMs,
      latencyBucketsMs: API_LATENCY_BUCKETS_MS.map((bucket) => ({
        le: bucket,
        count: this.latencyBucketCounts.get(bucket) ?? 0
      }))
    };
  }
}
