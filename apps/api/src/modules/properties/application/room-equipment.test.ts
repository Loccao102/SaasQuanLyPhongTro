import assert from "node:assert/strict";
import test from "node:test";
import {
  equipmentConditionStatuses,
  type EquipmentConditionStatus,
  type CreateRoomEquipmentInput
} from "./room-equipment.service.js";

function normalizeEquipmentInput(input: CreateRoomEquipmentInput): {
  name: string;
  quantity: number;
  conditionStatus: EquipmentConditionStatus;
  compensationValueVnd: number;
} {
  const name = input.name?.trim();
  if (!name || name.length === 0) {
    throw new Error("Tên trang thiết bị không được để trống.");
  }
  const quantity = Math.max(1, Math.floor(Number(input.quantity ?? 1)));
  const compensationValueVnd = Math.max(0, Math.floor(Number(input.compensationValueVnd ?? 0)));
  const conditionStatus = input.conditionStatus && equipmentConditionStatuses.includes(input.conditionStatus)
    ? input.conditionStatus
    : "GOOD";

  return { name, quantity, conditionStatus, compensationValueVnd };
}

test("room-equipment: normalizes valid equipment input correctly", () => {
  const result = normalizeEquipmentInput({
    name: "  Điều hoà Daikin 1.5HP ",
    quantity: 2,
    conditionStatus: "EXCELLENT",
    compensationValueVnd: 5000000
  });

  assert.equal(result.name, "Điều hoà Daikin 1.5HP");
  assert.equal(result.quantity, 2);
  assert.equal(result.conditionStatus, "EXCELLENT");
  assert.equal(result.compensationValueVnd, 5000000);
});

test("room-equipment: rejects empty equipment name", () => {
  assert.throws(
    () => normalizeEquipmentInput({ name: "   " }),
    /Tên trang thiết bị không được để trống/
  );
});

test("room-equipment: defaults invalid quantity and fallback condition to GOOD", () => {
  const result = normalizeEquipmentInput({
    name: "Tủ lạnh",
    quantity: -5,
    conditionStatus: "INVALID_STATUS" as any,
    compensationValueVnd: -1000
  });

  assert.equal(result.quantity, 1);
  assert.equal(result.conditionStatus, "GOOD");
  assert.equal(result.compensationValueVnd, 0);
});

test("room-equipment: accepts all defined condition statuses", () => {
  for (const status of equipmentConditionStatuses) {
    const res = normalizeEquipmentInput({ name: "Bàn làm việc", conditionStatus: status });
    assert.equal(res.conditionStatus, status);
  }
});
