import assert from "node:assert/strict";
import test from "node:test";
import { buildStyledReportExcel } from "../../admin/lib/report-excel-export.js";

function readStoredEntries(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decode = new TextDecoder();
  const entries = new Map<string, string>();
  let offset = 0;
  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 8, true), 0, "XLSX writer uses ZIP STORE");
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extraLength;
    assert.ok(start + size <= bytes.length, "ZIP payload fits output size");
    const name = decode.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    entries.set(name, decode.decode(bytes.subarray(start, start + size)));
    offset = start + size;
  }
  return entries;
}

test("report export creates styled Unicode .xlsx with filters, totals and safe textual phone", () => {
  const bytes = buildStyledReportExcel({
    title: "Doanh thu và công nợ",
    headers: ["Tên khách", "Số điện thoại", "Tổng tiền (VNĐ)", "Ngày lập", "Ghi chú"],
    records: [
      ["Nguyễn Thị Ánh", "0901234567", "1200000", "2026-10-10", '=HYPERLINK("https://example.invalid")'],
      ["Trần Văn Đức", "0351234567", "800000", "2026-10-11", "Đã thanh toán"]
    ],
    fromDate: "2026-10-01",
    toDate: "2026-10-31",
    propertyName: "Nhà trọ Hà Nội",
    createdAt: new Date("2026-10-12T01:00:00.000Z")
  });
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  const entries = readStoredEntries(bytes);
  assert.equal(entries.size, 7);
  const styles = entries.get("xl/styles.xml") ?? "";
  const overview = entries.get("xl/worksheets/sheet1.xml") ?? "";
  const detail = entries.get("xl/worksheets/sheet2.xml") ?? "";
  assert.match(styles, /<name val="Arial"/);
  assert.match(styles, /₫/);
  assert.match(overview, /Nhà trọ Hà Nội/);
  assert.match(detail, /Nguyễn Thị Ánh/);
  assert.match(detail, /0901234567/);
  assert.match(detail, /<autoFilter ref="A5:E7"/);
  assert.match(detail, /state="frozen"/);
  assert.match(detail, /SUM\(C6:C7\)/);
  assert.match(detail, /HYPERLINK/);
  assert.equal(detail.includes("<f>HYPERLINK"), false, "Untrusted CSV text cannot become formulas");
});
