import assert from "node:assert/strict";
import test from "node:test";
import { renderPrometheusMetrics } from "./observability-metrics.js";
import type { OperationalSnapshot } from "./observability.types.js";

const snapshot: OperationalSnapshot = {
  generatedAt: "2026-09-22T00:00:00.000Z",
  api: {
    requestCount: 12,
    errorCount: 2,
    durationSumMs: 2400,
    durationMaxMs: 900,
    latencyBucketsMs: [
      { le: 50, count: 2 },
      { le: 100, count: 4 },
      { le: 250, count: 8 },
      { le: 500, count: 10 },
      { le: 1000, count: 12 }
    ]
  },
  database: {
    pool: { max: 10, total: 4, idle: 2, waiting: 1 },
    operations: {
      queryCount: 20,
      transactionCount: 5,
      slowOperationCount: 3,
      durationSumMs: 800,
      durationMaxMs: 300,
      slowThresholdMs: 250
    }
  },
  workers: [
    {
      workerId: "billing-1",
      role: "BILLING",
      provider: null,
      status: "HEALTHY",
      lastSeenAt: "2026-09-22T00:00:00.000Z",
      lastSeenAgeSeconds: 12,
      staleAfterSeconds: 180,
      stale: false,
      lastErrorCode: null
    }
  ],
  notifications: {
    pending: 4,
    failed: 1,
    manualReview: 2,
    sent24h: 20,
    failed24h: 1,
    manualReview24h: 2,
    oldestPendingAgeSeconds: 75
  },
  billingWebhooks: {
    received: 3,
    processing: 1,
    reviewRequired: 2,
    failed: 1,
    staleProcessing: 1,
    processed24h: 40,
    oldestBacklogAgeSeconds: 90
  },
  renterPaymentWebhooks: {
    received: 5,
    processing: 2,
    reviewRequired: 3,
    failed: 1,
    staleProcessing: 1,
    processed24h: 22,
    invalidSignature24h: 4,
    oldestBacklogAgeSeconds: 120
  },
  renterPaymentReconciliation: {
    streams: [
      {
        provider: "SEPAY",
        scopeKey: "production-company",
        initialized: true,
        lastSuccessAgeSeconds: 420
      }
    ]
  }
};

test("renders core operational metrics in Prometheus text format", () => {
  const output = renderPrometheusMetrics(snapshot);

  assert.match(output, /habi_api_http_requests_total 12/);
  assert.match(output, /habi_api_http_errors_total 2/);
  assert.match(
    output,
    /habi_api_http_request_duration_seconds_bucket\{le="1"\} 12/
  );
  assert.match(
    output,
    /habi_db_pool_connections\{state="waiting"\} 1/
  );
  assert.match(
    output,
    /habi_worker_instances\{role="BILLING",status="HEALTHY"\} 1/
  );
  assert.match(output, /habi_worker_stale\{role="BILLING"\} 0/);
  assert.match(
    output,
    /habi_notification_oldest_pending_age_seconds 75/
  );
  assert.match(
    output,
    /habi_billing_webhook_stale_processing 1/
  );
  assert.match(
    output,
    /habi_worker_instances\{role="RENTER_PAYMENT_WEBHOOK",status="HEALTHY"\} 0/
  );
  assert.match(
    output,
    /habi_renter_payment_webhooks\{state="review_required"\} 3/
  );
  assert.match(
    output,
    /habi_renter_payment_webhook_invalid_signature_24h 4/
  );
  assert.match(
    output,
    /habi_renter_payment_reconciliation_initialized\{provider="SEPAY",scope="production-company"\} 1/
  );
  assert.match(
    output,
    /habi_renter_payment_reconciliation_last_success_age_seconds\{provider="SEPAY",scope="production-company"\} 420/
  );
});
