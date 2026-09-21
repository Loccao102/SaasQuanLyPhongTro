import { setTimeout as sleep } from "node:timers/promises";
import type {
  BillingWebhookAdapter,
  BillingWebhookAdapterResult,
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
    input: Extract<
      BillingWebhookAdapterResult,
      { kind: "REVIEW_REQUIRED" | "IGNORED" | "FAILED" }
    >
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

  await api.completeBillingWebhookOutcome(event.id, result);
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

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  process.stdout.write(
    "[billing-webhook-worker] provider=" +
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
      if (!processed && !stopping) {
        await sleep(pollIntervalMs);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown billing webhook worker error";
      process.stderr.write(
        "[billing-webhook-worker] " + message + "\n"
      );

      if (!stopping) {
        await sleep(pollIntervalMs);
      }
    }
  }

  process.stdout.write("[billing-webhook-worker] stopping\n");
}
