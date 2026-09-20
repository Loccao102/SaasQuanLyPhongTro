import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidSubscriptionTransitionError,
  subscriptionAccessMode,
  transitionSubscription,
  type SubscriptionState
} from "./subscription-lifecycle.js";

function subscription(
  overrides: Partial<SubscriptionState> = {}
): SubscriptionState {
  return {
    id: "sub-1",
    organizationId: "org-a",
    planId: "plan-pro",
    planVersionId: "plan-pro-v1",
    status: "ACTIVE",
    version: 1,
    ...overrides
  };
}

test("active subscription can become past due", () => {
  const result = transitionSubscription(
    subscription(),
    "PAST_DUE",
    "Renewal payment not received"
  );

  assert.equal(result.subscription.status, "PAST_DUE");
  assert.equal(result.subscription.version, 2);
  assert.equal(result.events[0]?.payload.from, "ACTIVE");
  assert.equal(result.events[0]?.payload.to, "PAST_DUE");
});

test("past due can recover directly to active after payment", () => {
  const result = transitionSubscription(
    subscription({ status: "PAST_DUE" }),
    "ACTIVE",
    "Payment received"
  );

  assert.equal(result.subscription.status, "ACTIVE");
});

test("grace period can suspend after grace expires", () => {
  const result = transitionSubscription(
    subscription({ status: "GRACE_PERIOD" }),
    "SUSPENDED",
    "Grace period expired"
  );

  assert.equal(result.subscription.status, "SUSPENDED");
});

test("suspended subscription can reactivate without changing plan snapshot", () => {
  const before = subscription({ status: "SUSPENDED" });
  const result = transitionSubscription(
    before,
    "ACTIVE",
    "Outstanding balance settled"
  );

  assert.equal(result.subscription.planVersionId, before.planVersionId);
  assert.equal(result.subscription.status, "ACTIVE");
});

test("cancelled subscription is terminal", () => {
  assert.throws(
    () =>
      transitionSubscription(
        subscription({ status: "CANCELLED" }),
        "ACTIVE",
        "Try to reactivate"
      ),
    InvalidSubscriptionTransitionError
  );
});

test("past due and grace remain full access while suspended is read only", () => {
  assert.equal(subscriptionAccessMode("PAST_DUE"), "FULL");
  assert.equal(subscriptionAccessMode("GRACE_PERIOD"), "FULL");
  assert.equal(subscriptionAccessMode("SUSPENDED"), "READ_ONLY");
  assert.equal(subscriptionAccessMode("CANCELLED"), "READ_ONLY");
});
