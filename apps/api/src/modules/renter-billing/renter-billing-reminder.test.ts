import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReminderMessage,
  computeReminderTier
} from "./renter-billing-reminder.service.js";

test("reminder tier: correctly identifies UPCOMING (2 days before)", () => {
  const tier = computeReminderTier("2026-10-10", "2026-10-08");
  assert.equal(tier, "UPCOMING");
});

test("reminder tier: correctly identifies DUE_TODAY", () => {
  const tier = computeReminderTier("2026-10-10", "2026-10-10");
  assert.equal(tier, "DUE_TODAY");
});

test("reminder tier: correctly identifies OVERDUE stages", () => {
  assert.equal(computeReminderTier("2026-10-10", "2026-10-11"), "OVERDUE_STAGE_1");
  assert.equal(computeReminderTier("2026-10-10", "2026-10-13"), "OVERDUE_STAGE_2");
  assert.equal(computeReminderTier("2026-10-10", "2026-10-17"), "OVERDUE_STAGE_3");
});

test("reminder tier: returns null for non-target interval days", () => {
  // 5 days before
  assert.equal(computeReminderTier("2026-10-15", "2026-10-10"), null);
  // 1 day before
  assert.equal(computeReminderTier("2026-10-11", "2026-10-10"), null);
  // 2 days overdue
  assert.equal(computeReminderTier("2026-10-08", "2026-10-10"), null);
  // 14 days overdue
  assert.equal(computeReminderTier("2026-09-26", "2026-10-10"), null);
});

test("buildReminderMessage: formats personalized polite Vietnamese reminder text", () => {
  const msg = buildReminderMessage({
    roomCode: "P.302",
    remainingVnd: 3500000,
    dueDate: "2026-10-10",
    publicUrl: "https://invoice.propops.vn/i/tok123",
    tier: "UPCOMING",
    residentName: "Nguyễn Văn A"
  });

  assert.ok(msg.includes("Nguyễn Văn A"));
  assert.ok(msg.includes("P.302"));
  assert.ok(msg.includes("3.500.000 đ"));
  assert.ok(msg.includes("2026-10-10"));
  assert.ok(msg.includes("https://invoice.propops.vn/i/tok123"));
  assert.ok(msg.includes("trong 2 ngày tới"));
});

test("buildReminderMessage: formats OVERDUE alert tone correctly", () => {
  const msg = buildReminderMessage({
    roomCode: "P.101",
    remainingVnd: 2800000,
    dueDate: "2026-10-05",
    publicUrl: "https://invoice.propops.vn/i/tok456",
    tier: "OVERDUE_STAGE_1"
  });

  assert.ok(msg.includes("CẢNH BÁO QUÁ HẠN"));
  assert.ok(msg.includes("quá hạn thanh toán 1 ngày"));
  assert.ok(msg.includes("2.800.000 đ"));
});
