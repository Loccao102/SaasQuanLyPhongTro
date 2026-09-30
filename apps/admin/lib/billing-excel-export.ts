import * as XLSX from "xlsx";
import type { RenterBillingDetailResponse } from "./renter-billing-api";

function formatStatusVi(status: "UNPAID" | "PARTIALLY_PAID" | "PAID") {
  if (status === "PAID") return "ĐÃ THANH TOÁN";
  if (status === "PARTIALLY_PAID") return "THANH TOÁN MỘT PHẦN";
  return "CHƯA THANH TOÁN";
}

export function exportBillingCycleToExcel(detail: RenterBillingDetailResponse) {
  const { cycle, invoices, organization } = detail;

  const wb = XLSX.utils.book_new();

  // 1. Data rows for BANG_KE_THU_TIEN
  const rows: Array<Array<string | number>> = [];

  // Title rows
  rows.push([`BẢNG KÊ CHI TIẾT THU TIỀN PHÒNG & DỊCH VỤ - KỲ ${cycle.code}`]);
  rows.push([
    `Cơ sở: ${cycle.property.name} (${cycle.property.code})`,
    `Tổ chức: ${organization.name}`,
    `Kỳ chốt: ${cycle.periodStart} đến ${cycle.periodEnd}`,
    `Hạn thanh toán: ${cycle.dueDate}`
  ]);
  rows.push([]); // blank line

  // Column Headers
  rows.push([
    "STT",
    "Phòng",
    "Khách thuê",
    "Mã HĐ",
    "Tiền phòng (đ)",
    "Tiêu thụ điện",
    "Tiền điện (đ)",
    "Tiêu thụ nước",
    "Tiền nước (đ)",
    "Dịch vụ khác (đ)",
    "Nợ cũ kỳ trước (đ)",
    "Điều chỉnh (đ)",
    "TỔNG CỘNG (đ)",
    "ĐÃ THU (đ)",
    "CÒN NỢ (đ)",
    "TRẠNG THÁI"
  ]);

  let totalRent = 0;
  let totalElectricity = 0;
  let totalWater = 0;
  let totalOtherServices = 0;
  let totalPreviousDebt = 0;
  let totalAdjustment = 0;
  let totalInvoiceVnd = 0;
  let totalPaidVnd = 0;
  let totalRemainingVnd = 0;

  invoices.forEach((inv, index) => {
    let rentVnd = 0;
    let electricityVnd = 0;
    let electricityUsage = "";
    let waterVnd = 0;
    let waterUsage = "";
    let otherServicesVnd = 0;
    let previousDebtVnd = 0;

    for (const line of inv.lines) {
      const type = line.type.toUpperCase();
      if (type === "RENT") {
        rentVnd += line.amountVnd;
      } else if (type.startsWith("ELECTRICITY")) {
        electricityVnd += line.amountVnd;
        if (line.quantity && Number(line.quantity) > 0) {
          electricityUsage = `${line.quantity} kWh`;
        } else if (type === "ELECTRICITY_PER_PERSON") {
          electricityUsage = `${line.quantity} người`;
        } else if (type === "ELECTRICITY_PER_ROOM") {
          electricityUsage = "Khoán phòng";
        }
      } else if (type.startsWith("WATER")) {
        waterVnd += line.amountVnd;
        if (line.quantity && Number(line.quantity) > 0) {
          waterUsage = `${line.quantity} m³`;
        } else if (type === "WATER_PER_PERSON") {
          waterUsage = `${line.quantity} người`;
        } else if (type === "WATER_PER_ROOM") {
          waterUsage = "Khoán phòng";
        }
      } else if (type === "PREVIOUS_DEBT") {
        previousDebtVnd += line.amountVnd;
      } else if (type !== "ADJUSTMENT") {
        otherServicesVnd += line.amountVnd;
      }
    }

    // Accumulate sums
    totalRent += rentVnd;
    totalElectricity += electricityVnd;
    totalWater += waterVnd;
    totalOtherServices += otherServicesVnd;
    totalPreviousDebt += previousDebtVnd;
    totalAdjustment += inv.adjustmentVnd;
    totalInvoiceVnd += inv.totalVnd;
    totalPaidVnd += inv.paidVnd;
    totalRemainingVnd += inv.remainingVnd;

    rows.push([
      index + 1,
      inv.room.code,
      inv.primaryResidentName || "—",
      inv.number,
      rentVnd,
      electricityUsage || "0",
      electricityVnd,
      waterUsage || "0",
      waterVnd,
      otherServicesVnd,
      previousDebtVnd,
      inv.adjustmentVnd,
      inv.totalVnd,
      inv.paidVnd,
      inv.remainingVnd,
      formatStatusVi(inv.collectionStatus)
    ]);
  });

  // Summary Row
  rows.push([
    "TỔNG CỘNG",
    `${invoices.length} phòng`,
    "",
    "",
    totalRent,
    "",
    totalElectricity,
    "",
    totalWater,
    totalOtherServices,
    totalPreviousDebt,
    totalAdjustment,
    totalInvoiceVnd,
    totalPaidVnd,
    totalRemainingVnd,
    ""
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column width config
  ws["!cols"] = [
    { wch: 6 },  // STT
    { wch: 12 }, // Phòng
    { wch: 22 }, // Khách thuê
    { wch: 18 }, // Mã HĐ
    { wch: 15 }, // Tiền phòng
    { wch: 15 }, // Tiêu thụ điện
    { wch: 15 }, // Tiền điện
    { wch: 15 }, // Tiêu thụ nước
    { wch: 15 }, // Tiền nước
    { wch: 16 }, // Dịch vụ khác
    { wch: 16 }, // Nợ cũ
    { wch: 14 }, // Điều chỉnh
    { wch: 18 }, // Tổng cộng
    { wch: 16 }, // Đã thu
    { wch: 16 }, // Còn nợ
    { wch: 20 }  // Trạng thái
  ];

  XLSX.utils.book_append_sheet(wb, ws, "BANG_KE_THU_TIEN");

  // 2. Sheet TONG_QUAN_KY
  const paidCount = invoices.filter((i) => i.collectionStatus === "PAID").length;
  const partialCount = invoices.filter((i) => i.collectionStatus === "PARTIALLY_PAID").length;
  const unpaidCount = invoices.filter((i) => i.collectionStatus === "UNPAID").length;
  const collectionRate = totalInvoiceVnd > 0 ? ((totalPaidVnd / totalInvoiceVnd) * 100).toFixed(1) : "0";

  const overviewRows = [
    ["BÁO CÁO TỔNG QUAN KỲ HÓA ĐƠN", ""],
    ["Mã kỳ", cycle.code],
    ["Cơ sở / Tòa nhà", `${cycle.property.name} (${cycle.property.code})`],
    ["Tổ chức", organization.name],
    ["Kỳ chốt số liệu", `${cycle.periodStart} đến ${cycle.periodEnd}`],
    ["Hạn thanh toán", cycle.dueDate],
    ["Trạng thái kỳ", cycle.status],
    ["", ""],
    ["CHỈ SỐ THU TIỀN", "GIÁ TRỊ"],
    ["Tổng số phòng lập hóa đơn", invoices.length],
    ["Số phòng đã thanh toán đủ", paidCount],
    ["Số phòng thanh toán một phần", partialCount],
    ["Số phòng chưa thanh toán", unpaidCount],
    ["", ""],
    ["TÀI CHÍNH KỲ (VND)", "SỐ TIỀN"],
    ["Tổng tiền phòng", totalRent],
    ["Tổng tiền điện", totalElectricity],
    ["Tổng tiền nước", totalWater],
    ["Tổng phí dịch vụ khác", totalOtherServices],
    ["Tổng nợ cũ kỳ trước dồn sang", totalPreviousDebt],
    ["Tổng điều chỉnh / giảm trừ", totalAdjustment],
    ["TỔNG PHẢI THU KỲ NÀY", totalInvoiceVnd],
    ["TỔNG ĐÃ THU", totalPaidVnd],
    ["TỔNG CÔNG NỢ CÒN LẠI", totalRemainingVnd],
    ["TỶ LỆ THU HỒI CÔNG NỢ", `${collectionRate}%`]
  ];

  const wsOverview = XLSX.utils.aoa_to_sheet(overviewRows);
  wsOverview["!cols"] = [{ wch: 30 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsOverview, "TONG_QUAN_KY");

  // Generate file name & trigger download
  const cleanCode = cycle.code.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `Bang_Ke_Thu_Tien_${cleanCode}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
