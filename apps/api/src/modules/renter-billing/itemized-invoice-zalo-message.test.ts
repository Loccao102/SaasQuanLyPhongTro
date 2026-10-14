import assert from "node:assert/strict";
import test from "node:test";
import {
  formatItemizedInvoiceZaloMessage,
  type ItemizedInvoice
} from "./itemized-invoice-zalo-message.js";

const invoice: ItemizedInvoice = {
  roomCode: "101",
  invoiceNumber: "INV-101",
  totalVnd: 3_250_000,
  paidVnd: 500_000,
  remainingVnd: 2_750_000,
  dueDate: "2026-10-20",
  publicUrl: "https://pay.example.test/i/habi_inv_abc",
  lines: [
    { type: "RENT", description: "Tiền phòng", quantity: "1", unitPriceVnd: 2_500_000, amountVnd: 2_500_000, snapshot: {} },
    { type: "ELECTRICITY", description: "Tiền điện", quantity: "100.000", unitPriceVnd: 4000, amountVnd: 400_000,
      snapshot: { meter: { previous: { value: "120.000" }, current: { value: "220.000" } } } },
    { type: "WATER", description: "Tiền nước", quantity: "10.000", unitPriceVnd: 20_000, amountVnd: 200_000,
      snapshot: { meter: { previous: { value: "50.000" }, current: { value: "60.000" } } } },
    { type: "SERVICE", description: "Internet", quantity: "1", unitPriceVnd: 150_000, amountVnd: 150_000, snapshot: {} }
  ]
};

test("renders each charge, readings, remaining balance and invoice QR page", () => {
  const text = formatItemizedInvoiceZaloMessage("2026-10", "Nguyễn Văn A", [invoice]);
  assert.match(text, /Phòng 101: 2\.750\.000đ/);
  assert.match(text, /Tiền phòng: 2\.500\.000đ/);
  assert.match(text, /Tiền điện · chỉ số 120 → 220 \(100 kWh\): 400\.000đ/);
  assert.match(text, /Tiền nước · chỉ số 50 → 60 \(10 m³\): 200\.000đ/);
  assert.match(text, /Internet: 150\.000đ/);
  assert.match(text, /Tổng hóa đơn: 3\.250\.000đ/);
  assert.match(text, /Đã thanh toán: 500\.000đ/);
  assert.match(text, /Còn phải thanh toán: 2\.750\.000đ/);
  assert.match(text, /https:\/\/pay\.example\.test\/i\/habi_inv_abc/);
});

test("never invents electricity/water readings for flat-fee lines", () => {
  const text = formatItemizedInvoiceZaloMessage("2026-10", null, [{
    ...invoice,
    totalVnd: 80_000, paidVnd: 0, remainingVnd: 80_000,
    lines: [{
      type: "WATER", description: "Nước khoán theo người",
      quantity: "2", unitPriceVnd: 40_000, amountVnd: 80_000, snapshot: { quantitySource: "OCCUPANT_COUNT" }
    }]
  }]);
  assert.match(text, /Nước khoán theo người: 80\.000đ/);
  assert.doesNotMatch(text, /chỉ số/);
});

test("rejects invoice line discrepancies and overlong notifications", () => {
  assert.throws(() => formatItemizedInvoiceZaloMessage("2026-10", null, [
    { ...invoice, totalVnd: 1 }
  ]), /do not match/);
  assert.throws(() => formatItemizedInvoiceZaloMessage("2026-10", null, [
    { ...invoice, roomCode: "X".repeat(4000) }
  ]), /exceeds 4000/);
});
