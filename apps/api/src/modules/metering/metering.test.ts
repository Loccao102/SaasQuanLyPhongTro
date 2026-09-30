import assert from "node:assert/strict";
import test from "node:test";
import { formatMeterValue, normalizeMeterInput, validateAgainstPrevious, anomalyWarning } from "../../../../staff/lib/meter-entry-domain.js";

test("meter value formatting trims redundant trailing zeros", () => {
  assert.equal(formatMeterValue("12.500"), "12.5");
  assert.equal(formatMeterValue("100.000"), "100");
  assert.equal(formatMeterValue("0.123"), "0.123");
  assert.equal(formatMeterValue(45), "45");
});

test("meter input normalization handles comma and decimal limits", () => {
  assert.equal(normalizeMeterInput(" 123,45 "), "123.45");
  assert.equal(normalizeMeterInput("50.0"), "50");
  assert.equal(normalizeMeterInput("50.1234"), null); // exceeds 3 decimals
  assert.equal(normalizeMeterInput("abc"), null);
});

test("validation against previous reading rejects lower values", () => {
  assert.equal(validateAgainstPrevious("100", "90"), null);
  assert.equal(validateAgainstPrevious("100", "100"), null);
  assert.notEqual(validateAgainstPrevious("99.9", "100"), null);
});

test("anomaly warning triggers when usage is 2.5x baseline", () => {
  assert.equal(anomalyWarning("120", "100", "50"), null); // delta 20 <= 50 * 2.5
  assert.notEqual(anomalyWarning("250", "100", "50"), null); // delta 150 > 125
});
