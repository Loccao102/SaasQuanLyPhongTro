import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  BillingWebhookAdapter,
  ClaimedBillingWebhookEvent,
  NormalizedBillingWebhookPayment
} from "./billing-webhook-types.js";
import { executeBillingWebhookAdapterSafely } from "./billing-webhook-execution.js";
import { loadBillingWebhookAdapter } from "./billing-webhook-provider-registry.js";
import { InternalWorkerApiClient } from "./internal-api-client.js";
import { positiveInteger } from "./worker-config.js";

export interface BillingWebhookWorkerApi {
  claimBillingWebhook(
    provider: string
  ): Promise<ClaimedBillingWebhookEvent | null>;

  completeBillingWebhookPayment(
    eventId: string,
    payment: NormalizedBillingWebhookPayment
  ): Promise<unknown>;

  completeBillingWebhookOutcome(
    eventId: string,
    input: {
      outcome: "REVIEW_REQUIRED" | "IGNORED" | "FAILED";
      errorCode?: string | null;
      errorMessage?: string | null;
    }
  ): Promise<unknown>;
}

export async function processBillingWebhookOnce(
  api: BillingWebhookWorkerApi,
  adapter: BillingWebhookAdapter
): Promise<boolean> {
  const event = await api.claimBillingWebhook(adapter.provider);
  if (!event) return false;

  const result = await executeBillingWebhookAdapterSafely(
    adapter,
    event
  );

  if (result.kind === "PAYMENT") {
    await api.completeBillingWebhookPayment(
      event.id,
      result.payment
    );
    return true;
  }

  await api.completeBillingWebhookOutcome(event.id, {
    outcome: result.kind,
    errorCode: result.errorCode ?? null,
    errorMessage: result.errorMessage ?? null
  });
  return true;
}

export async function runBillingWebhookWorker(): Promise<void> {
  const adapter = loadBillingWebhookAdapter();
  const api = new InternalWorkerApiClient();
  const pollIntervalMs = positiveInteger(
    process.env.BILLING_WEBHOOK_POLL_INTERVAL_MS,
    1500,
    "BILLING_WEBHOOK_POLL_INTERVAL_MS"
  );
  const heartbeatIntervalMs = positiveInteger(
    process.env.WORKER_HEARTBEAT_INTERVAL_MS,
    15000,
    "WORKER_HEARTBEAT_INTERVAL_MS"
  );
  const workerId =
    process.env.WORKER_ID?.trim() ||
    hostname() + "-billing-webhook-" + String(process.pid);
  const staleAfterSeconds = Math.min(
    86400,
    Math.max(30, Math.ceil(heartbeatIntervalMs / 1000) * 4)
  );

  let stopping = false;
  let lastHeartbeatAt = 0;
  let processedSinceHeartbeat = 0;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

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
        role: "BILLING_WEBHOOK",
        provider: adapter.provider,
        status,
        staleAfterSeconds,
        lastErrorCode: input?.lastErrorCode ?? null,
        metadata: input?.metadata
      });
      lastHeartbeatAt = Date.now();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown heartbeat error";
      process.stderr.write(
        "[billing-webhook-worker][observability] " + message + "\n"
      );
    }
  };

  await reportHeartbeat("STARTING", {
    metadata: { pollIntervalMs, heartbeatIntervalMs }
  });

  process.stdout.write(
    "[billing-webhook-worker] id=" +
      workerId +
      " provider=" +
      adapter.provider +
      " intervalMs=" +
      String(pollIntervalMs) +
      "\n"
  );

  while (!stopping) {
    try {
      const processed = await processBillingWebhookOnce(
        api,
        adapter
      );
      if (processed) {
        processedSinceHeartbeat += 1;
      }

      const now = Date.now();
      if (now - lastHeartbeatAt >= heartbeatIntervalMs) {
        await reportHeartbeat("HEALTHY", {
          metadata: {
            pollIntervalMs,
            processedSinceHeartbeat
          }
        });
        processedSinceHeartbeat = 0;
      }

      if (!processed && !stopping) {
        await sleep(pollIntervalMs);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown billing webhook worker error";
      await reportHeartbeat("DEGRADED", {
        lastErrorCode: "BILLING_WEBHOOK_LOOP_ERROR",
        metadata: {
          pollIntervalMs,
          processedSinceHeartbeat
        }
      });
      processedSinceHeartbeat = 0;
      process.stderr.write(
        "[billing-webhook-worker] " + message + "\n"
      );

      if (!stopping) {
        await sleep(pollIntervalMs);
      }
    }
  }

  await reportHeartbeat("STOPPING");
  process.stdout.write("[billing-webhook-worker] stopping\n");
}
