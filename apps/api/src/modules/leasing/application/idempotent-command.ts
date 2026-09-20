export interface StoredCommandReceipt {
  commandType: string;
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
    super("The idempotency key was already used for a different command.");
    this.name = "IdempotencyConflictError";
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
  const idempotencyKey = input.idempotencyKey.trim();

  if (idempotencyKey.length === 0) {
    throw new InvalidIdempotencyKeyError();
  }

  const existing = await store.find(input.organizationId, idempotencyKey);

  if (existing) {
    if (existing.commandType !== input.commandType) {
      throw new IdempotencyConflictError();
    }

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
