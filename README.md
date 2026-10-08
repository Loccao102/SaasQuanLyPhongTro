# Habi — Nền tảng SaaS Quản lý & Vận hành Nhà cho thuê (Prop-Ops)

Nền tảng SaaS chuyên biệt dành cho các chủ nhà trọ, hộ kinh doanh và doanh nghiệp vận hành chuỗi phòng trọ, chung cư mini, căn hộ dịch vụ (co-living). Hệ thống được thiết kế theo kiến trúc **Modular Monolith** chuẩn multi-tenant, giải quyết triệt để toàn bộ quy trình vận hành thực tế ngoài đời sống — từ chốt điện nước tại hiện trường, quản lý hợp đồng cọc phòng, thu tiền tự động VietQR, cho tới kiểm soát chi phí sửa chữa bảo trì.

---

## 📌 Bối cảnh thực tế & Bài toán vận hành giải quyết

Trong mô hình cho thuê phòng trọ/chung cư mini tại Việt Nam (quy mô từ **50 đến 500+ phòng**, phân bổ tại nhiều tòa nhà và địa bàn khác nhau), chủ nhà và đội ngũ vận hành đối mặt với những vấn đề thực tế:

```text
CƠ CẤU VẬN HÀNH THỰC TẾ TRONG HỆ THỐNG:
Tổ chức (Chủ chuỗi) ──> Cụm địa bàn (VD: Cầu Giấy, Đống Đa) ──> Tòa nhà (Property)
  └── Tầng (Floor) ──> Phòng (Room) ──> Hợp đồng (Lease) ──> Cư dân (Residents)
        ├── Đồng hồ điện/nước (Công tơ riêng từng phòng)
        ├── Trang thiết bị bàn giao (Điều hòa, nóng lạnh, giường tủ)
        ├── Hóa đơn hàng tháng & Mã VietQR thanh toán
        └── Lịch sử báo hỏng & Phiếu sửa chữa bảo trì
```

### 1. Chốt chỉ số điện/nước thực địa không phụ thuộc mạng (Staff PWA Offline-First)
* **Thực tế:** Nhân viên phải leo cầu thang bộ, vào góc khuất hoặc tầng hầm thường xuyên mất sóng 4G/Wifi; nếu dùng app thông thường sẽ bị đơ, mất dữ liệu hoặc phải ghi sổ tay rồi về nhập lại Excel gây sai sót.
* **Giải pháp Habi:** Ứng dụng **Staff PWA** thiết kế chuyên biệt cho thao tác bằng 1 tay (Thumb-First). Mất mạng vẫn nhập và lưu tức thì vào bộ nhớ máy (IndexedDB). Màn hình hiển thị số cũ, tự động tính chênh lệch thực tế (`Tiêu thụ kỳ này: +45 kWh`), cảnh báo ngay lập tức nếu số mới nhỏ hơn số cũ hoặc tiêu thụ đột biến. Khi ra nơi có sóng, chỉ cần **1 chạm là đồng bộ toàn bộ lên máy chủ**.

### 2. Biểu giá linh hoạt & Tự động chốt hóa đơn chu kỳ (Billing & Metering Engine)
* **Thực tế:** Mỗi nhà, thậm chí mỗi phòng có một cơ cấu giá khác nhau: điện tính theo số thực (`3.500đ - 4.000đ/kWh`), nước tính theo đồng hồ (`30.000đ/m³`) hoặc khoán theo đầu người (`100.000đ/người`), phí dịch vụ chung (thang máy, máy giặt, vệ sinh, wifi), phí gửi xe máy theo số lượng xe. Cuối tháng tính nhẩm thủ công mất hàng ngày trời và rất dễ nhầm lẫn.
* **Giải pháp Habi:** Hệ thống tự động gắn biểu giá chuẩn theo từng phòng. Khi đến kỳ chốt (ví dụ: kỳ **T10/2026**), ngay khi nhân viên gửi số điện nước, hệ thống tự động nhân đơn giá, tính tổng tiền phòng + dịch vụ và phát hành toàn bộ hóa đơn của tòa nhà chỉ trong vài giây.

### 3. Tự động gạch nợ ngân hàng qua mã VietQR động (Automated Payment Reconciliation)
* **Thực tế:** Khách chuyển khoản ngân hàng lẻ tẻ, sai cú pháp, chuyển thiếu tiền hoặc chuyển cọc gộp chung. Chủ nhà phải căng mắt soi sao kê ngân hàng rồi mở sổ gạch nợ từng người.
* **Giải pháp Habi:** Khách thuê mở trang hóa đơn Web (Zero-Install, không bắt khách cài app). Trên hóa đơn có sẵn **mã VietQR động** chứa chính xác số tiền và mã định danh hóa đơn. Khách dùng bất kỳ app ngân hàng nào quét mã -> Tiền về thẳng tài khoản chủ trọ -> Webhook ngân hàng (SePay) báo về -> Hệ thống **tự động gạch nợ ngay lập tức**, đổi trạng thái hóa đơn sang "ĐÃ THANH TOÁN" và cập nhật công nợ theo thời gian thực.

### 4. Quản lý vòng đời hợp đồng, cọc & bàn giao trang thiết bị (Leasing Lifecycle)
* Quản lý từ lúc khách đặt cọc giữ chỗ (deposit readiness), ký hợp đồng, khai báo khách thuê chính và người ở cùng (phục vụ đăng ký tạm trú).
* Lập danh mục trang thiết bị bàn giao phòng (tình trạng điều hòa, bình nóng lạnh, thẻ từ thang máy). Khi trả phòng (move-out), hệ thống tự động cấn trừ tiền phòng, tiền điện nước còn nợ vào tiền cọc trước khi hoàn trả.

### 5. Tiếp nhận & Xử lý sự cố bảo trì trực tiếp tại hiện trường (Field Maintenance)
* Khách thuê gửi yêu cầu sự cố (hỏng bóng đèn, tắc bồn cầu, rỉ nước vòi sen, hỏng điều hòa).
* Nhân viên vận hành nhận thông báo ngay trên Staff PWA, bấm tiếp nhận xử lý, ghi chú linh kiện thay thế và nhập chi phí sửa chữa. Chi phí này tự động kết chuyển vào **sổ thu chi vận hành** của tòa nhà để chủ trọ nắm rõ lãi lỗ thực tế.

### 6. Tự động hóa gửi thông báo đa kênh (Notification Hub)
* Hỗ trợ gửi thông báo phát hành hóa đơn, nhắc nợ định kỳ và biên nhận thanh toán qua Zalo ZNS, Zalo cá nhân (tự động hóa qua Playwright Worker), tin nhắn SMS hoặc Telegram bot.

---

## 👥 Danh sách tài khoản thử nghiệm (Test Accounts)

Hệ thống đã nạp sẵn dữ liệu thực tế mẫu với tổ chức **Habi Demo Living** (Gói `PRO`), cơ sở **Nhà trọ Habi Cầu Giấy** (`HN-CG-01`, 4 phòng có sẵn chỉ số điện nước, kỳ hóa đơn `T10/2026` đang mở và 2 yêu cầu bảo trì mẫu).

> **Mật khẩu dùng chung cho tất cả tài khoản:** `Habi12345678@`

| Cổng ứng dụng | Địa chỉ URL | Email đăng nhập | Mật khẩu | Vai trò (Role) | Chức năng kiểm thử chính |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Staff PWA** | [http://localhost:3001](http://localhost:3001) | `staff@habi.vn` | `Habi12345678@` | `STAFF` | **Chốt chỉ số điện/nước thực địa** (offline-first, tự tính tiêu thụ), **tiếp nhận & báo cáo hoàn thành sửa chữa bảo trì**. *(Vào thẳng không cần mã OTP)* |
| **Admin Web** | [http://localhost:3000](http://localhost:3000) | `admin@habi.vn` | `Habi12345678@` | `ADMIN` | Quản lý toàn bộ chuỗi nhà, phòng ốc, hợp đồng, biểu giá, kiểm tra chỉ số nhân viên gửi lên và phát hành hóa đơn. *(Vào thẳng không cần mã OTP)* |
| **Chủ nhà (Owner)** | [http://localhost:3000](http://localhost:3000) | `owner@habi.vn` | `Habi12345678@` | `OWNER` | Dành cho kiểm thử luồng **Bảo mật Onboarding MFA 2 bước (TOTP Authenticator)** bắt buộc theo chuẩn DN. |
| **Control Plane (CMS)** | [http://localhost:3003](http://localhost:3003) | `cms-dev@local.invalid` | `Habi12345678@` | `PLATFORM_ADMIN` | Quản trị nền tảng SaaS nội bộ, quản lý danh sách tenant, cấp hạn ngạch quota, giám sát hệ thống. |
| **Public Invoice** | [http://localhost:3002](http://localhost:3002) | *(Không cần đăng nhập)* | — | `RENTER` | Cổng khách thuê: Xem chi tiết tiền phòng, điện nước, quét mã VietQR tự động thanh toán. |

### Dữ liệu thực tế mẫu có sẵn trong hệ thống (Demo Seed Data)
* **Tổ chức vận hành:** `Habi Demo Living` (Gói thuê bao `PRO` kích hoạt sẵn).
* **Cơ sở thực tế:** `Nhà trọ Habi Cầu Giấy` (Mã: `HN-CG-01`, Số 12 Ngõ 68 Cầu Giấy, Hà Nội).
* **Phòng & Công tơ:** 4 phòng (`101`, `102` Tầng 1; `201`, `202` Tầng 2). Mỗi phòng đã gắn 2 công tơ:
  * **Điện (kWh):** Đơn giá `3.500đ/kWh`, có sẵn chỉ số kỳ trước (P101: `1250`, P102: `980`, P201: `2100`, P202: `1540`).
  * **Nước (m³):** Đơn giá `30.000đ/m³`, có sẵn chỉ số kỳ trước (P101: `45`, P102: `32`, P201: `78`, P202: `50`).
* **Kỳ hóa đơn:** Kỳ **T10/2026** (01/10/2026 - 31/10/2026, hạn đóng tiền 05/11/2026) đang ở trạng thái `OPEN`.
* **Sự cố thực tế:**
  * Phòng 101: *"Bóng đèn nhà tắm bị cháy"* (Trạng thái: `OPEN`) -> Nhân viên bấm nhận sửa.
  * Phòng 202: *"Vòi sen tắm bị rỉ nước liên tục"* (Trạng thái: `IN_PROGRESS`) -> Nhân viên báo cáo hoàn tất & chi phí vật tư.

---

## 🌐 Danh mục Port & Dịch vụ

| Dịch vụ | URL / Port | Mô tả chức năng |
| :--- | :--- | :--- |
| **Admin Web** | [http://localhost:3000](http://localhost:3000) | Cổng quản trị dành cho chủ trọ, quản lý cơ sở |
| **Staff PWA** | [http://localhost:3001](http://localhost:3001) | Cổng tác nghiệp thực địa cho nhân viên ghi chỉ số & sửa chữa |
| **Public Invoice** | [http://localhost:3002](http://localhost:3002) | Cổng hóa đơn điện tử công khai cho người thuê phòng |
| **CMS Platform** | [http://localhost:3003](http://localhost:3003) | Cổng quản trị nội bộ hệ thống SaaS (Control Plane) |
| **Backend API** | [http://localhost:4000/api](http://localhost:4000/api) | API Modular Monolith (NestJS) |
| **Health Check** | [http://localhost:4000/api/health](http://localhost:4000/api/health) | Kiểm tra trạng thái hoạt động của API và Database |
| **PostgreSQL** | `localhost:5432` | Cơ sở dữ liệu chính (User: `propops`, Pass: `propops`, DB: `propops`) |
| **Redis** | `localhost:6379` | Hàng đợi hàng triệu jobs, cache phiên làm việc |

---

## 🚀 Hướng dẫn khởi chạy hệ thống

Hệ thống hỗ trợ 3 cách chạy linh hoạt tùy theo nhu cầu kiểm thử hoặc phát triển:

---

### Cách 1: Chạy Full Docker (Khuyên dùng — Đơn giản & Nhanh nhất)

> **Yêu cầu duy nhất:** Máy tính đã cài đặt **Docker** & **Docker Compose**. Không cần cài đặt Node.js hay PostgreSQL trên máy host.

#### Bước 1: Chuẩn bị tệp môi trường
```bash
cp .env.example .env
```

#### Bước 2: Khởi động toàn bộ cụm container
```bash
docker compose -f infra/docker-compose.yml up --build
```
*(Nếu máy đã cài pnpm, có thể dùng phím tắt: `pnpm docker:up`)*

#### Quy trình tự động diễn ra:
1. Khởi động PostgreSQL 17 và Redis 7.4.
2. Container `migrate` tự động chạy các tệp migration SQL cấu trúc bảng.
3. Tự động chạy `seed:demo` nạp sẵn tổ chức, tài khoản test và phòng ốc mẫu.
4. Khởi động Backend API (`:4000`) và chờ endpoint health phản hồi sẵn sàng.
5. Khởi động đồng thời 4 ứng dụng Web (Admin `:3000`, Staff `:3001`, Public Invoice `:3002`, CMS `:3003`) và 3 Worker nền (thông báo, webhook billing, gạch nợ SePay).

#### Các lệnh Docker hữu ích:
```bash
# Xem log trực tiếp của toàn bộ hệ thống
pnpm docker:logs

# Dừng hệ thống
pnpm docker:down

# Xóa sạch toàn bộ dữ liệu (volume DB) để hệ thống tự tạo mới tinh từ đầu
pnpm docker:reset
```

---

### Cách 2: Chạy kết hợp (Docker Infra + Node.js trên máy Host)

> **Mục đích:** Dành cho lập trình viên cần chỉnh sửa mã nguồn với tốc độ Hot-Reload tức thì của Next.js và NestJS mà không bị ảnh hưởng bởi Docker volume cache.

#### Yêu cầu môi trường:
* **Node.js** >= 22.13.0
* **pnpm** 12.4.1 (kích hoạt bằng Corepack: `corepack enable && corepack prepare pnpm@12.4.1 --activate`)
* **Docker** (chỉ để chạy PostgreSQL và Redis)

#### Bước 1: Cài đặt thư viện & tệp cấu hình
```bash
pnpm install
cp .env.example .env
```

#### Bước 2: Bật hạ tầng Database & Redis bằng Docker
```bash
pnpm infra:up
```

#### Bước 3: Khởi tạo database & nạp dữ liệu test
```bash
pnpm db:setup
pnpm db:seed
```

#### Bước 4: Chạy toàn bộ ứng dụng trong 1 cửa sổ Terminal
```bash
pnpm dev
```
Trình điều phối sẽ tải `.env`, khởi chạy song song API, Admin, Staff, Public Invoice, CMS và các worker processes với tiền tố log trực quan theo từng màu.

---

### Cách 3: Chạy chọn lọc từng dịch vụ riêng biệt (Selective Dev)

Khi cần tập trung kiểm thử hoặc debug chuyên sâu một dịch vụ cụ thể:

```bash
# Đảm bảo hạ tầng đang chạy:
pnpm infra:up

# Chạy riêng backend API:
pnpm dev:api

# Chạy riêng ứng dụng nhân viên Staff PWA:
pnpm dev:staff

# Chạy riêng cổng quản trị Admin Web:
pnpm dev:admin

# Chạy riêng cổng hóa đơn khách thuê Public Invoice:
pnpm dev:public

# Chạy riêng cổng Control Plane CMS:
pnpm dev:cms

# Chạy riêng Worker xử lý ngầm (Notification / Webhook):
pnpm dev:worker
```

---

### Cách 4: Chạy Native 100% không dùng Docker

Nếu máy của bạn đã cài đặt sẵn PostgreSQL và Redis nội bộ:

1. Chỉnh sửa đường dẫn kết nối trong `.env`:
   ```env
   DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<dbname>
   REDIS_URL=redis://localhost:6379
   ```
2. Cài đặt và nạp dữ liệu:
   ```bash
   pnpm install
   pnpm db:setup
   pnpm db:seed
   ```
3. Chạy ứng dụng:
   ```bash
   pnpm dev
   ```

---

## 🧪 Kịch bản kiểm thử luồng vận hành hoàn chỉnh (E2E Test Flow)

Bạn có thể kiểm tra một luồng nghiệp vụ thực tế khép kín từ lúc chốt chỉ số đến khi ra hóa đơn và thanh toán theo các bước sau:

### Bước 1: Nhân viên chốt chỉ số điện nước (Staff PWA)
1. Mở trình duyệt truy cập: [http://localhost:3001/login](http://localhost:3001/login).
2. Đăng nhập bằng tài khoản:
   * Email: `staff@habi.vn`
   * Mật khẩu: `Habi12345678@`
3. Chọn cơ sở **Nhà trọ Habi Cầu Giấy**.
4. Màn hình hiển thị Kỳ hóa đơn **T10/2026** đang mở. Bấm **"Đặt ngày này"** để đồng bộ ngày ghi đúng chu kỳ.
5. Chọn từng phòng (`101`, `102`...):
   * Nhập số điện mới (ví dụ: số cũ `1250` -> nhập `1295`). Chip tự động tính: `Tiêu thụ: +45 kWh`.
   * Nhập số nước mới (ví dụ: số cũ `45` -> nhập `52`). Chip tự động tính: `Tiêu thụ: +7 m³`.
   * Bấm **"Lưu trên máy & phòng tiếp theo"** (Dữ liệu lập tức lưu an toàn vào bộ nhớ máy/IndexedDB).
6. Bấm nút **"Đồng bộ ngay"** ở góc phải thanh công cụ để đẩy dữ liệu lên máy chủ.

### Bước 2: Nhân viên tiếp nhận & xử lý sự cố bảo trì
1. Trên giao diện Staff, bấm chọn tab điều hướng **"Sự cố & Bảo trì"**.
2. Thấy danh sách sự cố đã được cư dân báo trước:
   * Ticket *"Bóng đèn nhà tắm bị cháy"* (Phòng 101) -> Bấm **"Tiếp nhận sửa"**.
   * Ticket *"Vòi sen tắm bị rỉ nước liên tục"* (Phòng 202) -> Bấm **"Báo cáo hoàn thành"**, nhập ghi chú vật tư thay thế kèm chi phí thực tế.

### Bước 3: Chủ trọ kiểm tra số liệu & phát hành hóa đơn (Admin Web)
1. Mở trình duyệt truy cập: [http://localhost:3000](http://localhost:3000).
2. Đăng nhập bằng tài khoản Quản trị:
   * Email: `admin@habi.vn`
   * Mật khẩu: `Habi12345678@`
3. Vào mục **Quản lý Hóa đơn / Điện Nước**: Toàn bộ chỉ số nhân viên vừa chốt đã tự động đồng bộ theo thời gian thực.
4. Xem tính toán thành tiền theo biểu giá tiêu chuẩn:
   * Tiền điện: `45 kWh x 3.500đ = 157.500đ`.
   * Tiền nước: `7 m³ x 30.000đ = 210.000đ`.
5. Phát hành hóa đơn gửi thông báo tự động cho cư dân.

### Bước 4: Khách thuê xem hóa đơn & thanh toán VietQR (Public Invoice)
1. Mở liên kết hóa đơn công khai [http://localhost:3002](http://localhost:3002).
2. Khách thuê xem bảng kê chi tiết minh bạch các khoản tiền.
3. Quét mã **VietQR động**: Hệ thống ngân hàng tự động gạch nợ tức thì thông qua webhook `sepay`.

---

## 🏛️ Kiến trúc cấp cao (High-Level Architecture)

```text
CMS (Control Plane :3003) ──┐
Admin Web (Desktop/Tablet :3000) ──┼──> Backend API (Modular Monolith :4000) ──> PostgreSQL 17
Staff PWA (Mobile Offline :3001) ──┤                 │
Public Invoice (Zero-install :3002)┘                 ├──> Redis 7.4 / BullMQ Queues
                                                     │       ├── General Worker
                                                     │       ├── Notification Worker
                                                     │       └── Webhook Worker
                                                     │
                                                     └──> Edge Integration Adapters
                                                             ├── SePay / VietQR Bank Transfer
                                                             ├── Zalo / Playwright Automation
                                                             └── Telegram Alerts
```

### Nguyên tắc thiết kế bắt buộc (Invariants):
* **Modular Monolith**: Tách biệt rõ ràng ranh giới module nghiệp vụ, không vội vàng phân tán microservice khi chưa cần thiết.
* **Multi-tenant Server-side**: Mọi truy vấn bắt buộc cô lập tuyệt đối theo `organization_id`.
* **Idempotency**: Mọi API ghi chỉ số, gạch nợ webhook hay job thử lại đều có khóa `idempotency_key`, không bao giờ tạo trùng giao dịch.
* **Auditability**: Mọi biến động công tơ, bảng giá và hóa đơn đều lưu vết lịch sử không thể tẩy xóa.

---

## 📚 Tài liệu kỹ thuật chi tiết

* [System Architecture Overview](docs/architecture/OVERVIEW.md) — Tổng quan kiến trúc hệ thống
* [Domain Model & Invariants](docs/architecture/DOMAIN_MODEL.md) — Mô hình nghiệp vụ & thực thể
* [Security & Multi-tenancy](docs/architecture/SECURITY.md) — Kiến trúc bảo mật & đa khách thuê
* [Design System Guidelines](docs/design/DESIGN_SYSTEM.md) — Quy chuẩn thiết kế giao diện Habi UI
* [Local Development Runtime](docs/operations/LOCAL_DEVELOPMENT.md) — Hướng dẫn chuyên sâu môi trường Dev
* [Offline-First PWA Specs](docs/operations/OFFLINE_PWA.md) — Cơ chế đồng bộ Offline PWA
* [Payment Reconciliation](docs/operations/PAYMENT_RECONCILIATION.md) — Khớp lệnh thanh toán SePay/VietQR
* [Architecture Decision Records (ADRs)](docs/adr/) — Hồ sơ các quyết định kiến trúc đã thông qua
