import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { InternalWorkerApiClient } from "./internal-api-client.js";
import { fatalProviderPauseReason } from "./provider-health.js";
import { executeProviderSafely } from "./provider-execution.js";
import { loadProvider } from "./provider-registry.js";
import { positiveInteger } from "./worker-config.js";

export async function runNotificationWorker(): Promise<void> {
  const provider = loadProvider();
  const api = new InternalWorkerApiClient();
  const pollIntervalMs = positiveInteger(
    process.env.WORKER_POLL_INTERVAL_MS,
    1500,
    "WORKER_POLL_INTERVAL_MS"
  );
  const heartbeatIntervalMs = positiveInteger(
    process.env.WORKER_HEARTBEAT_INTERVAL_MS,
    15000,
    "WORKER_HEARTBEAT_INTERVAL_MS"
  );
  const workerId =
    process.env.WORKER_ID?.trim() ||
    hostname() + "-" + String(process.pid);
  const staleAfterSeconds = Math.min(
    86400,
    Math.max(30, Math.ceil(heartbeatIntervalMs / 1000) * 4)
  );

  let stopping = false;
  let lastHeartbeatAt = 0;

  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const reportOperationalHeartbeat = async (
    status: "STARTING" | "HEALTHY" | "DEGRADED" | "STOPPING",
    input?: {
      lastErrorCode?: string | null;
      metadata?: Readonly<Record<string, unknown>>;
    }
  ) => {
    try {
      await api.observabilityHeartbeat({
        workerId,
        role: "NOTIFICATION",
        provider: provider.name,
        status,
        staleAfterSeconds,
        lastErrorCode: input?.lastErrorCode ?? null,
        metadata: input?.metadata
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown heartbeat error";
      process.stderr.write(
        "[notification-worker][observability] " + message + "\n"
      );
    }
  };

  await api.heartbeat({
    workerId,
    provider: provider.name,
    status: "STARTING",
    metadata: { pid: process.pid, hostname: hostname() }
  });
  await reportOperationalHeartbeat("STARTING", {
    metadata: {
      pollIntervalMs,
      heartbeatIntervalMs
    }
  });

  process.stdout.write(
    "[notification-worker] id=" +
      workerId +
      " provider=" +
      provider.name +
      "\n"
  );

  while (!stopping) {
    try {
      const now = Date.now();
      if (now - lastHeartbeatAt >= heartbeatIntervalMs) {
        await api.heartbeat({
          workerId,
          provider: provider.name,
          status: "HEALTHY",
          metadata: { pid: process.pid, hostname: hostname() }
        });
        await reportOperationalHeartbeat("HEALTHY", {
          metadata: {
            pollIntervalMs,
            heartbeatIntervalMs
          }
        });
        lastHeartbeatAt = now;
      }

      const claimProviders = [
        provider.name,
        ...(provider.claimAliases ?? [])
      ];
      let job = null;
      for (const claimProvider of claimProviders) {
        job = await api.claim(claimProvider);
        if (job) break;
      }

      if (!job) {
        await sleep(pollIntervalMs);
        continue;
      }

      const result = await executeProviderSafely(provider, job);
      const completion = await api.complete(job, result);
      const pauseProviderReason = fatalProviderPauseReason(result);

      if (pauseProviderReason) {
        const errorCode =
          "errorCode" in result ? result.errorCode ?? null : null;
        await api.heartbeat({
          workerId,
          provider: provider.name,
          status: "DEGRADED",
          lastErrorCode: errorCode,
          lastErrorMessage:
            "errorMessage" in result ? result.errorMessage ?? null : null,
          pauseProviderReason,
          metadata: {
            jobId: job.id,
            attemptNumber: job.attemptNumber
          }
        });
        await reportOperationalHeartbeat("DEGRADED", {
          lastErrorCode: errorCode,
          metadata: {
            attemptNumber: job.attemptNumber
          }
        });
        lastHeartbeatAt = Date.now();
      }

      process.stdout.write(
        "[notification-worker] job=" +
          job.id +
          " attempt=" +
          String(job.attemptNumber) +
          " status=" +
          completion.status +
          "\n"
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown worker error";
      process.stderr.write(
        "[notification-worker] " + message + "\n"
      );

      try {
        await api.heartbeat({
          workerId,
          provider: provider.name,
          status: "DEGRADED",
          lastErrorCode: "WORKER_LOOP_ERROR",
          lastErrorMessage: message,
          metadata: { pid: process.pid, hostname: hostname() }
        });
        await reportOperationalHeartbeat("DEGRADED", {
          lastErrorCode: "WORKER_LOOP_ERROR",
          metadata: {
            pollIntervalMs,
            heartbeatIntervalMs
          }
        });
        lastHeartbeatAt = Date.now();
      } catch {
        // The API may itself be unavailable. Avoid masking the original error.
      }

      await sleep(pollIntervalMs);
    }
  }

  try {
    await api.heartbeat({
      workerId,
      provider: provider.name,
      status: "STOPPING",
      metadata: { pid: process.pid, hostname: hostname() }
    });
  } catch {
    // Best-effort provider-specific shutdown heartbeat.
  }
  await reportOperationalHeartbeat("STOPPING");
}
