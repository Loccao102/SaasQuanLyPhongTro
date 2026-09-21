import type {
  BillingWebhookAdapter,
  BillingWebhookAdapterResult,
  ClaimedBillingWebhookEvent
} from "./billing-webhook-types.js";

export async function executeBillingWebhookAdapterSafely(
  adapter: BillingWebhookAdapter,
  event: ClaimedBillingWebhookEvent
): Promise<BillingWebhookAdapterResult> {
  if (event.provider !== adapter.provider) {
    return {
      kind: "REVIEW_REQUIRED",
      errorCode: "BILLING_WEBHOOK_PROVIDER_MISMATCH",
      errorMessage:
        "Claimed webhook provider does not match the configured adapter."
    };
  }

  try {
    return await adapter.normalize(event);
  } catch (error) {
    return {
      kind: "REVIEW_REQUIRED",
      errorCode: "BILLING_WEBHOOK_ADAPTER_ERROR",
      errorMessage:
        error instanceof Error
          ? error.message
          : "Unknown billing webhook adapter error"
    };
  }
}
