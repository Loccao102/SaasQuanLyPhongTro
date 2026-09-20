import assert from "node:assert/strict";
import test from "node:test";
import {
  executeLeaseCommandIdempotently,
  IdempotencyConflictError,
  type LeaseCommandReceiptStore,
  type StoredCommandReceipt
} from "./idempotent-command.js";

class MemoryReceiptStore implements LeaseCommandReceiptStore {
  private readonly receipts = new Map<string, StoredCommandReceipt>();

  async find(
    organizationId: string,
    idempotencyKey: string
  ): Promise<StoredCommandReceipt | null> {
    return this.receipts.get(`${organizationId}:${idempotencyKey}`) ?? null;
  }

  async save(input: {
    organizationId: string;
    idempotencyKey: string;
    commandType: string;
    leaseId: string | null;
    response: unknown;
  }): Promise<void> {
    this.receipts.set(
      `${input.organizationId}:${input.idempotencyKey}`,
      {
        commandType: input.commandType,
        response: input.response
      }
    );
  }
}

test("duplicate retry returns stored result and does not run operation twice", async () => {
  const store = new MemoryReceiptStore();
  let executions = 0;
  const input = {
    organizationId: "org-a",
    idempotencyKey: "cmd-123",
    commandType: "LEASE_ACTIVATE",
    leaseId: "lease-1"
  };

  const first = await executeLeaseCommandIdempotently(store, input, async () => {
    executions += 1;
    return { leaseId: "lease-1", version: 2 };
  });

  const second = await executeLeaseCommandIdempotently(store, input, async () => {
    executions += 1;
    return { leaseId: "lease-1", version: 999 };
  });

  assert.deepEqual(second, first);
  assert.equal(executions, 1);
});

test("reusing an idempotency key for a different command is rejected", async () => {
  const store = new MemoryReceiptStore();

  await executeLeaseCommandIdempotently(
    store,
    {
      organizationId: "org-a",
      idempotencyKey: "cmd-123",
      commandType: "LEASE_ACTIVATE",
      leaseId: "lease-1"
    },
    async () => ({ ok: true })
  );

  await assert.rejects(
    () =>
      executeLeaseCommandIdempotently(
        store,
        {
          organizationId: "org-a",
          idempotencyKey: "cmd-123",
          commandType: "LEASE_TERMINATE",
          leaseId: "lease-1"
        },
        async () => ({ ok: true })
      ),
    IdempotencyConflictError
  );
});

test("same idempotency key is isolated by organization", async () => {
  const store = new MemoryReceiptStore();
  let executions = 0;

  for (const organizationId of ["org-a", "org-b"]) {
    await executeLeaseCommandIdempotently(
      store,
      {
        organizationId,
        idempotencyKey: "same-client-key",
        commandType: "LEASE_ACTIVATE",
        leaseId: "lease-1"
      },
      async () => {
        executions += 1;
        return { organizationId };
      }
    );
  }

  assert.equal(executions, 2);
});
