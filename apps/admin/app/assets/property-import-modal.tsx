"use client";

import { useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import {
  adminAssetsApi,
  type PropertyImportPayload,
  type PropertyImportValidationReport
} from "../../lib/admin-assets-api";

export function PropertyImportModal({
  onClose,
  onSuccess
}: {
  onClose: () => void;
  onSuccess: (propertyId: string) => void;
}) {
  const [step, setStep] = useState<"SELECT" | "VALIDATING" | "PREVIEW" | "IMPORTING" | "SUCCESS">("SELECT");
  const [parsedPayload, setParsedPayload] = useState<PropertyImportPayload | null>(null);
  const [report, setReport] = useState<PropertyImportValidationReport | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ propertyId: string; propertyName: string } | null>(null);

  // 1. Download standard template
  function handleDownloadTemplate() {
    window.open("/api/admin/assets/import/template", "_blank");
  }

  // 2. File upload & client-side parse
  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setErrorMessage(null);
    setStep("VALIDATING");

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const payload = parseWorkbookClient(wb);
      setParsedPayload(payload);

      // Call dry-run validation API
      const valReport = await adminAssetsApi.validateImport(payload);
      setReport(valReport);
      setStep("PREVIEW");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Không thể đọc hoặc phân tích file Excel này."
      );
      setStep("SELECT");
    }
  }

  // 3. Confirm execution
  async function handleExecuteImport() {
    if (!parsedPayload) return;
    setStep("IMPORTING");
    setErrorMessage(null);

    try {
      const result = await adminAssetsApi.executeImport(parsedPayload);
      setSuccessInfo({
        propertyId: result.propertyId,
        propertyName: result.propertyName
      });
      setStep("SUCCESS");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Đã xảy ra lỗi khi lưu cơ sở vào cơ sở dữ liệu."
      );
      setStep("PREVIEW");
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "680px", width: "95%", maxHeight: "90vh", overflowY: "auto" }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <span className="eyebrow" style={{ margin: 0, fontWeight: 700, color: "var(--color-primary)" }}>
              EXCEL BATCH IMPORT
            </span>
            <h3 className="modal-title" style={{ margin: "2px 0 0", fontSize: "20px" }}>
              Import Nhà trọ · Tầng · Phòng · Tài sản
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#64748b" }}
          >
            ✕
          </button>
        </div>

        {errorMessage ? (
          <div className="admin-state admin-state--error" style={{ marginBottom: "16px" }}>
            <strong>Có lỗi xảy ra:</strong>
            <span>{errorMessage}</span>
          </div>
        ) : null}

        {/* STEP 1: SELECT FILE & DOWNLOAD TEMPLATE */}
        {step === "SELECT" && (
          <div>
            <div
              style={{
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: "10px",
                padding: "16px",
                marginBottom: "20px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "12px"
              }}
            >
              <div>
                <strong style={{ display: "block", color: "#166534", fontSize: "14px", marginBottom: "4px" }}>
                  Chưa có file mẫu Excel?
                </strong>
                <span style={{ fontSize: "13px", color: "#15803d" }}>
                  Tải file mẫu chuẩn gồm 4 Sheet: Cơ sở (gắn Quận/Huyện/Phường), Tầng, Phòng và Tài sản.
                </span>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={handleDownloadTemplate}
                style={{
                  background: "#ffffff",
                  borderColor: "#86efac",
                  color: "#166534",
                  fontWeight: 600,
                  whiteSpace: "nowrap"
                }}
              >
                📥 Tải file mẫu (.xlsx)
              </button>
            </div>

            {/* Upload Zone */}
            <div
              style={{
                border: "2px dashed #cbd5e1",
                borderRadius: "14px",
                padding: "36px 20px",
                textAlign: "center",
                background: "#f8fafc",
                cursor: "pointer",
                position: "relative"
              }}
            >
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                style={{
                  position: "absolute",
                  inset: 0,
                  opacity: 0,
                  cursor: "pointer",
                  width: "100%",
                  height: "100%"
                }}
              />
              <div style={{ fontSize: "44px", marginBottom: "10px" }}>📑</div>
              <h4 style={{ margin: "0 0 6px", fontSize: "16px" }}>Chọn hoặc Kéo thả file Excel vào đây</h4>
              <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "13px" }}>
                Hỗ trợ file Excel (.xlsx, .xls) hoặc CSV. Tối đa 1 cơ sở / lần import.
              </p>
            </div>
          </div>
        )}

        {/* STEP: VALIDATING SPINNER */}
        {step === "VALIDATING" && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ fontSize: "36px", marginBottom: "12px" }}>⏳</div>
            <h4 style={{ margin: "0 0 6px" }}>Đang kiểm tra dữ liệu file...</h4>
            <span style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
              Đang phân tích cấu trúc, kiểm tra trùng lặp mã và phân cấp địa bàn hành chính.
            </span>
          </div>
        )}

        {/* STEP: PREVIEW DRY-RUN REPORT */}
        {step === "PREVIEW" && report && (
          <div>
            {/* Summary Box */}
            <div
              style={{
                background: report.isValid ? "#f0f9ff" : "#fff7ed",
                border: report.isValid ? "1px solid #bae6fd" : "1px solid #fed7aa",
                borderRadius: "12px",
                padding: "16px",
                marginBottom: "18px"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <strong style={{ fontSize: "15px", color: report.isValid ? "#0369a1" : "#c2410c" }}>
                  {report.isValid ? "✔ Dữ liệu hợp lệ để import" : "⚠ Phát hiện lỗi cần xử lý"}
                </strong>
                <span style={{ fontSize: "12px", color: "#64748b" }}>Tệp: {fileName}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px", marginTop: "12px" }}>
                <div style={{ background: "white", padding: "10px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <small style={{ color: "#64748b", fontSize: "11px", display: "block" }}>CƠ SỞ</small>
                  <strong style={{ fontSize: "13px" }}>{report.summary.propertyName || "Chưa có tên"}</strong>
                  <span style={{ fontSize: "11px", color: "#0284c7", display: "block" }}>{report.summary.propertyCode}</span>
                </div>
                <div style={{ background: "white", padding: "10px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <small style={{ color: "#64748b", fontSize: "11px", display: "block" }}>ĐỊA BÀN QUẢN LÝ</small>
                  <strong style={{ fontSize: "12px", wordBreak: "break-word" }}>{report.summary.locationText}</strong>
                </div>
                <div style={{ background: "white", padding: "10px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <small style={{ color: "#64748b", fontSize: "11px", display: "block" }}>SỐ LƯỢNG TẦNG</small>
                  <strong style={{ fontSize: "16px", color: "#0f172a" }}>{report.summary.floorCount}</strong>
                </div>
                <div style={{ background: "white", padding: "10px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <small style={{ color: "#64748b", fontSize: "11px", display: "block" }}>SỐ LƯỢNG PHÒNG</small>
                  <strong style={{ fontSize: "16px", color: "#0f172a" }}>{report.summary.roomCount}</strong>
                </div>
                <div style={{ background: "white", padding: "10px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <small style={{ color: "#64748b", fontSize: "11px", display: "block" }}>TÀI SẢN / THIẾT BỊ</small>
                  <strong style={{ fontSize: "16px", color: "#16a34a" }}>{report.summary.equipmentCount}</strong>
                </div>
              </div>
            </div>

            {/* Error List */}
            {report.errors.length > 0 && (
              <div style={{ marginBottom: "16px" }}>
                <strong style={{ color: "#b91c1c", fontSize: "13px", display: "block", marginBottom: "6px" }}>
                  Danh sách lỗi chi tiết ({report.errors.length} lỗi):
                </strong>
                <ul
                  style={{
                    margin: 0,
                    padding: "10px 14px 10px 28px",
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "#991b1b",
                    maxHeight: "160px",
                    overflowY: "auto"
                  }}
                >
                  {report.errors.map((err, idx) => (
                    <li key={idx} style={{ marginBottom: "4px" }}>
                      <strong>[{err.section}{err.row ? ` Dòng ${err.row}` : ""}]</strong>: {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Warning List */}
            {report.warnings.length > 0 && (
              <div style={{ marginBottom: "16px" }}>
                <strong style={{ color: "#b45309", fontSize: "13px", display: "block", marginBottom: "6px" }}>
                  Cảnh báo ({report.warnings.length}):
                </strong>
                <ul
                  style={{
                    margin: 0,
                    padding: "10px 14px 10px 28px",
                    background: "#fffbeb",
                    border: "1px solid #fde68a",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "#92400e"
                  }}
                >
                  {report.warnings.map((warn, idx) => (
                    <li key={idx} style={{ marginBottom: "4px" }}>
                      {warn}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "24px" }}>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setStep("SELECT");
                  setParsedPayload(null);
                  setReport(null);
                }}
              >
                ← Chọn file khác
              </button>

              <button
                type="button"
                className="primary-button"
                disabled={!report.isValid}
                onClick={handleExecuteImport}
                style={{ minWidth: "180px" }}
              >
                🚀 Xác nhận Import
              </button>
            </div>
          </div>
        )}

        {/* STEP: IMPORTING PROGRESS */}
        {step === "IMPORTING" && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ fontSize: "36px", marginBottom: "12px" }}>⚙</div>
            <h4 style={{ margin: "0 0 6px" }}>Đang lưu cơ sở và tài sản...</h4>
            <span style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
              Hệ thống đang thực hiện giao dịch an toàn để tạo cơ sở, phân tầng, phòng và tài sản.
            </span>
          </div>
        )}

        {/* STEP: SUCCESS */}
        {step === "SUCCESS" && successInfo && (
          <div style={{ textAlign: "center", padding: "30px 20px" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>🎉</div>
            <h3 style={{ margin: "0 0 8px", color: "#16a34a" }}>Import thành công!</h3>
            <p style={{ margin: "0 0 24px", color: "#475569", fontSize: "14px" }}>
              Cơ sở <strong>{successInfo.propertyName}</strong> cùng toàn bộ các tầng, phòng và trang thiết bị đã được lưu thành công.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  onSuccess(successInfo.propertyId);
                  window.location.assign(`/assets/properties/${successInfo.propertyId}`);
                }}
              >
                Xem chi tiết cơ sở ngay →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Client-side parser helper
function parseWorkbookClient(wb: XLSX.WorkBook): PropertyImportPayload {
  const sheetNames = wb.SheetNames;

  const propSheet = sheetNames.find(
    (n) => n.toUpperCase().includes("CO_SO") || n.toUpperCase().includes("PROPERTY") || n.toUpperCase().includes("THONG_TIN")
  );
  const floorSheet = sheetNames.find((n) => n.toUpperCase().includes("TANG") || n.toUpperCase().includes("FLOOR"));
  const roomSheet = sheetNames.find((n) => n.toUpperCase().includes("PHONG") || n.toUpperCase().includes("ROOM"));
  const eqSheet = sheetNames.find(
    (n) => n.toUpperCase().includes("THIET_BI") || n.toUpperCase().includes("TAI_SAN") || n.toUpperCase().includes("EQUIPMENT")
  );

  if (propSheet && (roomSheet || floorSheet)) {
    // Multi-sheet mode
    const pRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[propSheet]!, { defval: "" });
    if (pRows.length === 0) throw new Error("Sheet thông tin cơ sở chưa có dữ liệu.");
    const p = pRows[0]!;

    const floors: PropertyImportPayload["floors"] = [];
    if (floorSheet && wb.Sheets[floorSheet]) {
      const fRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[floorSheet]!, { defval: "" });
      for (const r of fRows) {
        const code = String(findField(r, ["mã tầng", "ma tang", "code"]) ?? "").trim();
        const name = String(findField(r, ["tên tầng", "ten tang", "name"]) ?? "").trim();
        const sortOrder = Number(findField(r, ["thứ tự", "thu tu", "order"]) ?? 0);
        if (code) floors.push({ code, name: name || code, sortOrder: isNaN(sortOrder) ? 0 : sortOrder });
      }
    }

    const rooms: PropertyImportPayload["rooms"] = [];
    if (roomSheet && wb.Sheets[roomSheet]) {
      const rRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[roomSheet]!, { defval: "" });
      for (const r of rRows) {
        const code = String(findField(r, ["mã phòng", "ma phong", "code"]) ?? "").trim();
        const name = String(findField(r, ["tên phòng", "ten phong", "name"]) ?? "").trim();
        const floorCode = String(findField(r, ["mã tầng", "ma tang", "floor"]) ?? "").trim();
        const sortOrder = Number(findField(r, ["thứ tự", "thu tu", "order"]) ?? 0);
        if (code) rooms.push({ code, name: name || code, floorCode: floorCode || undefined, sortOrder: isNaN(sortOrder) ? 0 : sortOrder });
      }
    }

    const equipments: PropertyImportPayload["equipments"] = [];
    if (eqSheet && wb.Sheets[eqSheet]) {
      const eqRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[eqSheet]!, { defval: "" });
      for (const r of eqRows) {
        const roomCode = String(findField(r, ["mã phòng", "ma phong", "room"]) ?? "").trim();
        const name = String(findField(r, ["tên thiết bị", "ten thiet bi", "tên tài sản", "name"]) ?? "").trim();
        const brand = String(findField(r, ["thương hiệu", "brand"]) ?? "").trim();
        const modelOrSerial = String(findField(r, ["model / seri", "model", "serial"]) ?? "").trim();
        const quantity = Math.max(1, Number(findField(r, ["số lượng", "so luong", "quantity"]) ?? 1) || 1);
        const conditionStatus = normalizeCondition(String(findField(r, ["tình trạng", "status"]) ?? ""));
        const compensationValueVnd = Math.max(0, Number(findField(r, ["giá trị đền bù", "giá trị", "value"]) ?? 0) || 0);
        const note = String(findField(r, ["ghi chú", "ghi chu", "note"]) ?? "").trim();
        if (roomCode && name) {
          equipments.push({
            roomCode,
            name,
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
        code: String(findField(p, ["mã cơ sở", "ma co so", "code"]) ?? "").trim(),
        name: String(findField(p, ["tên cơ sở", "ten co so", "name"]) ?? "").trim(),
        propertyType: normalizeType(String(findField(p, ["loại hình", "type"]) ?? "")),
        provinceName: String(findField(p, ["tỉnh / thành phố", "tỉnh", "thành phố", "city"]) ?? "").trim() || undefined,
        districtName: String(findField(p, ["quận / huyện", "quận", "huyện", "district"]) ?? "").trim() || undefined,
        wardName: String(findField(p, ["phường / xã", "phường", "xã", "ward"]) ?? "").trim() || undefined,
        addressText: String(findField(p, ["địa chỉ chi tiết", "địa chỉ", "address"]) ?? "").trim() || undefined
      },
      floors,
      rooms,
      equipments
    };
  }

  // Flat mode fallback
  const firstSheet = wb.Sheets[sheetNames[0] || "Sheet1"];
  if (!firstSheet) throw new Error("File Excel không có sheet nào hợp lệ.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
  if (rows.length === 0) throw new Error("Trang tính không có dữ liệu.");

  const f0 = rows[0]!;
  const floorMap = new Map<string, { code: string; name: string; sortOrder: number }>();
  const roomMap = new Map<string, { code: string; name: string; floorCode?: string; sortOrder: number }>();
  const equipments: PropertyImportPayload["equipments"] = [];

  let fIdx = 1;
  let rIdx = 1;

  for (const r of rows) {
    const fCode = String(findField(r, ["mã tầng", "ma tang", "floor"]) ?? "").trim();
    const fName = String(findField(r, ["tên tầng", "ten tang"]) ?? "").trim();
    if (fCode && !floorMap.has(fCode)) {
      floorMap.set(fCode, { code: fCode, name: fName || fCode, sortOrder: fIdx++ });
    }

    const rCode = String(findField(r, ["mã phòng", "ma phong", "room"]) ?? "").trim();
    const rName = String(findField(r, ["tên phòng", "ten phong"]) ?? "").trim();
    if (rCode && !roomMap.has(rCode)) {
      roomMap.set(rCode, { code: rCode, name: rName || rCode, floorCode: fCode || undefined, sortOrder: rIdx++ });
    }

    const eqName = String(findField(r, ["tên thiết bị", "tên tài sản", "equipment"]) ?? "").trim();
    if (rCode && eqName) {
      equipments.push({
        roomCode: rCode,
        name: eqName,
        brand: String(findField(r, ["thương hiệu", "brand"]) ?? "").trim() || undefined,
        modelOrSerial: String(findField(r, ["model", "serial"]) ?? "").trim() || undefined,
        quantity: Math.max(1, Number(findField(r, ["số lượng", "quantity"]) ?? 1) || 1),
        conditionStatus: normalizeCondition(String(findField(r, ["tình trạng", "status"]) ?? "")),
        compensationValueVnd: Math.max(0, Number(findField(r, ["giá trị", "value"]) ?? 0) || 0),
        note: String(findField(r, ["ghi chú", "note"]) ?? "").trim() || undefined
      });
    }
  }

  return {
    property: {
      code: String(findField(f0, ["mã cơ sở", "ma co so", "code"]) ?? "CS-01").trim(),
      name: String(findField(f0, ["tên cơ sở", "ten co so", "name"]) ?? "Cơ sở nhập từ Excel").trim(),
      propertyType: normalizeType(String(findField(f0, ["loại hình", "type"]) ?? "")),
      provinceName: String(findField(f0, ["tỉnh / thành phố", "tỉnh", "thành phố", "city"]) ?? "").trim() || undefined,
      districtName: String(findField(f0, ["quận / huyện", "quận", "huyện", "district"]) ?? "").trim() || undefined,
      wardName: String(findField(f0, ["phường / xã", "phường", "xã", "ward"]) ?? "").trim() || undefined,
      addressText: String(findField(f0, ["địa chỉ chi tiết", "địa chỉ", "address"]) ?? "").trim() || undefined
    },
    floors: [...floorMap.values()],
    rooms: [...roomMap.values()],
    equipments
  };
}

function normalizeType(raw?: string): "BOARDING_HOUSE" | "MINI_APARTMENT" | "APARTMENT" | "OTHER" {
  if (!raw) return "BOARDING_HOUSE";
  const val = raw.toLowerCase().trim();
  if (val.includes("mini") || val.includes("ccmn")) return "MINI_APARTMENT";
  if (val.includes("căn hộ") || val.includes("apartment")) return "APARTMENT";
  if (val.includes("khác") || val.includes("other")) return "OTHER";
  return "BOARDING_HOUSE";
}

function normalizeCondition(raw?: string): "EXCELLENT" | "GOOD" | "FAIR" | "DAMAGED" | "NEEDS_REPAIR" {
  if (!raw) return "GOOD";
  const val = raw.toLowerCase().trim();
  if (val.includes("hoàn hảo") || val.includes("mới") || val.includes("excellent")) return "EXCELLENT";
  if (val.includes("khá") || val.includes("fair")) return "FAIR";
  if (val.includes("hỏng") || val.includes("damaged")) return "DAMAGED";
  if (val.includes("sửa") || val.includes("repair")) return "NEEDS_REPAIR";
  return "GOOD";
}

function findField(row: Record<string, unknown>, aliases: string[]): unknown {
  const entries = Object.entries(row).map(([k, v]) => [
    String(k)
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""),
    v
  ]);

  for (const alias of aliases) {
    const norm = alias
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const found = entries.find(([k]) => String(k).includes(norm));
    if (found && found[1] !== undefined && found[1] !== null && String(found[1]).trim() !== "") {
      return found[1];
    }
  }
  return undefined;
}
