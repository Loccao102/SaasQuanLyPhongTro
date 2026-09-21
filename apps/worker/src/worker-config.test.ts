import assert from "node:assert/strict";
import test from "node:test";
import {
  positiveInteger,
  resolveWorkerRole
} from "./worker-config.js";

test("worker role defaults to notification and accepts billing", () => {
  assert.equal(resolveWorkerRole(undefined), "NOTIFICATION");
  assert.equal(resolveWorkerRole("billing"), "BILLING");
});

test("worker role rejects unknown processes", () => {
  assert.throws(() => resolveWorkerRole("all"));
});

test("positive integer config rejects invalid values", () => {
  assert.equal(positiveInteger(undefined, 100, "LIMIT"), 100);
  assert.equal(positiveInteger("25", 100, "LIMIT"), 25);
  assert.throws(() => positiveInteger("0", 100, "LIMIT"));
  assert.throws(() => positiveInteger("1.5", 100, "LIMIT"));
});
