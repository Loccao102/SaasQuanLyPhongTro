export type WorkerRole =
  | "NOTIFICATION"
  | "BILLING"
  | "BILLING_WEBHOOK"
  | "RENTER_PAYMENT_WEBHOOK"
  | "DUNNING"
  | "ZALO_LOGIN";

export function resolveWorkerRole(value: string | undefined): WorkerRole {
  const normalized = value?.trim().toUpperCase() || "NOTIFICATION";
  if (
    normalized === "NOTIFICATION" ||
    normalized === "BILLING" ||
    normalized === "BILLING_WEBHOOK" ||
    normalized === "RENTER_PAYMENT_WEBHOOK" ||
    normalized === "DUNNING" ||
    normalized === "ZALO_LOGIN"
  ) {
    return normalized;
  }
  throw new Error(
    "WORKER_ROLE must be NOTIFICATION, BILLING, BILLING_WEBHOOK, RENTER_PAYMENT_WEBHOOK, DUNNING, or ZALO_LOGIN."
  );
}

export function positiveInteger(
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
