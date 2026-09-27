"use client";

import { useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import {
  FileExcelOutlined,
  DownloadOutlined,
  InboxOutlined,
  CheckCircleOutlined,
  CheckCircleFilled,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CloseOutlined,
  ApartmentOutlined,
  AppstoreOutlined,
  ToolOutlined,
  EnvironmentOutlined
} from "@ant-design/icons";
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
        style={{
          maxWidth: "760px",
          width: "95%",
          maxHeight: "90vh",
          overflowY: "auto",
          borderRadius: "14px",
          padding: "24px"
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            paddingBottom: "16px",
            borderBottom: "1px solid #e2e8f0",
            marginBottom: "20px"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "10px",
                background: "#f0fdf4",
                color: "#16a34a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "20px",
                border: "1px solid #bbf7d0"
              }}
            >
              <FileExcelOutlined />
            </div>
            <div>
              <h3 className="modal-title" style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>
                Nhập cơ sở, phòng & tài sản từ Excel
              </h3>
              <p style={{ margin: "2px 0 0", color: "#64748b", fontSize: "13px" }}>
                Import đồng bộ toàn bộ nhà trọ, danh sách tầng, danh mục phòng và trang thiết bị
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "16px",
              cursor: "pointer",
              color: "#64748b",
              padding: "4px"
            }}
            title="Đóng"
          >
            <CloseOutlined />
          </button>
        </div>

        {errorMessage ? (
          <div className="admin-state admin-state--error" style={{ marginBottom: "18px" }}>
            <CloseCircleOutlined style={{ marginRight: "6px" }} />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        {/* STEP 1: SELECT FILE & DOWNLOAD TEMPLATE */}
        {step === "SELECT" && (
          <div style={{ display: "grid", gap: "20px" }}>
            {/* Template Card */}
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "16px 20px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "14px"
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <FileExcelOutlined style={{ color: "#0284c7" }} />
                  <strong style={{ fontSize: "14px", color: "#1e293b" }}>File mẫu chuẩn hệ thống</strong>
                </div>
                <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>
                  File mẫu gồm 4 Sheet chuẩn hóa: Thông tin cơ sở, Danh sách tầng, Danh sách phòng và Trang thiết bị nội thất.
                </p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={handleDownloadTemplate}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "13px",
                  fontWeight: 600,
                  whiteSpace: "nowrap"
                }}
              >
                <DownloadOutlined /> Tải file mẫu (.xlsx)
              </button>
            </div>

            {/* Upload Zone */}
            <div
              style={{
                border: "2px dashed #cbd5e1",
                borderRadius: "12px",
                padding: "40px 24px",
                textAlign: "center",
                background: "#fafafa",
                cursor: "pointer",
                position: "relative",
                transition: "border-color 0.2s ease"
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
              <InboxOutlined style={{ fontSize: "42px", color: "#0284c7", marginBottom: "12px" }} />
              <h4 style={{ margin: "0 0 6px", fontSize: "15px", fontWeight: 650, color: "#1e293b" }}>
                Kéo thả file Excel vào đây hoặc bấm để chọn tệp
              </h4>
              <p style={{ margin: 0, color: "#64748b", fontSize: "13px" }}>
                Định dạng hỗ trợ: Microsoft Excel (.xlsx, .xls) hoặc CSV. Hệ thống hỗ trợ xử lý 1 cơ sở / lần import.
              </p>
            </div>
          </div>
        )}

        {/* STEP 2: VALIDATING SPINNER */}
        {step === "VALIDATING" && (
          <div style={{ textAlign: "center", padding: "50px 20px" }}>
            <LoadingOutlined style={{ fontSize: "36px", color: "#0284c7", marginBottom: "16px" }} />
            <h4 style={{ margin: "0 0 6px", fontSize: "16px", fontWeight: 600 }}>Đang kiểm tra dữ liệu file...</h4>
            <span style={{ color: "#64748b", fontSize: "13px" }}>
              Hệ thống đang rà soát cấu trúc cột, đối chiếu mã tầng/phòng và xác thực địa bàn hành chính.
            </span>
          </div>
        )}

        {/* STEP 3: PREVIEW DRY-RUN REPORT */}
        {step === "PREVIEW" && report && (
          <div style={{ display: "grid", gap: "18px" }}>
            {/* Status Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                borderRadius: "8px",
                background: report.isValid ? "#f0fdf4" : "#fef2f2",
                border: report.isValid ? "1px solid #bbf7d0" : "1px solid #fecaca"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {report.isValid ? (
                  <CheckCircleFilled style={{ color: "#16a34a", fontSize: "18px" }} />
                ) : (
                  <CloseCircleOutlined style={{ color: "#dc2626", fontSize: "18px" }} />
                )}
                <strong style={{ fontSize: "14px", color: report.isValid ? "#166534" : "#991b1b" }}>
                  {report.isValid ? "Dữ liệu hợp lệ — Sẵn sàng nhập vào hệ thống" : "Phát hiện lỗi — Vui lòng sửa lại file Excel"}
                </strong>
              </div>
              <span style={{ fontSize: "12px", color: "#64748b" }}>Tệp: {fileName}</span>
            </div>

            {/* Property Overview Card */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "16px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.02)"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "12px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <span
                      style={{
                        background: "#e0f2fe",
                        color: "#0369a1",
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: "4px"
                      }}
                    >
                      MÃ: {report.summary.propertyCode || "CHƯA_CÓ_MÃ"}
                    </span>
                    <span
                      style={{
                        background: "#f1f5f9",
                        color: "#475569",
                        fontSize: "11px",
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: "4px"
                      }}
                    >
                      {report.summary.propertyType === "BOARDING_HOUSE"
                        ? "Nhà trọ"
                        : report.summary.propertyType === "MINI_APARTMENT"
                        ? "Chung cư mini"
                        : report.summary.propertyType === "APARTMENT"
                        ? "Căn hộ"
                        : "Khác"}
                    </span>
                  </div>
                  <h4 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                    {report.summary.propertyName || "Chưa đặt tên cơ sở"}
                  </h4>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#475569", fontSize: "13px" }}>
                <EnvironmentOutlined style={{ color: "#0284c7" }} />
                <span>{report.summary.locationText}</span>
              </div>
            </div>

            {/* Metrics Scale Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px"
                }}
              >
                <div style={{ fontSize: "22px", color: "#0284c7" }}>
                  <ApartmentOutlined />
                </div>
                <div>
                  <small style={{ color: "#64748b", fontSize: "11px", display: "block" }}>TỔNG SỐ TẦNG</small>
                  <strong style={{ fontSize: "18px", color: "#0f172a" }}>{report.summary.floorCount}</strong>
                </div>
              </div>

              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px"
                }}
              >
                <div style={{ fontSize: "22px", color: "#0284c7" }}>
                  <AppstoreOutlined />
                </div>
                <div>
                  <small style={{ color: "#64748b", fontSize: "11px", display: "block" }}>TỔNG SỐ PHÒNG</small>
                  <strong style={{ fontSize: "18px", color: "#0f172a" }}>{report.summary.roomCount}</strong>
                </div>
              </div>

              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px"
                }}
              >
                <div style={{ fontSize: "22px", color: "#16a34a" }}>
                  <ToolOutlined />
                </div>
                <div>
                  <small style={{ color: "#64748b", fontSize: "11px", display: "block" }}>TÀI SẢN / NỘI THẤT</small>
                  <strong style={{ fontSize: "18px", color: "#16a34a" }}>{report.summary.equipmentCount}</strong>
                </div>
              </div>
            </div>

            {/* Error Table if invalid */}
            {report.errors.length > 0 && (
              <div
                style={{
                  border: "1px solid #fecaca",
                  borderRadius: "8px",
                  overflow: "hidden",
                  background: "#fff"
                }}
              >
                <div
                  style={{
                    padding: "10px 14px",
                    background: "#fef2f2",
                    borderBottom: "1px solid #fecaca",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px"
                  }}
                >
                  <CloseCircleOutlined style={{ color: "#dc2626" }} />
                  <strong style={{ color: "#991b1b", fontSize: "13px" }}>
                    Chi tiết lỗi phát hiện ({report.errors.length} lỗi)
                  </strong>
                </div>
                <div style={{ maxHeight: "180px", overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                        <th style={{ padding: "8px 12px", textAlign: "left", width: "120px" }}>Phần</th>
                        <th style={{ padding: "8px 12px", textAlign: "left", width: "80px" }}>Dòng</th>
                        <th style={{ padding: "8px 12px", textAlign: "left", width: "100px" }}>Mã</th>
                        <th style={{ padding: "8px 12px", textAlign: "left" }}>Nội dung lỗi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.errors.map((err, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "8px 12px", fontWeight: 600, color: "#64748b" }}>{err.section}</td>
                          <td style={{ padding: "8px 12px", color: "#64748b" }}>{err.row ? `Dòng ${err.row}` : "-"}</td>
                          <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#dc2626" }}>{err.itemCode || "-"}</td>
                          <td style={{ padding: "8px 12px", color: "#991b1b" }}>{err.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Warnings Alert */}
            {report.warnings.length > 0 && (
              <div
                style={{
                  padding: "10px 14px",
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "#92400e"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                  <ExclamationCircleOutlined />
                  <strong>Lưu ý ({report.warnings.length}):</strong>
                </div>
                <ul style={{ margin: 0, paddingLeft: "20px" }}>
                  {report.warnings.map((warn, idx) => (
                    <li key={idx}>{warn}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Action Bar */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                paddingTop: "14px",
                borderTop: "1px solid #e2e8f0"
              }}
            >
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setStep("SELECT");
                  setParsedPayload(null);
                  setReport(null);
                }}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px" }}
              >
                <ArrowLeftOutlined /> Chọn file khác
              </button>

              <button
                type="button"
                className="primary-button"
                disabled={!report.isValid}
                onClick={handleExecuteImport}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "13px",
                  fontWeight: 600,
                  minWidth: "160px"
                }}
              >
                <CheckCircleOutlined /> Xác nhận nhập dữ liệu
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: IMPORTING PROGRESS */}
        {step === "IMPORTING" && (
          <div style={{ textAlign: "center", padding: "50px 20px" }}>
            <LoadingOutlined style={{ fontSize: "36px", color: "#0284c7", marginBottom: "16px" }} />
            <h4 style={{ margin: "0 0 6px", fontSize: "16px", fontWeight: 600 }}>Đang lưu dữ liệu vào hệ thống...</h4>
            <span style={{ color: "#64748b", fontSize: "13px" }}>
              Toàn bộ cơ sở, tầng, phòng và tài sản đang được tạo an toàn trong một giao dịch cơ sở dữ liệu.
            </span>
          </div>
        )}

        {/* STEP 5: SUCCESS RECEIPT */}
        {step === "SUCCESS" && successInfo && (
          <div style={{ textAlign: "center", padding: "24px 16px" }}>
            <CheckCircleFilled style={{ fontSize: "48px", color: "#16a34a", marginBottom: "14px" }} />
            <h3 style={{ margin: "0 0 6px", fontSize: "18px", fontWeight: 700, color: "#0f172a" }}>
              Nhập dữ liệu thành công
            </h3>
            <p style={{ margin: "0 0 20px", color: "#64748b", fontSize: "13px" }}>
              Cơ sở <strong>{successInfo.propertyName}</strong> đã sẵn sàng để quản lý số điện nước và lập hợp đồng thuê.
            </p>

            <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  onSuccess(successInfo.propertyId);
                  onClose();
                }}
                style={{ fontSize: "13px" }}
              >
                Đóng
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  onSuccess(successInfo.propertyId);
                  window.location.assign(`/assets/properties/${successInfo.propertyId}`);
                }}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px" }}
              >
                Xem chi tiết cơ sở <ArrowRightOutlined />
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
