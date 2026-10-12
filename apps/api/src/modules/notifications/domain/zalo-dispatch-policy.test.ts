import assert from "node:assert/strict";
import test from "node:test";
import { zaloDispatchPolicy } from "./zalo-dispatch-policy.js";

test("Zalo messaging defaults to cautious pacing and daytime-only delivery", () => {
  assert.deepEqual(zaloDispatchPolicy({}), {
    minGapSeconds: 60,
    maxPer15Minutes: 4,
    maxPer24Hours: 30,
    startHour: 8,
    endHour: 20
  });
});

test("Zalo pacing can be made stricter without raising the safety ceiling", () => {
  const policy = zaloDispatchPolicy({
    ZALO_SEND_MIN_GAP_SECONDS: "120",
    ZALO_SEND_MAX_PER_15_MINUTES: "2",
    ZALO_SEND_MAX_PER_24_HOURS: "15",
    ZALO_SEND_START_HOUR: "9",
    ZALO_SEND_END_HOUR: "18"
  });
  assert.equal(policy.minGapSeconds, 120);
  assert.equal(policy.maxPer15Minutes, 2);
  assert.equal(policy.maxPer24Hours, 15);
});

test("rejects unsafe pacing and invalid operating hours", () => {
  assert.throws(() => zaloDispatchPolicy({ ZALO_SEND_MIN_GAP_SECONDS: "0" }));
  assert.throws(() => zaloDispatchPolicy({ ZALO_SEND_MAX_PER_15_MINUTES: "100" }));
  assert.throws(() => zaloDispatchPolicy({ ZALO_SEND_MAX_PER_24_HOURS: "100" }));
  assert.throws(() => zaloDispatchPolicy({
    ZALO_SEND_START_HOUR: "22", ZALO_SEND_END_HOUR: "8"
  }));
});
