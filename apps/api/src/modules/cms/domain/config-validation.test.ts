import assert from "node:assert/strict";
import test from "node:test";
import {
  CmsConfigValidationError,
  validatePlanConfig,
  validateSettingValue
} from "./config-validation.js";

test("boolean setting accepts boolean only", () => {
  assert.doesNotThrow(() => validateSettingValue("BOOLEAN", true));
  assert.throws(
    () => validateSettingValue("BOOLEAN", "true"),
    CmsConfigValidationError
  );
});

test("integer setting rejects negative and fractional values", () => {
  assert.throws(
    () => validateSettingValue("INTEGER", -1),
    CmsConfigValidationError
  );
  assert.throws(
    () => validateSettingValue("INTEGER", 1.5),
    CmsConfigValidationError
  );
});

test("plan config requires positive room and staff limits", () => {
  assert.throws(
    () =>
      validatePlanConfig({
        monthlyPriceVnd: 99000,
        roomLimit: 0,
        staffLimit: 2,
        automationQuota: 500
      }),
    CmsConfigValidationError
  );
});
