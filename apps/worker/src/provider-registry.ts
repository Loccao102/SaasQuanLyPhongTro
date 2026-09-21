import type { NotificationProvider } from "./notification-types.js";
import { DevManualReviewProvider } from "./providers/dev-manual-review.provider.js";

export function loadProvider(): NotificationProvider {
  const provider = process.env.WORKER_PROVIDER?.trim();

  if (provider === "DEV_MANUAL_REVIEW") {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "DEV_MANUAL_REVIEW provider is disabled in production."
      );
    }
    return new DevManualReviewProvider();
  }

  throw new Error(
    "No notification provider adapter is configured. " +
      "Set WORKER_PROVIDER to an installed adapter. " +
      "DEV_MANUAL_REVIEW is available only for local development."
  );
}
