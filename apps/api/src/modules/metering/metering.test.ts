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

test("meter excel: builds and parses meter reading template roundtrip", async () => {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const rows = [
    ["BẢNG KÊ NHẬP CHỈ SỐ ĐIỆN NƯỚC (EXCEL)"],
    ["Ngày chốt chỉ số: 2026-10-01"],
    ["Hướng dẫn: Nhập chỉ số mới..."],
    [],
    [
      "Tầng",
      "Mã phòng",
      "Tên phòng",
      "Loại đồng hồ",
      "Tên/Vị trí đồng hồ",
      "Chỉ số cũ",
      "Ngày chốt cũ",
      "Chỉ số mới",
      "Mã hệ thống (Không sửa)"
    ],
    [1, "P.101", "Phòng 101", "Điện (KWH)", "Công tơ chính", 150, "2026-09-01", 195.5, "meter-uuid-101-elec"],
    [1, "P.101", "Phòng 101", "Nước (m3)", "Đồng hồ nước", 20, "2026-09-01", 25, "meter-uuid-101-water"],
    [2, "P.201", "Phòng 201", "Điện (KWH)", "Công tơ chính", 300, "2026-09-01", "", "meter-uuid-201-elec"]
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "ChiSoDienNuoc");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  assert.ok(Buffer.isBuffer(buffer));
  const parsedWb = XLSX.read(buffer, { type: "buffer" });
  assert.ok(parsedWb.SheetNames.includes("ChiSoDienNuoc"));
  const parsedRows = XLSX.utils.sheet_to_json<unknown[]>(parsedWb.Sheets["ChiSoDienNuoc"]!, { header: 1 });
  assert.equal(parsedRows.length, 8);
  assert.equal((parsedRows[5] as unknown[])[1], "P.101");
  assert.equal((parsedRows[5] as unknown[])[7], 195.5);
  assert.equal((parsedRows[5] as unknown[])[8], "meter-uuid-101-elec");
});

