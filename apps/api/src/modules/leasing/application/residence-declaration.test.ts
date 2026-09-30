import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  generateResidenceDeclarationExcel,
  translatePartyRole,
  type TemporaryResidenceRecord
} from "./residence-declaration.helper.js";

test("residence declaration: translates party roles to friendly Vietnamese terms", () => {
  assert.equal(translatePartyRole("PRIMARY_TENANT"), "Chủ hợp đồng");
  assert.equal(translatePartyRole("CO_TENANT"), "Đồng thuê");
  assert.equal(translatePartyRole("OCCUPANT"), "Người ở cùng");
  assert.equal(translatePartyRole("GUEST"), "GUEST");
});

test("residence declaration: generates valid Excel workbook buffer with required police columns", () => {
  const records: TemporaryResidenceRecord[] = [
    {
      fullName: "Nguyễn Văn An",
      dateOfBirth: "1998-05-15",
      idNumber: "001098012345",
      phone: "0912345678",
      propertyName: "Nhà Trọ Habi Cầu Giấy",
      propertyAddress: "Số 10 Ngõ 123 Cầu Giấy, Phường Dịch Vọng, Quận Cầu Giấy, Hà Nội",
      roomCode: "P.201",
      partyRole: "PRIMARY_TENANT",
      joinedOn: "2026-01-01",
      plannedEndDate: "2026-12-31",
      leaseCode: "HD-2026-001",
      notes: "Tạm trú dài hạn"
    },
    {
      fullName: "Trần Thị Bích",
      dateOfBirth: "2000-08-20",
      idNumber: "001200054321",
      phone: "0987654321",
      propertyName: "Nhà Trọ Habi Cầu Giấy",
      propertyAddress: "Số 10 Ngõ 123 Cầu Giấy, Phường Dịch Vọng, Quận Cầu Giấy, Hà Nội",
      roomCode: "P.201",
      partyRole: "OCCUPANT",
      joinedOn: "2026-01-01",
      plannedEndDate: "2026-12-31",
      leaseCode: "HD-2026-001",
      notes: null
    }
  ];

  const buffer = generateResidenceDeclarationExcel(records, "Công Ty TNHH Quản Lý BĐS Habi");
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 500);

  // Parse back with XLSX to verify sheet structure
  const wb = XLSX.read(buffer, { type: "buffer" });
  assert.ok(wb.SheetNames.includes("KHAI_BAO_TAM_TRU"));

  const ws = wb.Sheets["KHAI_BAO_TAM_TRU"];
  assert.ok(ws);

  const jsonRows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
  // Title rows + header row + 2 data rows
  assert.ok(jsonRows.length >= 7);

  // Check header row contains required police fields
  const headerRow = jsonRows[5] ?? [];
  assert.ok(headerRow.includes("Họ và tên cư dân"));
  assert.ok(headerRow.includes("Số CCCD / Mã định danh"));
  assert.ok(headerRow.includes("Số điện thoại liên hệ"));
  assert.ok(headerRow.includes("Địa chỉ cơ sở lưu trú"));

  // Check first resident row
  const firstDataRow = jsonRows[6] ?? [];
  assert.equal(firstDataRow[1], "NGUYỄN VĂN AN");
  assert.equal(firstDataRow[2], "15/05/1998");
  assert.equal(firstDataRow[3], "001098012345");
  assert.equal(firstDataRow[8], "Chủ hợp đồng");
});
