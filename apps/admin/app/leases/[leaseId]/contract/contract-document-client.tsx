"use client";

import { useEffect, useState } from "react";
import { MoneyDisplay } from "@propops/ui";
import {
  adminLeasesApi,
  type LeaseDetailResponse
} from "../../../../lib/admin-leases-api";

function formatVnDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "…";
  const [year, month, day] = dateStr.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function pricingItemTypeLabel(type: string): string {
  switch (type) {
    case "ELECTRICITY_PER_KWH":
      return "Điện sinh hoạt";
    case "WATER_PER_M3":
      return "Nước sinh hoạt";
    case "INTERNET":
      return "Internet / Wifi";
    case "PARKING":
      return "Phí gửi xe";
    case "TRASH":
      return "Vệ sinh / Rác";
    case "CUSTOM":
      return "Dịch vụ khác";
    default:
      return type;
  }
}

function pricingItemUnit(type: string): string {
  switch (type) {
    case "ELECTRICITY_PER_KWH":
      return " / kWh";
    case "WATER_PER_M3":
      return " / m³";
    default:
      return " / tháng";
  }
}

export function ContractDocumentClient({ leaseId }: { leaseId: string }) {
  const [data, setData] = useState<LeaseDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await adminLeasesApi.detail(leaseId);
        if (active) setData(result);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Không thể tải văn bản hợp đồng."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [leaseId]);

  if (error) {
    return (
      <div style={{ padding: "40px", maxWidth: "800px", margin: "0 auto" }}>
        <p style={{ color: "red" }}>{error}</p>
        <a href={"/leases/" + leaseId} style={{ color: "#0066cc" }}>← Quay lại hợp đồng</a>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "#666" }}>
        Đang tải văn bản hợp đồng…
      </div>
    );
  }

  const { lease, organization, parties, pricingPolicy, deposit } = data;
  const primaryTenantParty = parties.find((p) => p.role === "PRIMARY_TENANT");
  const tenantName = primaryTenantParty?.fullName ?? lease.primaryResident?.fullName ?? "—";
  const tenantPhone = primaryTenantParty?.phone ?? lease.primaryResident?.phone ?? "—";
  const tenantEmail = primaryTenantParty?.email ?? "—";
  const coResidents = parties.filter((p) => p.role !== "PRIMARY_TENANT");

  return (
    <div className="contract-wrapper">
      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 20mm 15mm;
          }
          body {
            background: white !important;
            color: black !important;
          }
          .contract-no-print {
            display: none !important;
          }
          .contract-paper {
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
            max-width: 100% !important;
          }
        }
      `}</style>

      {/* Top action bar - Hidden when printing */}
      <div
        className="contract-no-print"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 24px",
          background: "#1f2937",
          color: "white",
          position: "sticky",
          top: 0,
          zIndex: 100
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <a
            href={"/leases/" + lease.id}
            style={{
              color: "#93c5fd",
              textDecoration: "none",
              fontSize: "13px",
              fontWeight: 600
            }}
          >
            ← Quay lại chi tiết
          </a>
          <span style={{ color: "#9ca3af" }}>|</span>
          <span style={{ fontSize: "14px", fontWeight: 700 }}>
            Hợp đồng {lease.code} · Phòng {lease.room.code}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            onClick={() => window.print()}
            style={{
              padding: "8px 16px",
              background: "#2563eb",
              color: "white",
              border: "none",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "13px",
              cursor: "pointer"
            }}
          >
            🖨️ In hợp đồng / Xuất PDF
          </button>
        </div>
      </div>

      {/* Printable contract document */}
      <div
        className="contract-paper"
        style={{
          maxWidth: "800px",
          margin: "32px auto",
          background: "white",
          padding: "48px 56px",
          borderRadius: "8px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
          fontFamily: "'Times New Roman', Times, serif",
          fontSize: "14.5px",
          lineHeight: "1.65",
          color: "#111827"
        }}
      >
        {/* National Header */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: "14px", textTransform: "uppercase" }}>
            CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
          </p>
          <p style={{ margin: "2px 0", fontWeight: 700, fontSize: "14px" }}>
            Độc lập – Tự do – Hạnh phúc
          </p>
          <p style={{ margin: "4px 0 0", letterSpacing: "2px" }}>───────o0o───────</p>
        </div>

        {/* Title */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <h1 style={{ margin: "0 0 6px", fontSize: "20px", fontWeight: 800, textTransform: "uppercase" }}>
            HỢP ĐỒNG THUÊ PHÒNG TRỌ / NHÀ Ở
          </h1>
          <p style={{ margin: 0, fontStyle: "italic", fontSize: "13px", color: "#4b5563" }}>
            Số: {lease.code}
          </p>
          <p style={{ margin: "4px 0 0", fontStyle: "italic", fontSize: "13px" }}>
            Hôm nay, ngày {new Date().getDate()} tháng {new Date().getMonth() + 1} năm {new Date().getFullYear()}, tại {lease.property.name}, chúng tôi gồm các bên dưới đây:
          </p>
        </div>

        {/* Party A */}
        <div style={{ marginBottom: "18px" }}>
          <p style={{ margin: "0 0 4px", fontWeight: 700, textTransform: "uppercase" }}>
            BÊN CHO THUÊ (BÊN A):
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", marginLeft: "12px" }}>
            <tbody>
              <tr>
                <td style={{ width: "200px", padding: "3px 0" }}>Đơn vị / Đại diện:</td>
                <td style={{ fontWeight: 700 }}>{organization.name}</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 0" }}>Cơ sở quản lý:</td>
                <td>{lease.property.name} ({lease.property.code})</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Party B */}
        <div style={{ marginBottom: "24px" }}>
          <p style={{ margin: "0 0 4px", fontWeight: 700, textTransform: "uppercase" }}>
            BÊN THUÊ (BÊN B):
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", marginLeft: "12px" }}>
            <tbody>
              <tr>
                <td style={{ width: "200px", padding: "3px 0" }}>Họ và tên người thuê chính:</td>
                <td style={{ fontWeight: 700 }}>{tenantName}</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 0" }}>Số điện thoại:</td>
                <td>{tenantPhone}</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 0" }}>Email liên hệ:</td>
                <td>{tenantEmail}</td>
              </tr>
              {coResidents.length > 0 ? (
                <tr>
                  <td style={{ padding: "3px 0", verticalAlign: "top" }}>Thành viên cùng ở:</td>
                  <td>
                    {coResidents.map((r, i) => (
                      <span key={r.residentId}>
                        {r.fullName} ({r.role === "CO_TENANT" ? "Đồng thuê" : "Người ở"})
                        {i < coResidents.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p style={{ fontStyle: "italic", marginBottom: "16px" }}>
          Hai bên cùng thỏa thuận và nhất trí ký kết hợp đồng thuê phòng với các điều khoản sau:
        </p>

        {/* Section 1 */}
        <div style={{ marginBottom: "18px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 6px" }}>
            ĐIỀU 1. ĐỐI TƯỢNG VÀ MỤC ĐÍCH THUÊ
          </h2>
          <p style={{ margin: "0 0 6px", textIndent: "20px" }}>
            1.1. Bên A đồng ý cho Bên B thuê phòng số <strong>{lease.room.code}</strong> ({lease.room.name}) thuộc cơ sở <strong>{lease.property.name}</strong>.
          </p>
          <p style={{ margin: 0, textIndent: "20px" }}>
            1.2. Mục đích thuê: Dùng để ở sinh hoạt. Bên B không được phép sử dụng phòng vào mục đích kinh doanh trái phép hoặc chuyển nhượng, cho thuê lại khi chưa có sự đồng ý bằng văn bản của Bên A.
          </p>
        </div>

        {/* Section 2 */}
        <div style={{ marginBottom: "18px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 6px" }}>
            ĐIỀU 2. THỜI HẠN THUÊ
          </h2>
          <p style={{ margin: "0 0 6px", textIndent: "20px" }}>
            2.1. Thời hạn thuê bắt đầu từ ngày <strong>{formatVnDate(lease.startDate)}</strong> đến ngày <strong>{formatVnDate(lease.plannedEndDate)}</strong>.
          </p>
          <p style={{ margin: 0, textIndent: "20px" }}>
            2.2. Khi hết hạn hợp đồng, nếu Bên B có nhu cầu tiếp tục thuê và Bên A đồng ý, hai bên sẽ tiến hành gia hạn thời hạn hợp đồng theo thỏa thuận.
          </p>
        </div>

        {/* Section 3 */}
        <div style={{ marginBottom: "18px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 6px" }}>
            ĐIỀU 3. GIÁ THUÊ, TIỀN CỌC VÀ KỲ HẠN THANH TOÁN
          </h2>
          <p style={{ margin: "0 0 6px", textIndent: "20px" }}>
            3.1. Giá tiền phòng: <strong><MoneyDisplay amountVnd={lease.baseRentVnd} /></strong> / tháng.
          </p>
          <p style={{ margin: "0 0 6px", textIndent: "20px" }}>
            3.2. Tiền đặt cọc: <strong><MoneyDisplay amountVnd={lease.depositRequiredVnd} /></strong> (Đã ghi nhận thu: <MoneyDisplay amountVnd={deposit.totalCollectedVnd} />). Số tiền cọc này dùng để bảo đảm thực hiện nghĩa vụ hợp đồng và sẽ được quyết toán, hoàn trả sau khi thanh lý hợp đồng và trừ các chi phí bồi thường hư hại hoặc nợ phí (nếu có).
          </p>
          <p style={{ margin: 0, textIndent: "20px" }}>
            3.3. Kỳ chốt tiền phòng & dịch vụ: Định kỳ vào ngày <strong>{lease.billingDay}</strong> hàng tháng. Bên B có trách nhiệm thanh toán đúng thời hạn quy định.
          </p>
        </div>

        {/* Section 4 */}
        <div style={{ marginBottom: "18px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 6px" }}>
            ĐIỀU 4. CHI PHÍ DỊCH VỤ VÀ TIỆN ÍCH
          </h2>
          <p style={{ margin: "0 0 6px", textIndent: "20px" }}>
            Các chi phí sử dụng dịch vụ được áp dụng theo biểu phí thực tế của cơ sở như sau:
          </p>
          {pricingPolicy && pricingPolicy.items.length > 0 ? (
            <table
              style={{
                width: "95%",
                margin: "8px auto",
                borderCollapse: "collapse",
                fontSize: "13.5px"
              }}
              border={1}
            >
              <thead>
                <tr style={{ background: "#f3f4f6" }}>
                  <th style={{ padding: "6px 10px", textAlign: "left" }}>Tên dịch vụ</th>
                  <th style={{ padding: "6px 10px", textAlign: "left" }}>Loại biểu phí</th>
                  <th style={{ padding: "6px 10px", textAlign: "right" }}>Đơn giá</th>
                </tr>
              </thead>
              <tbody>
                {pricingPolicy.items.map((item) => (
                  <tr key={item.id}>
                    <td style={{ padding: "6px 10px" }}>{item.description}</td>
                    <td style={{ padding: "6px 10px" }}>{pricingItemTypeLabel(item.itemType)}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>
                      <MoneyDisplay amountVnd={item.unitPriceVnd} />
                      {pricingItemUnit(item.itemType)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ margin: "0 0 6px", textIndent: "20px", fontStyle: "italic" }}>
              (Chi phí điện, nước và dịch vụ áp dụng theo chỉ số đo đếm thực tế và thỏa thuận giữa hai bên khi phát sinh hóa đơn).
            </p>
          )}
        </div>

        {/* Section 5 */}
        <div style={{ marginBottom: "28px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 6px" }}>
            ĐIỀU 5. QUYỀN VÀ TRÁCH NHIỆM CHUNG
          </h2>
          <p style={{ margin: "0 0 6px", textIndent: "20px" }}>
            5.1. Bên A có trách nhiệm bàn giao phòng theo đúng hiện trạng thỏa thuận, đảm bảo các tiện ích cơ bản hoạt động bình thường, và tôn trọng quyền riêng tư của Bên B.
          </p>
          <p style={{ margin: "0 0 6px", textIndent: "20px" }}>
            5.2. Bên B có trách nhiệm sử dụng phòng đúng mục đích, chấp hành nghiêm túc các quy định về an ninh trật tự, vệ sinh môi trường và phòng cháy chữa cháy (PCCC).
          </p>
          <p style={{ margin: 0, textIndent: "20px" }}>
            5.3. Hợp đồng này được lập thành 02 bản có giá trị pháp lý như nhau, mỗi bên giữ 01 bản để thực hiện.
          </p>
        </div>

        {/* Signatures */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "24px",
            textAlign: "center",
            marginTop: "36px",
            pageBreakInside: "avoid"
          }}
        >
          <div>
            <p style={{ margin: "0 0 4px", fontWeight: 700, textTransform: "uppercase" }}>
              ĐẠI DIỆN BÊN A
            </p>
            <p style={{ margin: 0, fontStyle: "italic", fontSize: "12px", color: "#6b7280" }}>
              (Ký và ghi rõ họ tên)
            </p>
            <div style={{ height: "70px" }} />
            <p style={{ margin: 0, fontWeight: 700 }}>{organization.name}</p>
          </div>
          <div>
            <p style={{ margin: "0 0 4px", fontWeight: 700, textTransform: "uppercase" }}>
              ĐẠI DIỆN BÊN B
            </p>
            <p style={{ margin: 0, fontStyle: "italic", fontSize: "12px", color: "#6b7280" }}>
              (Ký và ghi rõ họ tên)
            </p>
            <div style={{ height: "70px" }} />
            <p style={{ margin: 0, fontWeight: 700 }}>{tenantName}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
