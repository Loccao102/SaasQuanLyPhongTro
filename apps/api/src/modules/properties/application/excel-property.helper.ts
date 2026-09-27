import * as XLSX from "xlsx";

export type PropertyImportPayload = {
  property: {
    code: string;
    name: string;
    propertyType: "BOARDING_HOUSE" | "MINI_APARTMENT" | "APARTMENT" | "OTHER";
    addressText?: string;
    provinceName?: string;
    districtName?: string;
    wardName?: string;
  };
  floors: Array<{
    code: string;
    name: string;
    sortOrder?: number;
  }>;
  rooms: Array<{
    floorCode?: string;
    code: string;
    name: string;
    sortOrder?: number;
  }>;
  equipments: Array<{
    roomCode: string;
    name: string;
    brand?: string;
    modelOrSerial?: string;
    quantity?: number;
    conditionStatus?: "EXCELLENT" | "GOOD" | "FAIR" | "DAMAGED" | "NEEDS_REPAIR";
    compensationValueVnd?: number;
    note?: string;
  }>;
};

export function normalizePropertyType(
  raw?: string
): "BOARDING_HOUSE" | "MINI_APARTMENT" | "APARTMENT" | "OTHER" {
  if (!raw) return "BOARDING_HOUSE";
  const val = raw.toLowerCase().trim();
  if (val.includes("mini") || val.includes("ccmn")) return "MINI_APARTMENT";
  if (val.includes("căn hộ") || val.includes("can ho") || val.includes("apartment")) {
    return "APARTMENT";
  }
  if (val.includes("khác") || val.includes("other")) return "OTHER";
  return "BOARDING_HOUSE";
}

export function normalizeConditionStatus(
  raw?: string
): "EXCELLENT" | "GOOD" | "FAIR" | "DAMAGED" | "NEEDS_REPAIR" {
  if (!raw) return "GOOD";
  const val = raw.toLowerCase().trim();
  if (val.includes("hoàn hảo") || val.includes("mới") || val.includes("excellent")) {
    return "EXCELLENT";
  }
  if (val.includes("khá") || val.includes("fair")) return "FAIR";
  if (val.includes("hỏng") || val.includes("damaged")) return "DAMAGED";
  if (val.includes("sửa") || val.includes("repair")) return "NEEDS_REPAIR";
  return "GOOD";
}

export function generatePropertyImportTemplateWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();

  // Sheet 1: THONG_TIN_CO_SO
  const wsPropertyData = [
    [
      "Mã cơ sở (*)",
      "Tên cơ sở (*)",
      "Loại hình (*)",
      "Tỉnh / Thành phố (*)",
      "Quận / Huyện (*)",
      "Phường / Xã (*)",
      "Địa chỉ chi tiết"
    ],
    [
      "HM-01",
      "Nhà trọ Hoàng Mai 1",
      "Nhà trọ",
      "Hà Nội",
      "Quận Hoàng Mai",
      "Phường Tương Mai",
      "Số 279 Hoàng Mai"
    ]
  ];
  const wsProperty = XLSX.utils.aoa_to_sheet(wsPropertyData);
  XLSX.utils.book_append_sheet(wb, wsProperty, "THONG_TIN_CO_SO");

  // Sheet 2: DANH_SACH_TANG
  const wsFloorsData = [
    ["Mã tầng (*)", "Tên tầng (*)", "Thứ tự"],
    ["T1", "Tầng 1", 1],
    ["T2", "Tầng 2", 2],
    ["T3", "Tầng 3", 3]
  ];
  const wsFloors = XLSX.utils.aoa_to_sheet(wsFloorsData);
  XLSX.utils.book_append_sheet(wb, wsFloors, "DANH_SACH_TANG");

  // Sheet 3: DANH_SACH_PHONG
  const wsRoomsData = [
    ["Mã phòng (*)", "Tên phòng (*)", "Mã tầng", "Thứ tự"],
    ["101", "Phòng 101", "T1", 1],
    ["102", "Phòng 102", "T1", 2],
    ["201", "Phòng 201", "T2", 3],
    ["202", "Phòng 202", "T2", 4],
    ["301", "Phòng 301", "T3", 5]
  ];
  const wsRooms = XLSX.utils.aoa_to_sheet(wsRoomsData);
  XLSX.utils.book_append_sheet(wb, wsRooms, "DANH_SACH_PHONG");

  // Sheet 4: TRANG_THIET_BI
  const wsEquipmentsData = [
    [
      "Mã phòng (*)",
      "Tên thiết bị (*)",
      "Thương hiệu",
      "Model / Seri",
      "Số lượng (*)",
      "Tình trạng ban đầu (*)",
      "Giá trị đền bù (VNĐ)",
      "Ghi chú"
    ],
    ["101", "Điều hòa", "Daikin", "FTKC25UAVMV", 1, "Tốt", 8000000, "Kèm remote"],
    ["101", "Bình nóng lạnh", "Ariston", "20L", 1, "Tốt", 2500000, ""],
    ["101", "Tủ lạnh", "Aqua", "130L", 1, "Tốt", 3000000, ""],
    ["102", "Điều hòa", "Panasonic", "Inverter", 1, "Hoàn hảo", 8500000, "Mới 100%"],
    ["102", "Bình nóng lạnh", "Ferroli", "15L", 1, "Tốt", 2200000, ""]
  ];
  const wsEquipments = XLSX.utils.aoa_to_sheet(wsEquipmentsData);
  XLSX.utils.book_append_sheet(wb, wsEquipments, "TRANG_THIET_BI");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

export function parsePropertyImportWorkbook(buffer: Buffer): PropertyImportPayload {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetNames = wb.SheetNames;

  // Check if multi-sheet
  const propertySheetName = sheetNames.find(
    (name) =>
      name.toUpperCase().includes("CO_SO") ||
      name.toUpperCase().includes("PROPERTY") ||
      name.toUpperCase().includes("THONG_TIN")
  );

  const floorSheetName = sheetNames.find(
    (name) =>
      name.toUpperCase().includes("TANG") ||
      name.toUpperCase().includes("FLOOR")
  );

  const roomSheetName = sheetNames.find(
    (name) =>
      name.toUpperCase().includes("PHONG") ||
      name.toUpperCase().includes("ROOM")
  );

  const equipmentSheetName = sheetNames.find(
    (name) =>
      name.toUpperCase().includes("THIET_BI") ||
      name.toUpperCase().includes("TAI_SAN") ||
      name.toUpperCase().includes("EQUIPMENT")
  );

  if (propertySheetName && (roomSheetName || floorSheetName)) {
    // Multi-sheet mode
    return parseMultiSheetWorkbook(wb, {
      propertySheetName,
      floorSheetName,
      roomSheetName,
      equipmentSheetName
    });
  }

  // Single sheet / Flat mode fallback
  const firstSheet = wb.Sheets[sheetNames[0] || "Sheet1"];
  if (!firstSheet) {
    throw new Error("File Excel không có sheet nào hợp lệ.");
  }
  return parseFlatSheet(firstSheet);
}

function parseMultiSheetWorkbook(
  wb: XLSX.WorkBook,
  sheets: {
    propertySheetName: string;
    floorSheetName?: string;
    roomSheetName?: string;
    equipmentSheetName?: string;
  }
): PropertyImportPayload {
  // 1. Property
  const propRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    wb.Sheets[sheets.propertySheetName]!,
    { defval: "" }
  );

  if (propRows.length === 0) {
    throw new Error("Sheet thông tin cơ sở chưa có dữ liệu.");
  }

  const pRow = propRows[0]!;
  const propertyCode = String(
    findField(pRow, ["mã cơ sở", "ma co so", "code", "property_code"]) ?? ""
  ).trim();
  const propertyName = String(
    findField(pRow, ["tên cơ sở", "ten co so", "name", "property_name"]) ?? ""
  ).trim();
  const propertyTypeRaw = String(
    findField(pRow, ["loại hình", "loai hinh", "type", "property_type"]) ?? ""
  );
  const provinceName = String(
    findField(pRow, ["tỉnh / thành phố", "tỉnh", "thành phố", "province", "city"]) ?? ""
  ).trim();
  const districtName = String(
    findField(pRow, ["quận / huyện", "quận", "huyện", "thị xã", "district"]) ?? ""
  ).trim();
  const wardName = String(
    findField(pRow, ["phường / xã", "phường", "xã", "thị trấn", "ward"]) ?? ""
  ).trim();
  const addressText = String(
    findField(pRow, ["địa chỉ chi tiết", "địa chỉ", "dia chi", "address"]) ?? ""
  ).trim();

  // 2. Floors
  const floors: PropertyImportPayload["floors"] = [];
  if (sheets.floorSheetName && wb.Sheets[sheets.floorSheetName]) {
    const floorRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets[sheets.floorSheetName]!,
      { defval: "" }
    );
    for (const r of floorRows) {
      const fCode = String(findField(r, ["mã tầng", "ma tang", "code", "floor_code"]) ?? "").trim();
      const fName = String(findField(r, ["tên tầng", "ten tang", "name", "floor_name"]) ?? "").trim();
      const sortOrder = Number(findField(r, ["thứ tự", "thu tu", "sort_order", "order"]) ?? 0);
      if (fCode) {
        floors.push({
          code: fCode,
          name: fName || fCode,
          sortOrder: isNaN(sortOrder) ? 0 : sortOrder
        });
      }
    }
  }

  // 3. Rooms
  const rooms: PropertyImportPayload["rooms"] = [];
  if (sheets.roomSheetName && wb.Sheets[sheets.roomSheetName]) {
    const roomRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets[sheets.roomSheetName]!,
      { defval: "" }
    );
    for (const r of roomRows) {
      const rCode = String(findField(r, ["mã phòng", "ma phong", "code", "room_code"]) ?? "").trim();
      const rName = String(findField(r, ["tên phòng", "ten phong", "name", "room_name"]) ?? "").trim();
      const floorCode = String(findField(r, ["mã tầng", "ma tang", "floor_code", "floor"]) ?? "").trim();
      const sortOrder = Number(findField(r, ["thứ tự", "thu tu", "sort_order", "order"]) ?? 0);
      if (rCode) {
        rooms.push({
          code: rCode,
          name: rName || rCode,
          floorCode: floorCode || undefined,
          sortOrder: isNaN(sortOrder) ? 0 : sortOrder
        });
      }
    }
  }

  // 4. Equipment
  const equipments: PropertyImportPayload["equipments"] = [];
  if (sheets.equipmentSheetName && wb.Sheets[sheets.equipmentSheetName]) {
    const eqRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets[sheets.equipmentSheetName]!,
      { defval: "" }
    );
    for (const r of eqRows) {
      const roomCode = String(findField(r, ["mã phòng", "ma phong", "room_code", "room"]) ?? "").trim();
      const eqName = String(findField(r, ["tên thiết bị", "ten thiet bi", "tên tài sản", "name"]) ?? "").trim();
      const brand = String(findField(r, ["thương hiệu", "hãng", "brand"]) ?? "").trim();
      const modelOrSerial = String(findField(r, ["model / seri", "model", "serial", "seri"]) ?? "").trim();
      const quantity = Math.max(1, Number(findField(r, ["số lượng", "so luong", "quantity", "qty"]) ?? 1) || 1);
      const conditionStatus = normalizeConditionStatus(
        String(findField(r, ["tình trạng ban đầu", "tình trạng", "status", "condition"]) ?? "")
      );
      const compensationValueVnd = Math.max(
        0,
        Number(findField(r, ["giá trị đền bù", "giá trị", "compensation", "value"]) ?? 0) || 0
      );
      const note = String(findField(r, ["ghi chú", "ghi chu", "note"]) ?? "").trim();

      if (roomCode && eqName) {
        equipments.push({
          roomCode,
          name: eqName,
          brand: brand || undefined,
          modelOrSerial: modelOrSerial || undefined,
          quantity,
          conditionStatus,
          compensationValueVnd,
          note: note || undefined
        });
      }
    }
  }

  return {
    property: {
      code: propertyCode,
      name: propertyName,
      propertyType: normalizePropertyType(propertyTypeRaw),
      addressText: addressText || undefined,
      provinceName: provinceName || undefined,
      districtName: districtName || undefined,
      wardName: wardName || undefined
    },
    floors,
    rooms,
    equipments
  };
}

function parseFlatSheet(sheet: XLSX.WorkSheet): PropertyImportPayload {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (rows.length === 0) {
    throw new Error("Trang tính không có dữ liệu.");
  }

  const firstRow = rows[0]!;
  const propertyCode = String(
    findField(firstRow, ["mã cơ sở", "ma co so", "code", "property_code"]) ?? "CS-01"
  ).trim();
  const propertyName = String(
    findField(firstRow, ["tên cơ sở", "ten co so", "name", "property_name"]) ?? "Cơ sở nhập từ Excel"
  ).trim();
  const propertyTypeRaw = String(
    findField(firstRow, ["loại hình", "loai hinh", "type", "property_type"]) ?? ""
  );
  const provinceName = String(
    findField(firstRow, ["tỉnh / thành phố", "tỉnh", "thành phố", "province", "city"]) ?? ""
  ).trim();
  const districtName = String(
    findField(firstRow, ["quận / huyện", "quận", "huyện", "district"]) ?? ""
  ).trim();
  const wardName = String(
    findField(firstRow, ["phường / xã", "phường", "xã", "ward"]) ?? ""
  ).trim();
  const addressText = String(
    findField(firstRow, ["địa chỉ chi tiết", "địa chỉ", "address"]) ?? ""
  ).trim();

  const floorMap = new Map<string, { code: string; name: string; sortOrder: number }>();
  const roomMap = new Map<string, { code: string; name: string; floorCode?: string; sortOrder: number }>();
  const equipments: PropertyImportPayload["equipments"] = [];

  let rSort = 1;
  let fSort = 1;

  for (const r of rows) {
    const fCode = String(findField(r, ["mã tầng", "ma tang", "floor_code", "floor"]) ?? "").trim();
    const fName = String(findField(r, ["tên tầng", "ten tang", "floor_name"]) ?? "").trim();
    if (fCode && !floorMap.has(fCode)) {
      floorMap.set(fCode, {
        code: fCode,
        name: fName || fCode,
        sortOrder: fSort++
      });
    }

    const rCode = String(findField(r, ["mã phòng", "ma phong", "room_code", "room"]) ?? "").trim();
    const rName = String(findField(r, ["tên phòng", "ten phong", "room_name"]) ?? "").trim();
    if (rCode && !roomMap.has(rCode)) {
      roomMap.set(rCode, {
        code: rCode,
        name: rName || rCode,
        floorCode: fCode || undefined,
        sortOrder: rSort++
      });
    }

    const eqName = String(findField(r, ["tên thiết bị", "ten thiet bi", "tên tài sản", "equipment"]) ?? "").trim();
    if (rCode && eqName) {
      equipments.push({
        roomCode: rCode,
        name: eqName,
        brand: String(findField(r, ["thương hiệu", "brand"]) ?? "").trim() || undefined,
        modelOrSerial: String(findField(r, ["model / seri", "serial"]) ?? "").trim() || undefined,
        quantity: Math.max(1, Number(findField(r, ["số lượng", "quantity"]) ?? 1) || 1),
        conditionStatus: normalizeConditionStatus(String(findField(r, ["tình trạng", "status"]) ?? "")),
        compensationValueVnd: Math.max(0, Number(findField(r, ["giá trị đền bù", "compensation"]) ?? 0) || 0),
        note: String(findField(r, ["ghi chú", "note"]) ?? "").trim() || undefined
      });
    }
  }

  return {
    property: {
      code: propertyCode,
      name: propertyName,
      propertyType: normalizePropertyType(propertyTypeRaw),
      addressText: addressText || undefined,
      provinceName: provinceName || undefined,
      districtName: districtName || undefined,
      wardName: wardName || undefined
    },
    floors: [...floorMap.values()],
    rooms: [...roomMap.values()],
    equipments
  };
}

function findField(row: Record<string, unknown>, aliases: string[]): unknown {
  const normalizedEntries = Object.entries(row).map(([k, v]) => [
    String(k)
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""),
    v
  ]);

  for (const alias of aliases) {
    const normAlias = alias
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    const found = normalizedEntries.find(([k]) => String(k).includes(normAlias));
    if (found && found[1] !== undefined && found[1] !== null && String(found[1]).trim() !== "") {
      return found[1];
    }
  }
  return undefined;
}
