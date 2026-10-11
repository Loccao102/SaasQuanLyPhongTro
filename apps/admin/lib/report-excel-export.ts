/**
 * Small dependency-free OOXML writer for polished report workbooks.
 * ZIP entries use method STORE (widely supported by Excel / LibreOffice).
 * The CSV parser lives in reporting-api.ts; all text is written as literal
 * inline strings (never user-provided formulas).
 */

export type ReportExcelValue = string | number | null | undefined;

type Cell = { value: ReportExcelValue; style?: number; formula?: string };
type Sheet = {
  name: string;
  rows: Cell[][];
  merges?: string[];
  widths?: number[];
  freezeRows?: number;
  autoFilter?: string;
};

const encoder = new TextEncoder();
const xmlEsc = (value: string) => value
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

function columnName(index: number): string {
  let result = "";
  for (let x = index + 1; x > 0; x = Math.floor((x - 1) / 26)) {
    result = String.fromCharCode(65 + ((x - 1) % 26)) + result;
  }
  return result;
}

const cell = (value: ReportExcelValue, style = 0, formula?: string): Cell => ({
  value, style, formula
});
const blank = (): Cell => cell("");
const pad = (value: Cell[], count: number) =>
  [...value, ...Array.from({ length: Math.max(0, count - value.length) }, blank)];

const moneyHeader = /(?:vnd|vnđ|đồng|doanh thu|chi phí|lợi nhuận|công nợ|đã thu|còn nợ|thành tiền|số tiền|tiền|tổng thu|tổng chi|giá|amount|revenue|expense|income|debt|balance|paid|total_vnd|net_)/i;
const dateHeader = /(?:^ngày|ngày |date|_at$|^kỳ|period_|thời gian|timestamp)/i;
const preserveTextHeader = /(?:sđt|điện thoại|phone|mã |code|^id$|_id$|số phòng|room_code|hóa đơn|invoice_number|tài khoản|bank|reference)/i;

function numericValue(value: string): number | null {
  const normalized = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && Math.abs(parsed) < 1e15 ? parsed : null;
}

function excelDate(value: string): number | null {
  let parts: RegExpMatchArray | null = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  let year: number, month: number, day: number;
  if (parts) {
    year = Number(parts[1]); month = Number(parts[2]); day = Number(parts[3]);
  } else {
    parts = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!parts) return null;
    day = Number(parts[1]); month = Number(parts[2]); year = Number(parts[3]);
  }
  const epoch = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(epoch);
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 ||
      roundTrip.getUTCDate() !== day || year < 1900 || year > 9999) return null;
  return epoch / 86400000 + 25569;
}

function dataCell(header: string, source: ReportExcelValue, alternate: boolean): Cell {
  const raw = source === undefined || source === null ? "" : String(source).trim();
  const stripe = alternate ? 1 : 0;
  if (!raw) return cell("", stripe ? 5 : 4);
  if (preserveTextHeader.test(header)) return cell(raw, stripe ? 5 : 4);
  if (dateHeader.test(header)) {
    const serial = excelDate(raw);
    if (serial !== null) return cell(serial, stripe ? 9 : 8);
  }
  const number = numericValue(raw);
  if (number !== null) {
    return cell(number, moneyHeader.test(header)
      ? (stripe ? 7 : 6) : (stripe ? 16 : 15));
  }
  return cell(raw, stripe ? 5 : 4);
}

function sheetXml(sheet: Sheet): string {
  const maxColumns = Math.max(1, ...sheet.rows.map(row => row.length));
  const end = columnName(maxColumns - 1) + String(sheet.rows.length || 1);
  const columns = (sheet.widths ?? []).map((width, i) =>
    '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' +
    Math.max(10, Math.min(45, width)) + '" customWidth="1"/>'
  ).join("");
  const rows = sheet.rows.map((items, ri) => {
    const cells = items.map((item, ci) => {
      if (item.value === "" && !item.formula && (item.style ?? 0) === 0) return "";
      const reference = columnName(ci) + String(ri + 1);
      const style = ' s="' + (item.style ?? 0) + '"';
      if (item.formula) {
        return '<c r="' + reference + '"' + style + '><f>' +
          xmlEsc(item.formula) + '</f><v>0</v></c>';
      }
      if (typeof item.value === "number" && Number.isFinite(item.value)) {
        return '<c r="' + reference + '"' + style + '><v>' + item.value + '</v></c>';
      }
      return '<c r="' + reference + '"' + style + ' t="inlineStr"><is><t xml:space="preserve">' +
        xmlEsc(String(item.value ?? "")) + '</t></is></c>';
    }).join("");
    const height = ri === 0 ? 35 : ri === 4 && sheet.freezeRows ? 28 : 22;
    return '<row r="' + (ri + 1) + '" ht="' + height + '" customHeight="1">' + cells + '</row>';
  }).join("");

  const merged = sheet.merges?.length
    ? '<mergeCells count="' + sheet.merges.length + '">' +
      sheet.merges.map(ref => '<mergeCell ref="' + ref + '"/>').join("") + '</mergeCells>'
    : "";
  const panes = sheet.freezeRows
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + sheet.freezeRows +
      '" topLeftCell="A' + (sheet.freezeRows + 1) +
      '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<dimension ref="A1:' + end + '"/>' +
    panes + '<sheetFormatPr defaultRowHeight="22"/><cols>' + columns + '</cols>' +
    '<sheetData>' + rows + '</sheetData>' +
    merged + (sheet.autoFilter ? '<autoFilter ref="' + sheet.autoFilter + '"/>' : "") +
    '<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.25" footer="0.25"/>' +
    '</worksheet>';
}

const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="3">' +
    '<numFmt numFmtId="164" formatCode="#,##0 &quot;₫&quot;"/>' +
    '<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>' +
    '<numFmt numFmtId="166" formatCode="#,##0.##"/>' +
  '</numFmts>' +
  '<fonts count="6">' +
    '<font><sz val="11"/><name val="Arial"/><family val="2"/><color rgb="FF253248"/></font>' +
    '<font><b/><sz val="18"/><name val="Arial"/><color rgb="FFFFFFFF"/></font>' +
    '<font><sz val="10"/><name val="Arial"/><color rgb="FF64748B"/></font>' +
    '<font><b/><sz val="11"/><name val="Arial"/><color rgb="FFFFFFFF"/></font>' +
    '<font><b/><sz val="11"/><name val="Arial"/><color rgb="FF0F3C57"/></font>' +
    '<font><b/><sz val="15"/><name val="Arial"/><color rgb="FF008C95"/></font>' +
  '</fonts>' +
  '<fills count="6">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF142A43"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F6FA"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF007D87"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left/><right/><top/><bottom style="hair"><color rgb="FFE2E8F0"/></bottom><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="17">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="3" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFill="1"/>' +
    '<xf numFmtId="164" fontId="4" fillId="4" borderId="1" xfId="0" applyFill="1" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="166" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function spreadsheetFiles(sheets: Sheet[]): Array<{ path: string; bytes: Uint8Array }> {
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' + sheets.map((s, i) => '<sheet name="' + xmlEsc(s.name) +
    '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join("") +
    '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' +
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet' +
    '" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join("") +
    '<Relationship Id="rId' + (sheets.length + 1) + '" Type="' +
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles' +
    '" Target="styles.xml"/></Relationships>';
  const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
      '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") +
    '</Types>';
  const files = [
    { path: "[Content_Types].xml", data: types },
    { path: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { path: "xl/workbook.xml", data: workbook },
    { path: "xl/_rels/workbook.xml.rels", data: rels },
    { path: "xl/styles.xml", data: stylesXml },
    ...sheets.map((sheet, i) => ({ path: "xl/worksheets/sheet" + (i + 1) + ".xml", data: sheetXml(sheet) }))
  ];
  return files.map(f => ({ path: f.path, bytes: encoder.encode(f.data) }));
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** ZIP archive with uncompressed entries; avoids additional runtime dependencies. */
function zip(files: Array<{ path: string; bytes: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  const u16 = (view: DataView, pos: number, value: number) => view.setUint16(pos, value, true);
  const u32 = (view: DataView, pos: number, value: number) => view.setUint32(pos, value >>> 0, true);
  for (const file of files) {
    const filename = encoder.encode(file.path);
    const len = file.bytes.length;
    const checksum = crc32(file.bytes);
    const local = new Uint8Array(30 + filename.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x0800);
    u16(lv, 8, 0); u32(lv, 14, checksum); u32(lv, 18, len); u32(lv, 22, len);
    u16(lv, 26, filename.length); local.set(filename, 30);
    parts.push(local, file.bytes);
    const central = new Uint8Array(46 + filename.length);
    const cv = new DataView(central.buffer);
    u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20);
    u16(cv, 8, 0x0800); u16(cv, 10, 0);
    u32(cv, 16, checksum); u32(cv, 20, len); u32(cv, 24, len);
    u16(cv, 28, filename.length); u32(cv, 42, offset);
    central.set(filename, 46);
    directory.push(central);
    offset += local.length + len;
  }
  const centralSize = directory.reduce((sum, v) => sum + v.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50); u16(ev, 8, files.length);
  u16(ev, 10, files.length); u32(ev, 12, centralSize); u32(ev, 16, offset);
  const all = [...parts, ...directory, end];
  const archive = new Uint8Array(all.reduce((sum, v) => sum + v.length, 0));
  let index = 0;
  for (const part of all) { archive.set(part, index); index += part.length; }
  return archive;
}

export function buildStyledReportExcel(input: {
  title: string;
  headers: string[];
  records: ReportExcelValue[][];
  fromDate?: string;
  toDate?: string;
  propertyName?: string;
  createdAt?: Date;
}): Uint8Array {
  const headers = input.headers.length ? input.headers : ["Thông tin"];
  const records = input.records;
  const createdAt = input.createdAt ?? new Date();
  const reportDate = createdAt.toLocaleString("vi-VN");
  const period = [input.fromDate?.slice(0, 10), input.toDate?.slice(0, 10)].filter(Boolean).join(" — ") || "Toàn bộ thời gian";
  const summaryWidth = 8;
  const summary: Cell[][] = [
    pad([cell("HABI  |  " + input.title.toLocaleUpperCase("vi"), 1)], summaryWidth),
    pad([cell("", 1)], summaryWidth),
    pad([cell("BÁO CÁO QUẢN TRỊ  •  Xuất dữ liệu Excel", 2)], summaryWidth),
    pad([], summaryWidth),
    pad([cell("KỲ BÁO CÁO", 12), cell(period, 4)], summaryWidth),
    pad([cell("CƠ SỞ", 12), cell(input.propertyName || "Tất cả cơ sở", 4)], summaryWidth),
    pad([cell("THỜI ĐIỂM XUẤT", 12), cell(reportDate, 4)], summaryWidth),
    pad([], summaryWidth),
    pad([cell("TÓM TẮT DỮ LIỆU", 3)], summaryWidth),
    pad([], summaryWidth),
    pad([cell("Tổng số bản ghi", 12), cell(records.length, 13)], summaryWidth),
    pad([cell("Số cột dữ liệu", 12), cell(headers.length, 13)], summaryWidth),
    pad([], summaryWidth),
    pad([cell("Tất cả các cột và nội dung tiếng Việt dùng font Arial, mã Unicode.", 14)], summaryWidth),
    pad([cell("Mở tab CHI TIẾT để lọc dữ liệu; số điện thoại/mã định danh được giữ nguyên dạng văn bản.", 14)], summaryWidth)
  ];
  const overview: Sheet = {
    name: "TỔNG QUAN", rows: summary,
    widths: [25, 21, 17, 17, 17, 17, 17, 17],
    merges: ["A1:H2", "A3:H3", "B5:H5", "B6:H6", "B7:H7", "A9:H9",
      "B11:H11", "B12:H12", "A14:H14", "A15:H15"]
  };

  const cols = headers.length;
  const endColumn = columnName(cols - 1);
  const table: Cell[][] = [
    pad([cell(input.title.toLocaleUpperCase("vi-VN"), 1)], cols),
    pad([cell("HABI · BÁO CÁO DỮ LIỆU", 2)], cols),
    pad([cell("Kỳ: " + period + "   |   Cơ sở: " + (input.propertyName || "Tất cả cơ sở") +
      "   |   Xuất lúc: " + reportDate, 2)], cols),
    pad([], cols),
    headers.map(h => cell(h, 3))
  ];
  const monetaryColumns = headers.map((h, i) => moneyHeader.test(h) && !preserveTextHeader.test(h) ? i : -1).filter(i => i >= 0);
  for (let i = 0; i < records.length; i++) {
    table.push(headers.map((h, j) => dataCell(h, records[i]?.[j], i % 2 === 1)));
  }
  if (!records.length) {
    table.push(pad([cell("Không có dữ liệu trong kỳ báo cáo", 14)], cols));
  } else if (monetaryColumns.length) {
    const totalRow = headers.map((_, j) => monetaryColumns.includes(j)
      ? cell(0, 11, "SUM(" + columnName(j) + "6:" + columnName(j) + (records.length + 5) + ")")
      : cell(j === 0 ? "TỔNG CỘNG" : "", 10));
    table.push(totalRow);
  }
  const widths = headers.map((header, i) => {
    let best = Math.min(35, header.length * 1.25 + 3);
    for (const record of records.slice(0, 120)) {
      best = Math.max(best, Math.min(39, String(record?.[i] ?? "").length + 3));
    }
    return Math.min(42, Math.max(15, Math.round(best)));
  });
  const detail: Sheet = {
    name: "CHI TIẾT", rows: table, freezeRows: 5,
    merges: cols > 1 ? ["A1:" + endColumn + "1", "A2:" + endColumn + "2", "A3:" + endColumn + "3"] : [],
    widths, autoFilter: "A5:" + endColumn + (records.length + 5)
  };
  return zip(spreadsheetFiles([overview, detail]));
}
