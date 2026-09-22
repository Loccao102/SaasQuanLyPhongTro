import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { InternalWorkerApiClient } from "./internal-api-client.js";
import { positiveInteger } from "./worker-config.js";

export async function runBillingWorker(): Promise<void> {
  const api = new InternalWorkerApiClient();
  const sweepIntervalMs = positiveInteger(
    process.env.BILLING_SWEEP_INTERVAL_MS,
    60_000,
    "BILLING_SWEEP_INTERVAL_MS"
  );
  const sweepLimit = positiveInteger(
    process.env.BILLING_SWEEP_LIMIT,
    100,
    "BILLING_SWEEP_LIMIT"
  );

  if (sweepLimit > 500) {
    throw new Error("BILLING_SWEEP_LIMIT must be <= 500.");
  }

  const workerId =
    process.env.WORKER_ID?.trim() ||
    hostname() + "-billing-" + String(process.pid);
  const staleAfterSeconds = Math.min(
    86400,
    Math.max(30, Math.ceil(sweepIntervalMs / 1000) * 3)
  );

  const reportHeartbeat = async (
    status: "STARTING" | "HEALTHY" | "DEGRADED" | "STOPPING",
    input?: {
      lastErrorCode?: string | null;
      metadata?: Readonly<Record<string, unknown>>;
    }
  ) => {
    try {
      await api.observabilityHeartbeat({
        workerId,
        role: "BILLING",
        status,
        staleAfterSeconds,
        lastErrorCode: input?.lastErrorCode ?? null,
        metadata: input?.metadata
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown heartbeat error";
      process.stderr.write(
        "[billing-worker][observability] " + message + "\n"
      );
    }
  };

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  await reportHeartbeat("STARTING", {
    metadata: {
      sweepIntervalMs,
      sweepLimit
    }
  });

  process.stdout.write(
    "[billing-worker] id=" +
      workerId +
      " intervalMs=" +
      String(sweepIntervalMs) +
      " limit=" +
      String(sweepLimit) +
      "\n"
  );

  while (!stopping) {
    const startedAt = Date.now();
    try {
      const result = await api.billingSweep(sweepLimit);
      const failed = result.results.filter((item) => !item.ok).length;
      const durationMs = Date.now() - startedAt;

      await reportHeartbeat(failed > 0 ? "DEGRADED" : "HEALTHY", {
        lastErrorCode: failed > 0 ? "BILLING_SWEEP_PARTIAL_FAILURE" : null,
        metadata: {
          durationMs,
          processed: result.processed,
          failed,
          sweepIntervalMs,
          sweepLimit
        }
      });

      process.stdout.write(
        "[billing-worker] processed=" +
          String(result.processed) +
          " failed=" +
          String(failed) +
          " durationMs=" +
          String(durationMs) +
          "\n"
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown billing worker error";
      await reportHeartbeat("DEGRADED", {
        lastErrorCode: "BILLING_SWEEP_ERROR",
        metadata: {
          durationMs: Date.now() - startedAt,
          sweepIntervalMs,
          sweepLimit
        }
      });
      process.stderr.write("[billing-worker] " + message + "\n");
    }

    if (!stopping) {
      await sleep(sweepIntervalMs);
    }
  }

  await reportHeartbeat("STOPPING");
  process.stdout.write("[billing-worker] stopping\n");
}
