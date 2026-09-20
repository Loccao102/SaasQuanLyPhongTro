import assert from "node:assert/strict";
import test from "node:test";
import {
  activateLease,
  cancelDraftLease,
  cancelLeaseTermination,
  finalizeLeaseTermination,
  InvalidLeaseDateError,
  InvalidLeaseTransitionError,
  leaseOccupiesRoom,
  LeaseTerminationNotReadyError,
  scheduleLeaseTermination,
  type LeaseState
} from "./lease-lifecycle.js";

function draft(overrides: Partial<LeaseState> = {}): LeaseState {
  return {
    id: "lease-1",
    organizationId: "org-a",
    roomId: "room-1",
    status: "DRAFT",
    startDate: "2026-10-01",
    plannedEndDate: "2027-09-30",
    terminationEffectiveDate: null,
    terminationReason: null,
    version: 1,
    ...overrides
  };
}

test("draft lease activates and increments optimistic version", () => {
  const result = activateLease(draft());

  assert.equal(result.lease.status, "ACTIVE");
  assert.equal(result.lease.version, 2);
  assert.equal(result.events[0]?.type, "LEASE_ACTIVATED");
});

test("activation rejects invalid date range", () => {
  assert.throws(
    () =>
      activateLease(
        draft({
          startDate: "2026-10-01",
          plannedEndDate: "2026-09-30"
        })
      ),
    InvalidLeaseDateError
  );
});

test("draft lease can be cancelled without deleting history", () => {
  const result = cancelDraftLease(draft());
  assert.equal(result.lease.status, "CANCELLED");
});

test("active lease can schedule a termination", () => {
  const active = activateLease(draft()).lease;
  const result = scheduleLeaseTermination(active, {
    effectiveDate: "2027-03-15",
    reason: "Người thuê chuyển đi"
  });

  assert.equal(result.lease.status, "TERMINATION_SCHEDULED");
  assert.equal(result.lease.terminationEffectiveDate, "2027-03-15");
  assert.equal(result.events[0]?.type, "LEASE_TERMINATION_SCHEDULED");
});

test("termination cannot be scheduled before lease starts", () => {
  const active = activateLease(draft()).lease;

  assert.throws(
    () =>
      scheduleLeaseTermination(active, {
        effectiveDate: "2026-09-30",
        reason: "Invalid"
      }),
    InvalidLeaseDateError
  );
});

test("scheduled termination can be cancelled back to active", () => {
  const active = activateLease(draft()).lease;
  const scheduled = scheduleLeaseTermination(active, {
    effectiveDate: "2027-03-15",
    reason: "Đổi kế hoạch"
  }).lease;

  const result = cancelLeaseTermination(scheduled);

  assert.equal(result.lease.status, "ACTIVE");
  assert.equal(result.lease.terminationEffectiveDate, null);
  assert.equal(result.lease.terminationReason, null);
});

test("termination cannot finalize while owning modules are pending", () => {
  const active = activateLease(draft()).lease;
  const scheduled = scheduleLeaseTermination(active, {
    effectiveDate: "2027-03-15",
    reason: "Chuyển đi"
  }).lease;

  assert.throws(
    () =>
      finalizeLeaseTermination(scheduled, {
        meter: "READY",
        financial: "PENDING",
        deposit: "READY"
      }),
    LeaseTerminationNotReadyError
  );
});

test("termination finalizes when meter financial and deposit readiness are resolved", () => {
  const active = activateLease(draft()).lease;
  const scheduled = scheduleLeaseTermination(active, {
    effectiveDate: "2027-03-15",
    reason: "Chuyển đi"
  }).lease;

  const result = finalizeLeaseTermination(scheduled, {
    meter: "READY",
    financial: "READY",
    deposit: "NOT_REQUIRED"
  });

  assert.equal(result.lease.status, "TERMINATED");
  assert.equal(result.events[0]?.type, "LEASE_TERMINATED");
});

test("invalid lifecycle transition is rejected", () => {
  assert.throws(
    () => activateLease(draft({ status: "TERMINATED" })),
    InvalidLeaseTransitionError
  );
});

test("only active and scheduled leases occupy a room", () => {
  assert.equal(leaseOccupiesRoom("DRAFT"), false);
  assert.equal(leaseOccupiesRoom("ACTIVE"), true);
  assert.equal(leaseOccupiesRoom("TERMINATION_SCHEDULED"), true);
  assert.equal(leaseOccupiesRoom("TERMINATED"), false);
  assert.equal(leaseOccupiesRoom("CANCELLED"), false);
});
