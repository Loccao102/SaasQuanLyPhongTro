export type WorkerRole =
  | "NOTIFICATION"
  | "BILLING"
  | "BILLING_WEBHOOK"
  | "RENTER_PAYMENT_WEBHOOK";

export type WorkerStatus =
  | "STARTING"
  | "HEALTHY"
  | "DEGRADED"
  | "STOPPING";

export type ApiRuntimeMetrics = {
  requestCount: number;
  errorCount: number;
  durationSumMs: number;
  durationMaxMs: number;
  latencyBucketsMs: Array<{
    le: number;
    count: number;
  }>;
};

export type DatabaseRuntimeMetrics = {
  pool: {
    max: number;
    total: number;
    idle: number;
    waiting: number;
  };
  operations: {
    queryCount: number;
    transactionCount: number;
    slowOperationCount: number;
    durationSumMs: number;
    durationMaxMs: number;
    slowThresholdMs: number;
  };
};

export type WorkerHealthView = {
  workerId: string;
  role: WorkerRole;
  provider: string | null;
  status: WorkerStatus;
  lastSeenAt: string;
  lastSeenAgeSeconds: number;
  staleAfterSeconds: number;
  stale: boolean;
  lastErrorCode: string | null;
};

export type OperationalSnapshot = {
  generatedAt: string;
  api: ApiRuntimeMetrics;
  database: DatabaseRuntimeMetrics;
  workers: WorkerHealthView[];
  notifications: {
    pending: number;
    failed: number;
    manualReview: number;
    sent24h: number;
    failed24h: number;
    manualReview24h: number;
    oldestPendingAgeSeconds: number;
  };
  billingWebhooks: {
    received: number;
    processing: number;
    reviewRequired: number;
    failed: number;
    staleProcessing: number;
    processed24h: number;
    oldestBacklogAgeSeconds: number;
  };
};
