import type { BillingWebhookAdapter } from "./billing-webhook-types.js";
import { DevJsonBankBillingWebhookAdapter } from "./providers/dev-json-bank-billing-webhook.provider.js";
import { SePayRenterPaymentWebhookAdapter } from "./providers/sepay-renter-payment-webhook.provider.js";

export function loadBillingWebhookAdapter(): BillingWebhookAdapter {
  const provider = process.env.BILLING_WEBHOOK_PROVIDER?.trim();

  if (provider === "DEV_JSON_BANK") {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "DEV_JSON_BANK billing webhook adapter is disabled in production."
      );
    }
    return new DevJsonBankBillingWebhookAdapter();
  }

  throw new Error(
    "No billing webhook adapter is configured. " +
      "Set BILLING_WEBHOOK_PROVIDER to an installed adapter. " +
      "DEV_JSON_BANK is available only for local development."
  );
}

export function loadRenterPaymentWebhookAdapter(): BillingWebhookAdapter {
  const provider = process.env.RENTER_PAYMENT_WEBHOOK_PROVIDER?.trim();

  if (provider === "SEPAY") {
    return new SePayRenterPaymentWebhookAdapter();
  }

  if (provider === "DEV_JSON_BANK") {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "DEV_JSON_BANK renter payment webhook adapter is disabled in production."
      );
    }
    return new DevJsonBankBillingWebhookAdapter();
  }

  throw new Error(
    "No renter payment webhook adapter is configured. " +
      "Set RENTER_PAYMENT_WEBHOOK_PROVIDER to SEPAY in production " +
      "or DEV_JSON_BANK for local development."
  );
}
