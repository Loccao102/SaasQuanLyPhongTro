import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { InternalWorkerApiClient } from "./internal-api-client.js";
import type { NotificationProviderResult } from "./notification-types.js";
import { executeProviderSafely } from "./provider-execution.js";
import { loadProvider } from "./provider-registry.js";

function positiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(name + " must be a positive integer.");
  }
  return value;
}

function fatalProviderReason(
  result: NotificationProviderResult
): string | null {
  if (
    result.kind !== "MANUAL_REVIEW" &&
    result.kind !== "UNKNOWN"
  ) {
    return null;
  }

  const code = result.errorCode ?? "";
  if (
    code === "AUTH_REQUIRED" ||
    code === "SESSION_EXPIRED" ||
    code === "CAPTCHA" ||
    code === "PROVIDER_UI_BROKEN"
  ) {
    return code + ": " + (result.errorMessage ?? "provider requires attention");
  }

  return null;
}

async function main(): Promise<void> {
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

  let stopping = false;
  let lastHeartbeatAt = 0;

  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  await api.heartbeat({
    workerId,
    provider: provider.name,
    status: "STARTING",
    metadata: { pid: process.pid, hostname: hostname() }
  });

  process.stdout.write(
    "[worker] id=" + workerId + " provider=" + provider.name + "\n"
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
        lastHeartbeatAt = now;
      }

      const job = await api.claim(provider.name);
      if (!job) {
        await sleep(pollIntervalMs);
        continue;
      }

      const result = await executeProviderSafely(provider, job);
      const completion = await api.complete(job, result);
      const pauseProviderReason = fatalProviderReason(result);

      if (pauseProviderReason) {
        await api.heartbeat({
          workerId,
          provider: provider.name,
          status: "DEGRADED",
          lastErrorCode:
            "errorCode" in result ? result.errorCode ?? null : null,
          lastErrorMessage:
            "errorMessage" in result ? result.errorMessage ?? null : null,
          pauseProviderReason,
          metadata: {
            jobId: job.id,
            attemptNumber: job.attemptNumber
          }
        });
        lastHeartbeatAt = Date.now();
      }

      process.stdout.write(
        "[worker] job=" +
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
      process.stderr.write("[worker] " + message + "\n");

      try {
        await api.heartbeat({
          workerId,
          provider: provider.name,
          status: "DEGRADED",
          lastErrorCode: "WORKER_LOOP_ERROR",
          lastErrorMessage: message,
          metadata: { pid: process.pid, hostname: hostname() }
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
    // Best-effort shutdown heartbeat.
  }
}

void main();
