import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateResourceLimit,
  InvalidEntitlementOverrideError,
  resolveEffectiveEntitlements,
  type PlanEntitlements
} from "./entitlements.js";

const plan: PlanEntitlements = {
  roomLimit: 60,
  staffLimit: 5,
  automationActionsMonthly: 1000,
  advancedReports: false,
  auditLog: false
};

test("plan values are effective without overrides", () => {
  const effective = resolveEffectiveEntitlements(plan, []);

  assert.equal(effective.roomLimit, 60);
  assert.equal(effective.source.room_limit, "PLAN");
});

test("active organization override wins over plan value", () => {
  const effective = resolveEffectiveEntitlements(
    plan,
    [
      {
        key: "room_limit",
        value: 80,
        expiresAt: "2027-01-01T00:00:00.000Z"
      }
    ],
    new Date("2026-09-21T00:00:00.000Z")
  );

  assert.equal(effective.roomLimit, 80);
  assert.equal(effective.source.room_limit, "OVERRIDE");
});

test("expired override is ignored", () => {
  const effective = resolveEffectiveEntitlements(
    plan,
    [
      {
        key: "room_limit",
        value: 80,
        expiresAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    new Date("2026-09-21T00:00:00.000Z")
  );

  assert.equal(effective.roomLimit, 60);
  assert.equal(effective.source.room_limit, "PLAN");
});

test("invalid typed override is rejected", () => {
  assert.throws(
    () =>
      resolveEffectiveEntitlements(plan, [
        { key: "room_limit", value: false, expiresAt: null }
      ]),
    InvalidEntitlementOverrideError
  );
});

test("organization already over limit can keep operating existing resources", () => {
  const decision = evaluateResourceLimit(72, 0, 60);

  assert.equal(decision.overLimit, true);
  assert.equal(decision.allowed, true);
});

test("organization over limit cannot create another room", () => {
  const decision = evaluateResourceLimit(72, 1, 60);

  assert.equal(decision.overLimit, true);
  assert.equal(decision.allowed, false);
});

test("request crossing the limit is denied before resource creation", () => {
  const decision = evaluateResourceLimit(59, 2, 60);

  assert.equal(decision.next, 61);
  assert.equal(decision.allowed, false);
});
