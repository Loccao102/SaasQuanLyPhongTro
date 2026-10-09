import type { NotificationProviderResult } from "./notification-types.js";

const fatalProviderCodes = new Set([
  // Only shared integration breakage pauses all tenants.
  // Per-account logout, CAPTCHA or bad ciphertext must not affect another tenant.
  "PROVIDER_UI_BROKEN"
]);

export function fatalProviderPauseReason(
  result: NotificationProviderResult
): string | null {
  if (
    result.kind !== "MANUAL_REVIEW" &&
    result.kind !== "UNKNOWN"
  ) {
    return null;
  }

  const code = result.errorCode ?? "";
  if (!fatalProviderCodes.has(code)) {
    return null;
  }

  return code + ": " + (result.errorMessage ?? "provider requires attention");
}
