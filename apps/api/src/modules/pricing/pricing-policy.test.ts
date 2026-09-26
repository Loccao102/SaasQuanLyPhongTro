import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDecimal3,
  normalizePricingItems,
  pricingItemTypes
} from "./pricing.service.js";

test("pricing item types include all diversified types", () => {
  assert.ok(pricingItemTypes.includes("WATER_PER_PERSON"));
  assert.ok(pricingItemTypes.includes("WATER_PER_ROOM"));
  assert.ok(pricingItemTypes.includes("VEHICLE_PARKING"));
  assert.ok(pricingItemTypes.includes("SERVICE_PER_PERSON"));
  assert.ok(pricingItemTypes.includes("ELECTRICITY_PER_KWH"));
  assert.ok(pricingItemTypes.includes("WATER_PER_M3"));
  assert.ok(pricingItemTypes.includes("INTERNET"));
});

test("formatDecimal3 formats decimal with up to 3 decimals", () => {
  assert.equal(formatDecimal3(1, "qty"), "1.000");
  assert.equal(formatDecimal3("2.5", "qty"), "2.500");
  assert.equal(formatDecimal3("0.125", "qty"), "0.125");
  assert.throws(() => formatDecimal3("-1", "qty"), /must be a non-negative decimal/);
  assert.throws(() => formatDecimal3("abc", "qty"), /must be a non-negative decimal/);
  assert.throws(() => formatDecimal3("1.2345", "qty"), /must be a non-negative decimal/);
});

test("normalizePricingItems accepts diversified pricing items and defaults dynamic quantities", () => {
  const items = normalizePricingItems([
    {
      id: "item-1",
      itemType: "ELECTRICITY_PER_KWH",
      description: "Tiền điện đồng hồ",
      unitPriceVnd: 3500
    },
    {
      id: "item-2",
      itemType: "WATER_PER_PERSON",
      description: "Tiền nước theo đầu người",
      unitPriceVnd: 100000
    },
    {
      id: "item-3",
      itemType: "VEHICLE_PARKING",
      description: "Gửi xe máy theo đầu xe",
      unitPriceVnd: 120000
    },
    {
      id: "item-4",
      itemType: "SERVICE_PER_PERSON",
      description: "Phí dịch vụ chung theo đầu người",
      unitPriceVnd: 50000
    },
    {
      id: "item-5",
      itemType: "INTERNET",
      description: "Mạng Wifi",
      unitPriceVnd: 80000,
      fixedQuantity: 1
    }
  ]);

  assert.equal(items.length, 5);
  // Check dynamic quantities defaulted to "1.000"
  assert.equal(items.find((i) => i.itemType === "WATER_PER_PERSON")?.fixedQuantity, "1.000");
  assert.equal(items.find((i) => i.itemType === "VEHICLE_PARKING")?.fixedQuantity, "1.000");
  assert.equal(items.find((i) => i.itemType === "SERVICE_PER_PERSON")?.fixedQuantity, "1.000");
});

test("normalizePricingItems rejects conflicting water pricing models", () => {
  assert.throws(
    () =>
      normalizePricingItems([
        {
          id: "item-w1",
          itemType: "WATER_PER_M3",
          description: "Nước theo khối",
          unitPriceVnd: 25000
        },
        {
          id: "item-w2",
          itemType: "WATER_PER_PERSON",
          description: "Nước theo người",
          unitPriceVnd: 80000
        }
      ]),
    /at most one water pricing item/
  );
});

test("normalizePricingItems rejects conflicting parking pricing models", () => {
  assert.throws(
    () =>
      normalizePricingItems([
        {
          id: "item-p1",
          itemType: "PARKING",
          description: "Gửi xe trọn gói theo phòng",
          unitPriceVnd: 100000
        },
        {
          id: "item-p2",
          itemType: "VEHICLE_PARKING",
          description: "Gửi xe theo đầu xe",
          unitPriceVnd: 80000
        }
      ]),
    /at most one parking pricing item/
  );
});

test("normalizePricingItems rejects duplicate item IDs and negative prices", () => {
  assert.throws(
    () =>
      normalizePricingItems([
        {
          id: "dup-1",
          itemType: "INTERNET",
          description: "Wifi",
          unitPriceVnd: 50000
        },
        {
          id: "dup-1",
          itemType: "TRASH",
          description: "Rác",
          unitPriceVnd: 30000
        }
      ]),
    /ids must be unique/
  );

  assert.throws(
    () =>
      normalizePricingItems([
        {
          id: "item-neg",
          itemType: "INTERNET",
          description: "Wifi",
          unitPriceVnd: -100
        }
      ]),
    /unitPriceVnd must be a non-negative safe integer/
  );
});
