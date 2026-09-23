import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EncryptedStorageStateStore,
  ExclusiveSessionFileLock
} from "./zalo-session-store.js";

test("encrypted Zalo storage state round-trips without plaintext leakage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "habi-zalo-session-"));
  const path = join(directory, "session.enc");
  const key = randomBytes(32).toString("base64");
  const state = {
    cookies: [{ name: "sensitive-cookie", value: "secret-session-value" }],
    origins: []
  };

  try {
    const store = new EncryptedStorageStateStore(path, key);
    await store.save(state);

    const raw = await readFile(path, "utf8");
    assert.doesNotMatch(raw, /secret-session-value/);
    assert.deepEqual(await store.load(), state);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("session file lock prevents concurrent browser use", async () => {
  const directory = await mkdtemp(join(tmpdir(), "habi-zalo-lock-"));
  const path = join(directory, "session.lock");
  const first = new ExclusiveSessionFileLock(path);
  const second = new ExclusiveSessionFileLock(path);

  try {
    assert.equal(await first.acquire(), true);
    assert.equal(await second.acquire(), false);
    await first.release();
    assert.equal(await second.acquire(), true);
    await second.release();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
