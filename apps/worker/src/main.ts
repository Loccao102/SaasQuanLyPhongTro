import { runBillingWebhookWorker } from "./billing-webhook-worker.js";
import { runBillingWorker } from "./billing-worker.js";
import { runNotificationWorker } from "./notification-worker.js";
import { runRenterPaymentWebhookWorker } from "./renter-payment-webhook-worker.js";
import { resolveWorkerRole } from "./worker-config.js";

async function main(): Promise<void> {
  const role = resolveWorkerRole(process.env.WORKER_ROLE);

  if (role === "BILLING") {
    await runBillingWorker();
    return;
  }

  if (role === "BILLING_WEBHOOK") {
    await runBillingWebhookWorker();
    return;
  }

  if (role === "RENTER_PAYMENT_WEBHOOK") {
    await runRenterPaymentWebhookWorker();
    return;
  }

  await runNotificationWorker();
}

void main();
