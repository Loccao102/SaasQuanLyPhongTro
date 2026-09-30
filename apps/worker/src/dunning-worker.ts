import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { InternalWorkerApiClient } from "./internal-api-client.js";
import { positiveInteger } from "./worker-config.js";

export async function runDunningWorker(): Promise<void> {
  const api = new InternalWorkerApiClient();
  const sweepIntervalMs = positiveInteger(
    process.env.DUNNING_SWEEP_INTERVAL_MS,
    300_000, // 5 minutes default in dedicated worker
    "DUNNING_SWEEP_INTERVAL_MS"
  );
  const sweepLimit = positiveInteger(
    process.env.DUNNING_SWEEP_LIMIT,
    100,
    "DUNNING_SWEEP_LIMIT"
  );

  const workerId =
    process.env.WORKER_ID?.trim() ||
    hostname() + "-dunning-" + String(process.pid);
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
        role: "DUNNING",
        status,
        staleAfterSeconds,
        lastErrorCode: input?.lastErrorCode ?? null,
        metadata: input?.metadata
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown heartbeat error";
      process.stderr.write(
        "[dunning-worker][observability] " + message + "\n"
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
    `[dunning-worker] id=${workerId} intervalMs=${sweepIntervalMs} limit=${sweepLimit}\n`
  );

  while (!stopping) {
    const startedAt = Date.now();
    try {
      const result = await api.renterBillingReminderSweep(sweepLimit);
      const durationMs = Date.now() - startedAt;

      await reportHeartbeat("HEALTHY", {
        metadata: {
          durationMs,
          scanned: result.scanned,
          reminded: result.reminded,
          skipped: result.skipped,
          sweepIntervalMs,
          sweepLimit
        }
      });

      process.stdout.write(
        `[dunning-worker] scanned=${result.scanned} reminded=${result.reminded} skipped=${result.skipped} durationMs=${durationMs}\n`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown dunning worker error";
      await reportHeartbeat("DEGRADED", {
        lastErrorCode: "DUNNING_SWEEP_ERROR",
        metadata: {
          durationMs: Date.now() - startedAt,
          sweepIntervalMs,
          sweepLimit
        }
      });
      process.stderr.write(`[dunning-worker] ${message}\n`);
    }

    if (!stopping) {
      await sleep(sweepIntervalMs);
    }
  }

  await reportHeartbeat("STOPPING");
  process.stdout.write("[dunning-worker] stopping\n");
}
