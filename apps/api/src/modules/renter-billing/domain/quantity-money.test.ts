import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeQuantity3,
  quantityTimesUnitPriceVnd
} from "./quantity-money.js";

test("quantity normalization preserves exact 3-decimal representation", () => {
  assert.equal(normalizeQuantity3("12.5"), "12.500");
  assert.equal(normalizeQuantity3(3), "3.000");
});

test("quantity price multiplication uses integer half-up VND rounding", () => {
  assert.equal(quantityTimesUnitPriceVnd("12.345", 3500), 43208);
  assert.equal(quantityTimesUnitPriceVnd("0.001", 1500), 2);
});
