import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import type { BillingWebhookAdapter } from "./billing-webhook-types.js";
import { executeBillingWebhookAdapterSafely } from "./billing-webhook-execution.js";
import { loadRenterPaymentWebhookAdapter } from "./billing-webhook-provider-registry.js";
import { InternalWorkerApiClient } from "./internal-api-client.js";
import { positiveInteger } from "./worker-config.js";
import {
  runSePayReconciliationSweepOnce,
  SePayApiV2Client
} from "./sepay-api-v2-reconciliation.js";

export async function processRenterPaymentWebhookOnce(
  api: Pick<
    InternalWorkerApiClient,
    | "claimRenterPaymentWebhook"
    | "completeRenterPaymentWebhookPayment"
    | "completeRenterPaymentWebhookOutcome"
  >,
  adapter: BillingWebhookAdapter
): Promise<boolean> {
  const event = await api.claimRenterPaymentWebhook(adapter.provider);
  if (!event) return false;

  const result = await executeBillingWebhookAdapterSafely(adapter, event);
  if (result.kind === "PAYMENT") {
    await api.completeRenterPaymentWebhookPayment(event.id, result.payment);
    return true;
  }

  await api.completeRenterPaymentWebhookOutcome(event.id, {
    outcome: result.kind,
    errorCode: result.errorCode ?? null,
    errorMessage: result.errorMessage ?? null
  });
  return true;
}

export async function runRenterPaymentWebhookWorker(): Promise<void> {
  const adapter = loadRenterPaymentWebhookAdapter();
  const api = new InternalWorkerApiClient();
  const pollIntervalMs = positiveInteger(
    process.env.RENTER_PAYMENT_WEBHOOK_POLL_INTERVAL_MS,
    1500,
    "RENTER_PAYMENT_WEBHOOK_POLL_INTERVAL_MS"
  );
  const heartbeatIntervalMs = positiveInteger(
    process.env.WORKER_HEARTBEAT_INTERVAL_MS,
    15000,
    "WORKER_HEARTBEAT_INTERVAL_MS"
  );
  const workerId =
    process.env.WORKER_ID?.trim() ||
    hostname() + "-renter-payment-webhook-" + String(process.pid);
  const reconciliationEnabled =
    process.env.SEPAY_RECONCILIATION_ENABLED?.trim().toLowerCase() === "true";
  if (reconciliationEnabled && adapter.provider !== "SEPAY") {
    throw new Error(
      "SePay reconciliation can only run with RENTER_PAYMENT_WEBHOOK_PROVIDER=SEPAY."
    );
  }
  const reconciliationIntervalMs = positiveInteger(
    process.env.SEPAY_RECONCILIATION_INTERVAL_MS,
    900000,
    "SEPAY_RECONCILIATION_INTERVAL_MS"
  );
  const reconciliationLookbackHours = positiveInteger(
    process.env.SEPAY_RECONCILIATION_INITIAL_LOOKBACK_HOURS,
    24,
    "SEPAY_RECONCILIATION_INITIAL_LOOKBACK_HOURS"
  );
  const reconciliationScopeKey =
    process.env.SEPAY_RECONCILIATION_SCOPE_KEY?.trim() || "default";
  const reconciliationClient = reconciliationEnabled
    ? new SePayApiV2Client()
    : null;
  const staleAfterSeconds = Math.min(
    86400,
    Math.max(30, Math.ceil(heartbeatIntervalMs / 1000) * 4)
  );

  let stopping = false;
  let lastHeartbeatAt = 0;
  let lastReconciliationAttemptAt = 0;
  let processedSinceHeartbeat = 0;
  let reconciliationObservedSinceHeartbeat = 0;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const reportHeartbeat = async (
    status: "STARTING" | "HEALTHY" | "DEGRADED" | "STOPPING",
    lastErrorCode?: string | null
  ) => {
    try {
      await api.observabilityHeartbeat({
        workerId,
        role: "RENTER_PAYMENT_WEBHOOK",
        provider: adapter.provider,
        status,
        staleAfterSeconds,
        lastErrorCode: lastErrorCode ?? null,
        metadata: {
          pollIntervalMs,
          processedSinceHeartbeat,
          reconciliationEnabled,
          reconciliationIntervalMs,
          reconciliationObservedSinceHeartbeat
        }
      });
      lastHeartbeatAt = Date.now();
    } catch (error) {
      process.stderr.write(
        "[renter-payment-webhook-worker][observability] " +
          (error instanceof Error ? error.message : "Unknown heartbeat error") +
          "\n"
      );
    }
  };

  await reportHeartbeat("STARTING");
  process.stdout.write(
    "[renter-payment-webhook-worker] id=" +
      workerId +
      " provider=" +
      adapter.provider +
      " intervalMs=" +
      String(pollIntervalMs) +
      "\n"
  );

  while (!stopping) {
    try {
      const now = Date.now();
      if (
        reconciliationClient &&
        now - lastReconciliationAttemptAt >= reconciliationIntervalMs
      ) {
        lastReconciliationAttemptAt = now;
        const sweep = await runSePayReconciliationSweepOnce(
          api,
          reconciliationClient,
          {
            scopeKey: reconciliationScopeKey,
            initialLookbackHours: reconciliationLookbackHours
          }
        );
        reconciliationObservedSinceHeartbeat += sweep.observed;
        process.stdout.write(
          "[renter-payment-reconciliation] observed=" +
            String(sweep.observed) +
            " pages=" +
            String(sweep.pages) +
            " cursor=" +
            String(sweep.nextCursor ?? "none") +
            "\n"
        );
      }

      const processed = await processRenterPaymentWebhookOnce(api, adapter);
      if (processed) processedSinceHeartbeat += 1;

      if (Date.now() - lastHeartbeatAt >= heartbeatIntervalMs) {
        await reportHeartbeat("HEALTHY");
        processedSinceHeartbeat = 0;
        reconciliationObservedSinceHeartbeat = 0;
      }
      if (!processed && !stopping) await sleep(pollIntervalMs);
    } catch (error) {
      await reportHeartbeat("DEGRADED", "RENTER_PAYMENT_WEBHOOK_LOOP_ERROR");
      processedSinceHeartbeat = 0;
      reconciliationObservedSinceHeartbeat = 0;
      process.stderr.write(
        "[renter-payment-webhook-worker] " +
          (error instanceof Error ? error.message : "Unknown worker error") +
          "\n"
      );
      if (!stopping) await sleep(pollIntervalMs);
    }
  }

  await reportHeartbeat("STOPPING");
}
