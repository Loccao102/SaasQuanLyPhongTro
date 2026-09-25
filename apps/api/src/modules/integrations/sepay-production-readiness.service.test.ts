import assert from "node:assert/strict";
import test from "node:test";
import { SePayProductionReadinessService } from "./sepay-production-readiness.service.js";

const currentName = "SEPAY_RENTER_WEBHOOK_SECRET";
const previousName = "SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS";
const originalCurrent = process.env[currentName];
const originalPrevious = process.env[previousName];

function restore() {
  if (originalCurrent === undefined) delete process.env[currentName];
  else process.env[currentName] = originalCurrent;

  if (originalPrevious === undefined) delete process.env[previousName];
  else process.env[previousName] = originalPrevious;
}

test("SePay webhook readiness is safe and never exposes secret material", () => {
  try {
    process.env[currentName] = "current-secret-0123456789abcdef";
    delete process.env[previousName];

    const view = new SePayProductionReadinessService().webhook();
    assert.equal(view.ready, true);
    assert.equal(view.overlapConfigured, false);
    assert.equal(
      JSON.stringify(view).includes("current-secret-0123456789abcdef"),
      false
    );
  } finally {
    restore();
  }
});

test("SePay webhook readiness warns during valid overlap and fails invalid rotation config", () => {
  try {
    process.env[currentName] = "current-secret-0123456789abcdef";
    process.env[previousName] = "previous-secret-0123456789abc";

    const overlap = new SePayProductionReadinessService().webhook();
    assert.equal(overlap.ready, true);
    assert.equal(overlap.overlapConfigured, true);
    assert.ok(
      overlap.checks.some(
        (check) =>
          check.code === "WEBHOOK_ROTATION_OVERLAP_ACTIVE" &&
          check.status === "WARN"
      )
    );

    process.env[previousName] = process.env[currentName];
    const equal = new SePayProductionReadinessService().webhook();
    assert.equal(equal.ready, false);

    process.env[previousName] = "short";
    const short = new SePayProductionReadinessService().webhook();
    assert.equal(short.ready, false);
  } finally {
    restore();
  }
});
