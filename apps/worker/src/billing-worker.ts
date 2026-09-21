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

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  process.stdout.write(
    "[billing-worker] started intervalMs=" +
      String(sweepIntervalMs) +
      " limit=" +
      String(sweepLimit) +
      "\n"
  );

  while (!stopping) {
    try {
      const result = await api.billingSweep(sweepLimit);
      const failed = result.results.filter((item) => !item.ok).length;

      process.stdout.write(
        "[billing-worker] processed=" +
          String(result.processed) +
          " failed=" +
          String(failed) +
          "\n"
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown billing worker error";
      process.stderr.write("[billing-worker] " + message + "\n");
    }

    if (!stopping) {
      await sleep(sweepIntervalMs);
    }
  }

  process.stdout.write("[billing-worker] stopping\n");
}
