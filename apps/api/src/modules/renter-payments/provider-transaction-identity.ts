import { createHash } from "node:crypto";

export type ProviderTransactionDirection = "IN" | "OUT";

export interface ProviderTransactionIdentityEvidence {
  aliasType: string;
  aliasValue: string;
  referenceNumber: string;
  destinationAccountNo: string;
  occurredAt: string;
  direction: ProviderTransactionDirection;
  amountVnd: number;
}

export interface NormalizedProviderTransactionIdentity {
  aliasType: string;
  aliasValue: string;
  referenceNumber: string;
  destinationAccountNo: string;
  occurredAt: string;
  direction: ProviderTransactionDirection;
  amountVnd: number;
  canonicalFingerprint: string;
}

export class InvalidProviderTransactionIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProviderTransactionIdentityError";
  }
}

function required(value: string, field: string, max = 200): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) {
    throw new InvalidProviderTransactionIdentityError(
      field + " must contain between 1 and " + String(max) + " characters."
    );
  }
  return normalized;
}

export function normalizeProviderTransactionIdentity(
  provider: string,
  evidence: ProviderTransactionIdentityEvidence
): NormalizedProviderTransactionIdentity {
  const normalizedProvider = required(provider, "provider", 64).toUpperCase();
  const aliasType = required(evidence.aliasType, "aliasType", 64).toUpperCase();
  const aliasValue = required(evidence.aliasValue, "aliasValue", 200);
  const referenceNumber = required(
    evidence.referenceNumber,
    "referenceNumber",
    200
  ).toUpperCase();
  const destinationAccountNo = required(
    evidence.destinationAccountNo,
    "destinationAccountNo",
    128
  )
    .replace(/\s+/g, "")
    .toUpperCase();

  if (
    !Number.isSafeInteger(evidence.amountVnd) ||
    evidence.amountVnd <= 0
  ) {
    throw new InvalidProviderTransactionIdentityError(
      "amountVnd must be a positive integer VND amount."
    );
  }

  if (evidence.direction !== "IN" && evidence.direction !== "OUT") {
    throw new InvalidProviderTransactionIdentityError(
      "direction must be IN or OUT."
    );
  }

  const occurred = new Date(evidence.occurredAt);
  if (Number.isNaN(occurred.getTime())) {
    throw new InvalidProviderTransactionIdentityError(
      "occurredAt must be a valid date-time."
    );
  }
  const occurredAt = occurred.toISOString();

  const canonicalFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        provider: normalizedProvider,
        referenceNumber,
        destinationAccountNo,
        occurredAt,
        direction: evidence.direction,
        amountVnd: evidence.amountVnd
      })
    )
    .digest("hex");

  return {
    aliasType,
    aliasValue,
    referenceNumber,
    destinationAccountNo,
    occurredAt,
    direction: evidence.direction,
    amountVnd: evidence.amountVnd,
    canonicalFingerprint
  };
}
