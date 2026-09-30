import * as XLSX from "xlsx";

export interface TemporaryResidenceRecord {
  fullName: string;
  dateOfBirth: string | null;
  idNumber: string | null;
  phone: string | null;
  propertyName: string;
  propertyAddress: string;
  roomCode: string;
  partyRole: string;
  joinedOn: string;
  plannedEndDate: string | null;
  leaseCode: string;
  notes: string | null;
}

export function translatePartyRole(role: string): string {
  switch (role) {
    case "PRIMARY_TENANT":
      return "Chủ hợp đồng";
    case "CO_TENANT":
      return "Đồng thuê";
    case "OCCUPANT":
      return "Người ở cùng";
    default:
      return role || "Cư dân";
  }
}

export function generateResidenceDeclarationExcel(
  records: TemporaryResidenceRecord[],
  organizationName: string
): Buffer {
  const wb = XLSX.utils.book_new();

  const titleRows = [
    ["DANH SÁCH CƯ DÂN KHAI BÁO TẠM TRÚ"],
    ["(Theo mẫu khai báo Cổng Dịch vụ công Quản lý Cư trú / Công an phường xã)"],
    [`Đơn vị / Chủ cơ sở: ${organizationName}`],
    [`Thời điểm xuất: ${new Date().toLocaleString("vi-VN")}`],
    [] // Empty line
  ];

  const headers = [
    "STT",
    "Họ và tên cư dân",
    "Ngày sinh (DD/MM/YYYY)",
    "Số CCCD / Mã định danh",
    "Số điện thoại liên hệ",
    "Tòa nhà / Nhà trọ",
    "Số phòng",
    "Địa chỉ cơ sở lưu trú",
    "Quan hệ / Vai trò",
    "Ngày bắt đầu tạm trú",
    "Ngày kết thúc dự kiến",
    "Mã hợp đồng thuê",
    "Ghi chú"
  ];

  const dataRows = records.map((rec, index) => [
    index + 1,
    rec.fullName.toUpperCase(),
    rec.dateOfBirth ? formatDateVi(rec.dateOfBirth) : "",
    rec.idNumber || "",
    rec.phone || "",
    rec.propertyName,
    rec.roomCode,
    rec.propertyAddress,
    translatePartyRole(rec.partyRole),
    formatDateVi(rec.joinedOn),
    rec.plannedEndDate ? formatDateVi(rec.plannedEndDate) : "Không thời hạn",
    rec.leaseCode,
    rec.notes || ""
  ]);

  const allRows = [...titleRows, headers, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(allRows);

  // Set column widths
  ws["!cols"] = [
    { wch: 6 },  // STT
    { wch: 25 }, // Ho va ten
    { wch: 16 }, // Ngay sinh
    { wch: 22 }, // CCCD
    { wch: 16 }, // Phone
    { wch: 22 }, // Toa nha
    { wch: 10 }, // So phong
    { wch: 35 }, // Dia chi
    { wch: 18 }, // Vai tro
    { wch: 15 }, // Bat dau
    { wch: 18 }, // Ket thuc
    { wch: 16 }, // Ma hop dong
    { wch: 25 }  // Ghi chu
  ];

  XLSX.utils.book_append_sheet(wb, ws, "KHAI_BAO_TAM_TRU");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function formatDateVi(dateStr: string): string {
  try {
    const parts = dateStr.slice(0, 10).split("-");
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}
