export type WorkerRole =
  | "NOTIFICATION"
  | "BILLING"
  | "BILLING_WEBHOOK";

export function resolveWorkerRole(value: string | undefined): WorkerRole {
  const normalized = value?.trim().toUpperCase() || "NOTIFICATION";
  if (
    normalized === "NOTIFICATION" ||
    normalized === "BILLING" ||
    normalized === "BILLING_WEBHOOK"
  ) {
    return normalized;
  }
  throw new Error(
    "WORKER_ROLE must be NOTIFICATION, BILLING or BILLING_WEBHOOK."
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
