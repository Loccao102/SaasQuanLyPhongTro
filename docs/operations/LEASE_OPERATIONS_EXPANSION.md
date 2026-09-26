# Hướng dẫn Vận hành Quản lý Hợp đồng Mở rộng

Tài liệu mô tả 4 quy trình nghiệp vụ hợp đồng được triển khai toàn diện trên hệ thống Prop-Ops SaaS:
1. **Đối soát công nợ hóa đơn tự động khi trả phòng (Financial Readiness)**
2. **Gia hạn hợp đồng (Lease Renewal Workflow)**
3. **Tạo hợp đồng thay thế nhanh cho phòng đã trả (Replacement Lease Creation)**
4. **In hợp đồng chuẩn hóa (Printable Vietnamese Residential Lease Agreement)**

---

## 1. Đối soát công nợ hóa đơn tự động khi trả phòng

### 1.1 Nguyên tắc thiết kế
- `financial_readiness` của quy trình trả phòng thuộc quyền sở hữu module (`renter-billing` / `leasing`), **không cho phép override thủ công**.
- Mọi nỗ lực gọi `POST /admin/leases/:leaseId/termination/readiness` với `kind: "financial"` sẽ trả về `409 ConflictException` hướng dẫn kiểm tra trạng thái hóa đơn thực tế.
- Trạng thái công nợ được đồng bộ tự động từ bảng `renter_invoices`:
  - **READY**: Tất cả hóa đơn trong kỳ thuê đã được thanh toán đầy đủ (`PAID`) hoặc đã hủy hợp lệ (`VOID`), không còn nợ tồn đọng (`remaining_vnd = 0`) và không có hóa đơn nháp (`DRAFT`).
  - **PENDING**: Còn ít nhất một hóa đơn chưa thanh toán đủ (`remaining_vnd > 0`), hoặc còn hóa đơn ở trạng thái nháp (`DRAFT`) cần duyệt/phát hành hoặc hủy trước khi hoàn tất trả phòng.

### 1.2 Giao diện Admin
- Khi mở màn hình `/leases/[leaseId]/terminate`, hệ thống tự động tải bảng tổng hợp công nợ:
  - Tổng tiền phát sinh kỳ thuê.
  - Tổng số tiền người thuê đã thanh toán.
  - Số nợ còn lại (nếu có).
  - Cảnh báo nếu tồn tại hóa đơn `DRAFT`.
  - Danh sách chi tiết từng hóa đơn kèm kỳ tính cước, hạn nộp, trạng thái thu tiền và liên kết trực tiếp đến trang hóa đơn.
- Khi hoàn tất trả phòng (`finalizeTermination`), hệ thống dùng câu lệnh CTE với `FOR UPDATE` khóa dòng `lease_terminations` và kiểm tra lại toàn bộ hóa đơn trong transaction để loại trừ race condition.

---

## 2. Quy trình Gia hạn Hợp đồng (Lease Renewal)

### 2.1 Nghiệp vụ & Ràng buộc toàn vẹn
- **Điều kiện**: Chỉ hợp đồng đang có trạng thái `ACTIVE` mới được phép thực hiện gia hạn.
- **Phòng thuê**: Invariant cơ sở dữ liệu `leases_one_current_per_room_uidx` quy định tại một thời điểm mỗi phòng chỉ có tối đa một hợp đồng `ACTIVE` hoặc `TERMINATION_SCHEDULED`.
- **Cơ chế gia hạn**:
  - Tạo một hợp đồng mới ở trạng thái `DRAFT`.
  - Thiết lập liên kết tham chiếu `renewed_from_lease_id` trỏ về hợp đồng cũ.
  - Tự động sao chép người thuê chính (`PRIMARY_TENANT`) và toàn bộ các thành viên đang cùng cư trú (`CO_TENANT`, `OCCUPANT`) còn hiệu lực sang hợp đồng mới.
  - Hỗ trợ tùy chọn **Chuyển tiếp tiền cọc (Deposit Rollover)** từ số dư cọc đang giữ (`heldVnd`) của hợp đồng cũ sang kỳ hạn mới.
  - Hợp đồng cũ tiếp tục hiệu lực bình thường cho đến khi hết hạn hoặc đến thời điểm hợp đồng mới được kích hoạt.

### 2.2 API Endpoint
```http
POST /admin/leases/:leaseId/renew
Content-Type: application/json

{
  "newLeaseId": "c4d092d6-4447-4f6c-bfe0-15ef612c6a01",
  "idempotencyKey": "renew-hd-2026-0001-v1",
  "newLeaseCode": "HD-2026-0001-GH",
  "startDate": "2027-01-01",
  "plannedEndDate": "2027-12-31",
  "baseRentVnd": 4500000,
  "depositRequiredVnd": 4500000,
  "billingDay": 5,
  "rolloverDeposit": true
}
```

---

## 3. Tạo Hợp đồng Thay thế Nhanh (Replacement Lease)

### 3.1 Luồng thực hiện
- Sau khi hợp đồng cũ đã kết thúc (`TERMINATED`), phòng thuê trở về trạng thái trống (`VACANT`).
- Tại trang chi tiết hợp đồng cũ hoặc màn hình xác nhận hoàn tất trả phòng, quản lý chỉ cần nhấn:
  `+ Tạo hợp đồng mới cho phòng này`
- Đường dẫn điều hướng kèm theo query parameters:
  `/leases/new?roomId={roomId}&baseRentVnd={baseRentVnd}&depositRequiredVnd={depositRequiredVnd}`
- Form tạo hợp đồng tự động:
  - Chọn sẵn phòng tương ứng và hiển thị banner thông báo ngữ cảnh.
  - Điền sẵn mức giá thuê cơ bản và tiền cọc theo kỳ trước.
  - Cho phép quản trị viên tìm kiếm/tái sử dụng hồ sơ khách thuê cũ hoặc nhập khách mới.

---

## 4. In Hợp đồng Chuẩn hóa (Printable Lease Document)

### 4.1 Tính năng
- Truy cập tại đường dẫn: `/leases/[leaseId]/print` hoặc nhấn nút **"In hợp đồng"** trên thanh tác vụ của trang chi tiết.
- Văn bản hợp đồng được soạn thảo theo thể thức **Hợp đồng thuê phòng trọ / nhà ở chuẩn Việt Nam**:
  - Tiêu ngữ Quốc gia: CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM - Độc lập - Tự do - Hạnh phúc.
  - Mã số hợp đồng, ngày tháng, thông tin Bên A (Chủ nhà / Đơn vị quản lý) và Bên B (Khách thuê chính và danh sách người ở cùng).
  - 6 Điều khoản chặt chẽ: Đối tượng & Thời hạn thuê; Giá thuê & Tiền cọc; Quyền/Nghĩa vụ Bên A; Quyền/Nghĩa vụ Bên B; Chấm dứt & Đối soát trả phòng; Điều khoản thi hành.
  - Khung chữ ký hai bên với định dạng `page-break-inside: avoid` đảm bảo không bị đứt trang khi in.
- Hỗ trợ in trực tiếp: Nhấn nút "🖨️ In hợp đồng" hoặc bấm `Ctrl + P`. CSS `@media print` tự động ẩn thanh công cụ và tối ưu hóa lề giấy cho khổ A4 Portrait.

---

## 5. Quản lý Hồ sơ & Tài liệu đính kèm Hợp đồng (Lease Attachments)

### 5.1 Nghiệp vụ & Ràng buộc toàn vẹn
- Bảng cơ sở dữ liệu: `lease_attachments`.
- Hỗ trợ phân loại tài liệu:
  - `CITIZEN_ID_FRONT`: Ảnh CCCD mặt trước của khách thuê.
  - `CITIZEN_ID_BACK`: Ảnh CCCD mặt sau của khách thuê.
  - `CONTRACT_SCAN`: Bản scan / ảnh chụp hợp đồng giấy đã ký.
  - `HANDOVER_MINUTES`: Biên bản bàn giao tài sản, đồ đạc phòng trọ.
  - `OTHER`: Các hồ sơ chứng từ liên quan khác.
- Ràng buộc:
  - Khóa ngoại liên kết `FOREIGN KEY (organization_id, lease_id) REFERENCES leases(organization_id, id) ON DELETE CASCADE`.
  - Quyền truy cập: Quản trị viên và Quản lý cơ sở (`lease.manage`).
  - Giao diện Admin: Cho phép tải lên tệp ảnh/PDF trực tiếp, xem trước và tải về, xóa tệp với xác nhận rõ ràng.

---

## 6. Ký Phụ lục Hợp đồng Điều chỉnh (Lease Amendments)

### 6.1 Nghiệp vụ & Cơ chế đồng bộ
- Bảng cơ sở dữ liệu: `lease_amendments`.
- Điều kiện: Chỉ thực hiện khi hợp đồng đang `ACTIVE` hoặc `TERMINATION_SCHEDULED`.
- Các điều khoản cho phép điều chỉnh:
  - Mức giá thuê cơ bản mới (`adjusted_base_rent_vnd`).
  - Tiền cọc yêu cầu mới (`adjusted_deposit_required_vnd`).
  - Ngày kết thúc hợp đồng mới (`adjusted_planned_end_date`).
- Khi lưu phụ lục thành công:
  - Hệ thống ghi lại dấu vết pháp lý đầy đủ (số hiệu phụ lục, ngày hiệu lực, tóm tắt nội dung thay đổi, người tạo).
  - Tự động cập nhật các trường tương ứng trên bản ghi `leases`, tăng phiên bản lạc quan `version = version + 1`, và ghi log audit `LEASE_AMENDED`.

---

## 7. Sổ Quỹ Thu - Chi Vận Hành & Lợi Nhuận Ròng (Operating Finances)

### 7.1 Cấu trúc & Phân loại chi phí
- Bảng cơ sở dữ liệu: `operating_expenses`.
- Phân loại danh mục chi:
  - `REPAIR_MAINTENANCE`: Sửa chữa, bảo trì thiết bị, phòng trọ.
  - `UTILITIES`: Điện, nước, internet tổng khu trọ.
  - `MANAGEMENT_SERVICE`: Phí dịch vụ, quản lý, bảo vệ.
  - `CLEANING_WASTE`: Vệ sinh, thu gom rác thải.
  - `TAX_FEES`: Thuế môn bài, thuế cho thuê nhà, phí giấy tờ pháp lý.
  - `OTHER`: Các chi phí vận hành khác.
- Định dạng tiền tệ: Số nguyên VND (`BIGINT`, `CHECK (amount_vnd > 0)`).
- Phương thức thanh toán: Tiền mặt (`CASH`), Chuyển khoản (`BANK_TRANSFER`), Khác (`OTHER`).

### 7.2 Tính toán Dòng tiền & Báo cáo P&L
- Truy cập tại đường dẫn: `/finances` (mục "Sổ quỹ Thu - Chi" trên thanh điều hướng chính).
- **Tổng thu khách thuê (Inflow)**: Tổng hợp tự động từ các giao dịch thanh toán hóa đơn đã xác nhận (`renter_payment_transactions` trạng thái `POSTED` hoặc allocations theo cơ sở).
- **Tổng chi vận hành (Outflow)**: Tổng chi phí ghi nhận trong kỳ đã chọn.
- **Dòng tiền ròng / Lợi nhuận (Net Cashflow)**: `Inflow - Outflow`, kèm tỷ suất lợi nhuận trên tổng thu.
- Hỗ trợ lọc đa chiều: Theo cơ sở cụ thể hoặc toàn tổ chức, theo danh mục chi, theo khoảng thời gian tùy chọn.

---

## 8. Bảo Mật & Quản Lý Đổi Mật Khẩu (Account Security)

### 8.1 Thuật toán & Kiểm soát phiên
- Thuật toán mật mã: **scrypt** chuẩn production (`N=131072, r=8, p=1`), salt ngẫu nhiên 16 bytes, key length 64 bytes.
- Chính sách mật khẩu: Bắt buộc tối thiểu 12 ký tự UTF-8, không trùng mật khẩu cũ.
- Bảo vệ phiên đăng nhập:
  - Khi đổi mật khẩu thành công, trường `auth_version` của người dùng được tăng thêm 1.
  - Phiên làm việc hiện tại tự động cập nhật lên `auth_version` mới giúp người dùng không bị gián đoạn công việc, trong khi toàn bộ các phiên đăng nhập khác (nếu có nghi ngờ lộ lọt) sẽ bị vô hiệu ngay lập tức.
- Giao diện Admin: Hỗ trợ nút "Đổi MK" tại thẻ tài khoản sidebar và nút biểu tượng avatar trên thanh topbar, mở hộp thoại đổi mật khẩu trực quan kèm kiểm tra độ khớp và hướng dẫn an toàn.
