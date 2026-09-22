import type {
  OperationalSnapshot,
  WorkerRole
} from "./observability.types.js";

function metricLine(
  name: string,
  value: number,
  labels?: Record<string, string>
): string {
  const suffix = labels
    ? "{" +
      Object.entries(labels)
        .map(
          ([key, label]) =>
            key +
            '="' +
            label.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
            '"'
        )
        .join(",") +
      "}"
    : "";
  return name + suffix + " " + String(value);
}

export function renderPrometheusMetrics(
  snapshot: OperationalSnapshot
): string {
  const lines: string[] = [];

  lines.push("# HELP habi_api_http_requests_total API requests observed by this process.");
  lines.push("# TYPE habi_api_http_requests_total counter");
  lines.push(
    metricLine(
      "habi_api_http_requests_total",
      snapshot.api.requestCount
    )
  );
  lines.push("# HELP habi_api_http_errors_total API requests completed with status >= 500.");
  lines.push("# TYPE habi_api_http_errors_total counter");
  lines.push(
    metricLine("habi_api_http_errors_total", snapshot.api.errorCount)
  );
  lines.push("# HELP habi_api_http_request_duration_seconds API request latency for this process.");
  lines.push("# TYPE habi_api_http_request_duration_seconds histogram");

  for (const bucket of snapshot.api.latencyBucketsMs) {
    lines.push(
      metricLine(
        "habi_api_http_request_duration_seconds_bucket",
        bucket.count,
        { le: String(bucket.le / 1000) }
      )
    );
  }
  lines.push(
    metricLine(
      "habi_api_http_request_duration_seconds_bucket",
      snapshot.api.requestCount,
      { le: "+Inf" }
    )
  );
  lines.push(
    metricLine(
      "habi_api_http_request_duration_seconds_sum",
      snapshot.api.durationSumMs / 1000
    )
  );
  lines.push(
    metricLine(
      "habi_api_http_request_duration_seconds_count",
      snapshot.api.requestCount
    )
  );
  lines.push(
    metricLine(
      "habi_api_http_request_duration_seconds_max",
      snapshot.api.durationMaxMs / 1000
    )
  );

  lines.push("# HELP habi_db_pool_connections PostgreSQL pool connections by state.");
  lines.push("# TYPE habi_db_pool_connections gauge");
  lines.push(
    metricLine("habi_db_pool_connections", snapshot.database.pool.total, {
      state: "total"
    })
  );
  lines.push(
    metricLine("habi_db_pool_connections", snapshot.database.pool.idle, {
      state: "idle"
    })
  );
  lines.push(
    metricLine("habi_db_pool_connections", snapshot.database.pool.waiting, {
      state: "waiting"
    })
  );
  lines.push(
    metricLine("habi_db_pool_connections", snapshot.database.pool.max, {
      state: "max"
    })
  );

  lines.push("# HELP habi_db_operations_total Database operations observed by DatabaseService.");
  lines.push("# TYPE habi_db_operations_total counter");
  lines.push(
    metricLine(
      "habi_db_operations_total",
      snapshot.database.operations.queryCount,
      { kind: "query" }
    )
  );
  lines.push(
    metricLine(
      "habi_db_operations_total",
      snapshot.database.operations.transactionCount,
      { kind: "transaction" }
    )
  );
  lines.push("# HELP habi_db_slow_operations_total Database operations slower than the configured threshold.");
  lines.push("# TYPE habi_db_slow_operations_total counter");
  lines.push(
    metricLine(
      "habi_db_slow_operations_total",
      snapshot.database.operations.slowOperationCount
    )
  );

  const roles: WorkerRole[] = [
    "NOTIFICATION",
    "BILLING",
    "BILLING_WEBHOOK"
  ];
  lines.push("# HELP habi_worker_instances Worker instances by role and health state.");
  lines.push("# TYPE habi_worker_instances gauge");
  lines.push("# HELP habi_worker_stale Worker instances whose heartbeat exceeded stale_after_seconds.");
  lines.push("# TYPE habi_worker_stale gauge");
  lines.push("# HELP habi_worker_last_seen_age_seconds Oldest worker heartbeat age by role.");
  lines.push("# TYPE habi_worker_last_seen_age_seconds gauge");

  for (const role of roles) {
    const workers = snapshot.workers.filter((worker) => worker.role === role);
    for (const status of [
      "STARTING",
      "HEALTHY",
      "DEGRADED",
      "STOPPING"
    ] as const) {
      lines.push(
        metricLine(
          "habi_worker_instances",
          workers.filter((worker) => worker.status === status).length,
          { role, status }
        )
      );
    }
    lines.push(
      metricLine(
        "habi_worker_stale",
        workers.filter((worker) => worker.stale).length,
        { role }
      )
    );
    lines.push(
      metricLine(
        "habi_worker_last_seen_age_seconds",
        workers.reduce(
          (oldest, worker) =>
            Math.max(oldest, worker.lastSeenAgeSeconds),
          0
        ),
        { role }
      )
    );
  }

  lines.push("# HELP habi_notification_jobs Notification jobs by operational state.");
  lines.push("# TYPE habi_notification_jobs gauge");
  lines.push(
    metricLine("habi_notification_jobs", snapshot.notifications.pending, {
      state: "pending"
    })
  );
  lines.push(
    metricLine("habi_notification_jobs", snapshot.notifications.failed, {
      state: "failed"
    })
  );
  lines.push(
    metricLine(
      "habi_notification_jobs",
      snapshot.notifications.manualReview,
      { state: "manual_review" }
    )
  );
  lines.push(
    metricLine(
      "habi_notification_oldest_pending_age_seconds",
      snapshot.notifications.oldestPendingAgeSeconds
    )
  );

  lines.push("# HELP habi_billing_webhooks Billing webhook inbox entries by state.");
  lines.push("# TYPE habi_billing_webhooks gauge");
  lines.push(
    metricLine("habi_billing_webhooks", snapshot.billingWebhooks.received, {
      state: "received"
    })
  );
  lines.push(
    metricLine("habi_billing_webhooks", snapshot.billingWebhooks.processing, {
      state: "processing"
    })
  );
  lines.push(
    metricLine(
      "habi_billing_webhooks",
      snapshot.billingWebhooks.reviewRequired,
      { state: "review_required" }
    )
  );
  lines.push(
    metricLine("habi_billing_webhooks", snapshot.billingWebhooks.failed, {
      state: "failed"
    })
  );
  lines.push(
    metricLine(
      "habi_billing_webhook_stale_processing",
      snapshot.billingWebhooks.staleProcessing
    )
  );
  lines.push(
    metricLine(
      "habi_billing_webhook_oldest_backlog_age_seconds",
      snapshot.billingWebhooks.oldestBacklogAgeSeconds
    )
  );

  return lines.join("\n") + "\n";
}
