"use client";

import { useEffect, useState } from "react";
import { ArrowLeftOutlined, PrinterOutlined } from "@ant-design/icons";
import {
  adminLeasesApi,
  type LeaseDepositSummary,
  type LeaseDetailResponse
} from "../../../../lib/admin-leases-api";
import {
  adminAssetsApi,
  type RoomEquipment
} from "../../../../lib/admin-assets-api";

function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
}

function formatDateVi(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const [year, month, day] = dateStr.split("-");
  if (!year || !month || !day) return dateStr;
  return `${day}/${month}/${year}`;
}

const DEFAULT_INVENTORY_ITEMS = [
  { name: "Điều hòa nhiệt độ (Máy lạnh)", quantity: 1, condition: "Hoạt động tốt, có điều khiển" },
  { name: "Bình nóng lạnh", quantity: 1, condition: "Hoạt động tốt" },
  { name: "Giường ngủ & Nệm", quantity: 1, condition: "Nguyên vẹn, sạch sẽ" },
  { name: "Tủ quần áo", quantity: 1, condition: "Cửa trượt/mở tốt, có khóa" },
  { name: "Quạt treo tường / quạt trần", quantity: 1, condition: "Chạy êm, hoạt động tốt" },
  { name: "Thiết bị vệ sinh (Lavabo, bồn cầu, vòi sen)", quantity: 1, condition: "Không rò rỉ, thoát nước tốt" },
  { name: "Chìa khóa phòng & Thẻ từ ra vào", quantity: 2, condition: "Đầy đủ bộ dự phòng" }
];

export function LeasePrintClient({ leaseId }: { leaseId: string }) {
  const [data, setData] = useState<LeaseDetailResponse | null>(null);
  const [deposit, setDeposit] = useState<LeaseDepositSummary | null>(null);
  const [equipments, setEquipments] = useState<RoomEquipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printScope, setPrintScope] = useState<"ALL" | "CONTRACT_ONLY" | "APPENDIX_ONLY">("ALL");

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [detailData, depositData] = await Promise.all([
          adminLeasesApi.detail(leaseId),
          adminLeasesApi.deposit(leaseId)
        ]);

        let eqData: RoomEquipment[] = [];
        try {
          eqData = await adminAssetsApi.roomEquipment(detailData.lease.room.id);
        } catch {
          // fallback if room equipment not configured
        }

        if (active) {
          setData(detailData);
          setDeposit(depositData);
          setEquipments(eqData);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Không thể tải dữ liệu hợp đồng để in."
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

  if (loading) {
    return (
      <div className="contract-print-page">
        <div className="admin-state">Đang tải hợp đồng và biên bản bàn giao…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="contract-print-page">
        <div className="contract-toolbar">
          <a className="secondary-link-button" href={`/leases/${leaseId}`}>
            <ArrowLeftOutlined aria-hidden="true" /> Quay lại hợp đồng
          </a>
        </div>
        <div className="admin-state admin-state--error">
          <strong>Lỗi tải hợp đồng.</strong>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  const { lease, organization, parties } = data;
  const otherParties = parties.filter(
    (p) => p.role !== "PRIMARY_TENANT" && !p.leftOn
  );

  return (
    <div className="contract-print-page">
      <div className="contract-toolbar">
        <a className="secondary-link-button" href={`/leases/${lease.id}`}>
          <ArrowLeftOutlined aria-hidden="true" /> Quay lại hợp đồng {lease.code}
        </a>

        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
            <span>Nội dung in:</span>
            <select
              value={printScope}
              onChange={(e) => setPrintScope(e.target.value as "ALL" | "CONTRACT_ONLY" | "APPENDIX_ONLY")}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid var(--color-border)",
                background: "white",
                fontSize: "13px",
                fontWeight: 600
              }}
            >
              <option value="ALL">In cả Hợp đồng & Phụ lục bàn giao</option>
              <option value="CONTRACT_ONLY">Chỉ in Hợp đồng thuê</option>
              <option value="APPENDIX_ONLY">Chỉ in Biên bản bàn giao tài sản</option>
            </select>
          </div>

          <button
            className="primary-button"
            type="button"
            onClick={() => window.print()}
          >
            <PrinterOutlined style={{ marginRight: 6 }} /> In tài liệu (Ctrl + P)
          </button>
        </div>
      </div>

      {/* SECTION 1: HỢP ĐỒNG THUÊ PHÒNG */}
      {(printScope === "ALL" || printScope === "CONTRACT_ONLY") && (
        <main className="contract-paper">
          <header className="contract-header">
            <h2>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</h2>
            <p className="motto">Độc lập - Tự do - Hạnh phúc</p>
            <div className="divider" />
          </header>

          <section className="contract-title">
            <h1>HỢP ĐỒNG THUÊ PHÒNG TRỌ / NHÀ Ở</h1>
            <span>Số: {lease.code}</span>
          </section>

          <div className="contract-meta">
            Hôm nay, ngày {new Date().getDate()} tháng {new Date().getMonth() + 1} năm {new Date().getFullYear()}, tại cơ sở {lease.property.name}.
          </div>

          <section className="contract-section">
            <h3>BÊN CHO THUÊ (BÊN A)</h3>
            <div className="contract-party">
              <p><strong>Đơn vị quản lý / Đại diện Bên A:</strong> {organization.name}</p>
              <p><strong>Cơ sở / Tòa nhà:</strong> {lease.property.name} (Mã cơ sở: {lease.property.code})</p>
              <p><strong>Địa chỉ cơ sở:</strong> {lease.property.name}</p>
            </div>

            <h3>BÊN THUÊ (BÊN B)</h3>
            <div className="contract-party">
              <p><strong>Họ và tên người thuê chính:</strong> {lease.primaryResident?.fullName ?? "—"}</p>
              <p><strong>Số điện thoại:</strong> {lease.primaryResident?.phone ?? "Chưa cung cấp"}</p>
              <p><strong>Số CCCD/CMND:</strong> .................................................... <strong>Ngày cấp:</strong> .................... <strong>Nơi cấp:</strong> ....................................</p>
              <p><strong>Hộ khẩu thường trú:</strong> ................................................................................................................................................</p>
              {otherParties.length > 0 ? (
                <p>
                  <strong>Thành viên cùng ở ({otherParties.length}):</strong>{" "}
                  {otherParties
                    .map(
                      (p) =>
                        `${p.fullName} (${p.role === "CO_TENANT" ? "Đồng thuê" : "Người ở"}${p.phone ? " - SĐT: " + p.phone : ""})`
                    )
                    .join("; ")}
                </p>
              ) : null}
            </div>
          </section>

          <p>Hai bên cùng tự nguyện thỏa thuận và thống nhất ký kết Hợp đồng thuê phòng với các điều khoản cụ thể sau đây:</p>

          <section className="contract-section">
            <h3>ĐIỀU 1: ĐỐI TƯỢNG VÀ THỜI HẠN THUÊ</h3>
            <p>
              1.1. Bên A đồng ý cho Bên B thuê phòng số: <strong>{lease.room.code}</strong> ({lease.room.name}),
              thuộc cơ sở <strong>{lease.property.name}</strong>.
            </p>
            <p>
              1.2. Mục đích thuê: Dùng làm nơi để ở và sinh hoạt hợp pháp của Bên B cùng các thành viên đăng ký.
            </p>
            <p>
              1.3. Thời hạn thuê: Từ ngày <strong>{formatDateVi(lease.startDate)}</strong> đến ngày{" "}
              <strong>{lease.plannedEndDate ? formatDateVi(lease.plannedEndDate) : "vô thời hạn / theo thỏa thuận hai bên"}</strong>.
            </p>
            <p>
              1.4. Ngày chốt số liệu điện nước & lập hóa đơn định kỳ: <strong>Ngày {lease.billingDay}</strong> hàng tháng.
            </p>
          </section>

          <section className="contract-section">
            <h3>ĐIỀU 2: GIÁ THUÊ, TIỀN ĐẶT CỌC VÀ PHƯƠNG THỨC THANH TOÁN</h3>
            <p>
              2.1. Giá thuê phòng cơ bản: <strong>{formatVnd(lease.baseRentVnd)}</strong> / tháng.
            </p>
            <p>
              2.2. Tiền đặt cọc bảo đảm thực hiện hợp đồng: <strong>{formatVnd(lease.depositRequiredVnd)}</strong>.
              {deposit && deposit.heldVnd > 0 ? (
                <span> (Bên A xác nhận hiện đang giữ số tiền cọc: <strong>{formatVnd(deposit.heldVnd)}</strong>).</span>
              ) : null}
            </p>
            <p>
              2.3. Chi phí dịch vụ phát sinh (điện, nước, quản lý, internet, vệ sinh, giữ xe): Tính theo chỉ số tiêu thụ thực tế ghi nhận trên đồng hồ chốt hàng tháng và bảng đơn giá niêm yết công khai của cơ sở.
            </p>
            <p>
              2.4. Phương thức và hạn thanh toán: Bên B thanh toán hóa đơn hàng tháng trước thời hạn quy định ghi trên thông báo/hóa đơn qua chuyển khoản ngân hàng (mã VietQR định danh) hoặc theo phương thức Bên A chỉ định.
            </p>
          </section>

          <section className="contract-section">
            <h3>ĐIỀU 3: QUYỀN VÀ NGHĨA VỤ CỦA BÊN CHO THUÊ (BÊN A)</h3>
            <p>
              3.1. Bàn giao phòng và trang thiết bị gắn liền cho Bên B đúng thời hạn thỏa thuận trong tình trạng sử dụng tốt theo Biên bản bàn giao đính kèm.
            </p>
            <p>
              3.2. Bảo đảm cung cấp ổn định các dịch vụ tiện ích cơ bản (điện lưới, nước sạch) và an ninh trật tự khu vực chung.
            </p>
            <p>
              3.3. Tôn trọng quyền riêng tư hợp pháp của Bên B; không tự ý vào phòng thuê khi chưa có sự đồng ý của Bên B trừ trường hợp khẩn cấp về an toàn tính mạng hoặc phòng cháy chữa cháy.
            </p>
            <p>
              3.4. Hoàn trả tiền đặt cọc cho Bên B sau khi trừ các khoản công nợ, chi phí dịch vụ hoặc bồi thường thiệt hại (nếu có) khi hai bên thanh lý hợp đồng.
            </p>
          </section>

          <section className="contract-section">
            <h3>ĐIỀU 4: QUYỀN VÀ NGHĨA VỤ CỦA BÊN THUÊ (BÊN B)</h3>
            <p>
              4.1. Sử dụng phòng thuê đúng mục đích để ở; cung cấp đầy đủ giấy tờ tùy thân để thực hiện thủ tục đăng ký tạm trú theo quy định pháp luật.
            </p>
            <p>
              4.2. Thanh toán đầy đủ và đúng hạn tiền thuê phòng, tiền điện, nước và các khoản phí dịch vụ phát sinh hàng tháng.
            </p>
            <p>
              4.3. Chấp hành nghiêm chỉnh nội quy nhà trọ, quy định về phòng cháy chữa cháy, an ninh trật tự và vệ sinh môi trường; không tàng trữ chất cấm, vũ khí, chất cháy nổ.
            </p>
            <p>
              4.4. Giữ gìn và bảo quản tài sản, thiết bị trong phòng; không tự ý cải tạo, đục phá hoặc thay đổi kết cấu phòng khi chưa được Bên A đồng ý bằng văn bản.
            </p>
          </section>

          <section className="contract-section">
            <h3>ĐIỀU 5: CHẤM DỨT HỢP ĐỒNG VÀ ĐỐI SOÁT TRẢ PHÒNG</h3>
            <p>
              5.1. Hợp đồng chấm dứt khi hết thời hạn thỏa thuận hoặc khi hai bên thống nhất thanh lý hợp đồng trước hạn.
            </p>
            <p>
              5.2. Bên muốn chấm dứt hợp đồng trước hạn phải thông báo trước cho bên kia ít nhất 30 ngày.
            </p>
            <p>
              5.3. Tại thời điểm trả phòng, hai bên cùng tiến hành chốt chỉ số công tơ điện nước cuối kỳ, kiểm tra bàn giao hiện trạng tài sản, đối soát công nợ hóa đơn và thực hiện tất toán tiền cọc theo quy định.
            </p>
          </section>

          <section className="contract-section">
            <h3>ĐIỀU 6: ĐIỀU KHOẢN THI HÀNH</h3>
            <p>
              6.1. Hợp đồng có hiệu lực thi hành kể từ ngày ký và được lập kèm theo Biên bản bàn giao hiện trạng phòng & tài sản (Phụ lục 1).
            </p>
            <p>
              6.2. Hợp đồng được lập thành 02 (hai) bản có giá trị pháp lý như nhau, mỗi bên giữ 01 (một) bản để cùng thực hiện.
            </p>
          </section>

          <footer className="contract-signatures">
            <div className="sig-box">
              <span className="sig-title">ĐẠI DIỆN BÊN CHO THUÊ (BÊN A)</span>
              <span className="sig-note">(Ký và ghi rõ họ tên)</span>
              <div style={{ height: "70px" }} />
              <span className="sig-name">{organization.name}</span>
            </div>
            <div className="sig-box">
              <span className="sig-title">ĐẠI DIỆN BÊN THUÊ (BÊN B)</span>
              <span className="sig-note">(Ký và ghi rõ họ tên)</span>
              {lease.signatureDataUrl ? (
                <div style={{ height: "70px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <img
                    src={lease.signatureDataUrl}
                    alt="Chữ ký Bên B"
                    style={{ maxHeight: "55px", maxWidth: "160px", objectFit: "contain" }}
                  />
                  {lease.signedAt ? (
                    <span style={{ fontSize: "10px", color: "#666" }}>
                      Ký online: {formatDateVi(lease.signedAt)}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div style={{ height: "70px" }} />
              )}
              <span className="sig-name">{lease.signedByName || lease.primaryResident?.fullName || "—"}</span>
            </div>
          </footer>
        </main>
      )}

      {/* SECTION 2: BIÊN BẢN BÀN GIAO HIỆN TRẠNG PHÒNG & TRANG THIẾT BỊ (PHỤ LỤC 1) */}
      {(printScope === "ALL" || printScope === "APPENDIX_ONLY") && (
        <main
          className="contract-paper contract-appendix"
          style={{ marginTop: printScope === "ALL" ? "32px" : 0 }}
        >
          <header className="contract-header">
            <h2>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</h2>
            <p className="motto">Độc lập - Tự do - Hạnh phúc</p>
            <div className="divider" />
          </header>

          <section className="contract-title">
            <h1>BIÊN BẢN BÀN GIAO HIỆN TRẠNG PHÒNG & TRANG THIẾT BỊ</h1>
            <span>(Kèm theo Hợp đồng thuê phòng số: {lease.code})</span>
          </section>

          <div className="contract-meta">
            Thời điểm bàn giao: Ngày {formatDateVi(lease.startDate)}, tại Phòng {lease.room.code} - {lease.property.name}.
          </div>

          <section className="contract-section">
            <p>Hôm nay, hai bên tiến hành kiểm tra thực tế và ký kết Biên bản bàn giao hiện trạng phòng cùng trang thiết bị gắn liền với các nội dung chi tiết sau:</p>

            <h3>I. CHỈ SỐ CÔNG TƠ ĐẦU KỲ & CHÌA KHÓA BÀN GIAO</h3>
            <table className="contract-table">
              <thead>
                <tr>
                  <th style={{ width: "35%" }}>Hạng mục kiểm tra</th>
                  <th style={{ width: "35%" }}>Chỉ số / Số lượng bàn giao</th>
                  <th style={{ width: "30%" }}>Tình trạng kỹ thuật</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Chỉ số đồng hồ điện ban đầu</strong></td>
                  <td className="center"><strong>.................................... kWh</strong></td>
                  <td className="center">Hoạt động bình thường, nguyên niêm phong</td>
                </tr>
                <tr>
                  <td><strong>Chỉ số đồng hồ nước ban đầu</strong></td>
                  <td className="center"><strong>.................................... m³</strong></td>
                  <td className="center">Hoạt động bình thường, không rò rỉ</td>
                </tr>
                <tr>
                  <td><strong>Chìa khóa phòng & thẻ từ</strong></td>
                  <td className="center">02 bộ chìa khóa + thẻ</td>
                  <td className="center">Mở êm, quẹt từ nhạy</td>
                </tr>
              </tbody>
            </table>

            <h3>II. DANH MỤC TRANG THIẾT BỊ & NỘI THẤT TRONG PHÒNG</h3>
            <table className="contract-table">
              <thead>
                <tr>
                  <th style={{ width: "6%" }}>STT</th>
                  <th style={{ width: "32%" }}>Tên thiết bị / Tài sản</th>
                  <th style={{ width: "10%" }}>Số lượng</th>
                  <th style={{ width: "26%" }}>Tình trạng khi bàn giao</th>
                  <th style={{ width: "26%" }}>Ghi chú / Trách nhiệm</th>
                </tr>
              </thead>
              <tbody>
                {equipments.length > 0 ? (
                  equipments.map((eq, idx) => (
                    <tr key={eq.id}>
                      <td className="center">{idx + 1}</td>
                      <td>
                        <strong>{eq.name}</strong>
                        {eq.brand || eq.modelOrSerial ? (
                          <div style={{ fontSize: "11px", color: "#4b5563" }}>
                            {[eq.brand, eq.modelOrSerial].filter(Boolean).join(" · ")}
                          </div>
                        ) : null}
                      </td>
                      <td className="center">{eq.quantity || 1}</td>
                      <td>{eq.conditionStatus || "Hoạt động tốt"}</td>
                      <td>
                        {eq.compensationValueVnd ? `Quy ước đền bù: ${formatVnd(eq.compensationValueVnd)}` : (eq.note || "Bảo quản tốt")}
                      </td>
                    </tr>
                  ))
                ) : (
                  DEFAULT_INVENTORY_ITEMS.map((item, idx) => (
                    <tr key={idx}>
                      <td className="center">{idx + 1}</td>
                      <td><strong>{item.name}</strong></td>
                      <td className="center">{item.quantity}</td>
                      <td>{item.condition}</td>
                      <td>Bên B giữ gìn, bàn giao lại khi hết HĐ</td>
                    </tr>
                  ))
                )}
                {/* Dòng bổ sung ghi tay nếu cần */}
                <tr>
                  <td className="center">{equipments.length > 0 ? equipments.length + 1 : DEFAULT_INVENTORY_ITEMS.length + 1}</td>
                  <td>........................................................................</td>
                  <td className="center">.....</td>
                  <td>............................................................</td>
                  <td>............................................................</td>
                </tr>
              </tbody>
            </table>

            <h3>III. CAM KẾT CỦA CÁC BÊN</h3>
            <p>
              1. Bên B xác nhận đã kiểm tra thực tế phòng số <strong>{lease.room.code}</strong>, các trang thiết bị hoạt động bình thường, không có hư hỏng ngoại trừ những điểm đã ghi chú rõ ở trên.
            </p>
            <p>
              2. Bên B có trách nhiệm sử dụng đúng tính năng, giữ gìn bảo quản tài sản. Mọi hư hỏng do lỗi chủ quan của Bên B sẽ phải sửa chữa hoặc bồi thường theo giá trị thực tế tại thời điểm bàn giao lại phòng.
            </p>
            <p>
              3. Biên bản này là một bộ phận không tách rời của Hợp đồng số <strong>{lease.code}</strong> và có hiệu lực kể từ ngày hai bên ký tên.
            </p>
          </section>

          <footer className="contract-signatures" style={{ marginTop: "32px" }}>
            <div className="sig-box">
              <span className="sig-title">ĐẠI DIỆN BÊN GIAO (BÊN A)</span>
              <span className="sig-note">(Ký và ghi rõ họ tên)</span>
              <div style={{ height: "70px" }} />
              <span className="sig-name">{organization.name}</span>
            </div>
            <div className="sig-box">
              <span className="sig-title">ĐẠI DIỆN BÊN NHẬN (BÊN B)</span>
              <span className="sig-note">(Ký và ghi rõ họ tên)</span>
              {lease.signatureDataUrl ? (
                <div style={{ height: "70px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <img
                    src={lease.signatureDataUrl}
                    alt="Chữ ký Bên B"
                    style={{ maxHeight: "55px", maxWidth: "160px", objectFit: "contain" }}
                  />
                  {lease.signedAt ? (
                    <span style={{ fontSize: "10px", color: "#666" }}>
                      Ký online: {formatDateVi(lease.signedAt)}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div style={{ height: "70px" }} />
              )}
              <span className="sig-name">{lease.signedByName || lease.primaryResident?.fullName || "—"}</span>
            </div>
          </footer>
        </main>
      )}
    </div>
  );
}
