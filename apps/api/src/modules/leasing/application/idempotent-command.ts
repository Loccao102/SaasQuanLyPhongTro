export interface StoredCommandReceipt {
  commandType: string;
  leaseId: string | null;
  response: unknown;
}

export interface LeaseCommandReceiptStore {
  find(
    organizationId: string,
    idempotencyKey: string
  ): Promise<StoredCommandReceipt | null>;

  save(input: {
    organizationId: string;
    idempotencyKey: string;
    commandType: string;
    leaseId: string | null;
    response: unknown;
  }): Promise<void>;
}

export class InvalidIdempotencyKeyError extends Error {
  constructor() {
    super("A non-empty idempotency key is required.");
    this.name = "InvalidIdempotencyKeyError";
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super(
      "The idempotency key was already used for a different command or lease."
    );
    this.name = "IdempotencyConflictError";
  }
}

export function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new InvalidIdempotencyKeyError();
  }

  return normalized;
}

export function assertReceiptMatches(
  receipt: StoredCommandReceipt,
  input: { commandType: string; leaseId: string | null }
): void {
  if (
    receipt.commandType !== input.commandType ||
    receipt.leaseId !== input.leaseId
  ) {
    throw new IdempotencyConflictError();
  }
}

export async function executeLeaseCommandIdempotently<T>(
  store: LeaseCommandReceiptStore,
  input: {
    organizationId: string;
    idempotencyKey: string;
    commandType: string;
    leaseId: string | null;
  },
  operation: () => Promise<T>
): Promise<T> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const existing = await store.find(input.organizationId, idempotencyKey);

  if (existing) {
    assertReceiptMatches(existing, input);
    return existing.response as T;
  }

  const response = await operation();

  await store.save({
    ...input,
    idempotencyKey,
    response
  });

  return response;
}
