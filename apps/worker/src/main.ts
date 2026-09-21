import { setTimeout as sleep } from "node:timers/promises";
import { InternalWorkerApiClient } from "./internal-api-client.js";
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

async function main(): Promise<void> {
  const provider = loadProvider();
  const api = new InternalWorkerApiClient();
  const pollIntervalMs = positiveInteger(
    process.env.WORKER_POLL_INTERVAL_MS,
    1500,
    "WORKER_POLL_INTERVAL_MS"
  );

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  process.stdout.write(
    "[worker] notification provider=" + provider.name + "\n"
  );

  while (!stopping) {
    try {
      const job = await api.claim(provider.name);
      if (!job) {
        await sleep(pollIntervalMs);
        continue;
      }

      const result = await executeProviderSafely(provider, job);
      const completion = await api.complete(job, result);

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
      await sleep(pollIntervalMs);
    }
  }
}

void main();
