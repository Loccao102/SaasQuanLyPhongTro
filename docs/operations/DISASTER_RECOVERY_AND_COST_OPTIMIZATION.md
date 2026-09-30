# Hướng Dẫn Vận Hành Tối Ưu Chi Phí & Phục Hồi Thảm Hoạ (Cost-Optimized Ops & Disaster Recovery)

Tài liệu này chuẩn hoá 3 trụ cột vận hành doanh nghiệp với mục tiêu **tối ưu chi phí tối đa (tiệm cận 0 VNĐ chi phí phụ trợ phát sinh)**:
1. **Kiểm thử chịu tải chuyên sâu (Zero-Cost Native Load Testing)**
2. **Sao lưu dữ liệu & Phục hồi thảm hoạ (Automated Backup & Disaster Recovery với Cloudflare R2 Free Tier)**
3. **Mở rộng chịu tải & Caching phân tán (Hybrid In-Memory / Redis Pub-Sub & Smart SSE)**

---

## 1. Kiến Trúc Tối Ưu Chi Phí (Zero-Cost Architecture Breakdown)

| Hạng mục | Giải pháp SaaS truyền thống | Giải pháp HABI Prop-Ops Tối Ưu Chi Phí | Chi phí hàng tháng |
| :--- | :--- | :--- | :--- |
| **Load Testing** | Datadog / k6 Cloud / BlazeMeter | Script Node.js native (`scripts/load-test.mjs`) giả lập 1,000+ VUs trực tiếp | **0 VNĐ** |
| **Lưu trữ Backup** | AWS S3 Standard + Egress transfer fee | Cloudflare R2 Free Tier (10 GB miễn phí, **0$ phí egress khi khôi phục**) | **0 VNĐ** |
| **Bộ nhớ đệm & Pub/Sub** | AWS ElastiCache / Redis Enterprise Cloud ($15 - $50/tháng) | **Hybrid CacheService**: Tự động dùng Node.js EventEmitter trên VPS đơn lẻ; tự động kết nối Redis / Upstash Free Tier khi có `REDIS_URL` | **0 VNĐ** |
| **Quản lý kết nối SSE** | Duy trì kết nối socket liên tục ngốn RAM | Ngắt EventSource ngay khi hóa đơn chuyển trạng thái `PAID`, bỏ qua kết nối với hóa đơn đã thu tiền | Tiết kiệm **80% RAM & CPU** |

---

## 2. Kiểm Thử Chịu Tải (Load Testing Benchmark)

Công cụ `scripts/load-test.mjs` sử dụng HTTP Keep-Alive Agent native của Node.js, cho phép đo lường chính xác các chỉ số tải cao:

### 2.1. Lệnh thực thi nhanh

```bash
# 1. Kiểm thử endpoint Health check (50 VUs, 10 giây)
pnpm test:load -- --scenario health --concurrency 50 --duration 10

# 2. Kiểm thử tải nặng lên Public Invoice Tra Cứu (100 VUs, 15 giây)
pnpm test:load -- --scenario public-invoice --concurrency 100 --duration 15

# 3. Kiểm thử tổng hợp toàn diện
pnpm test:load -- --scenario all --concurrency 100 --duration 20
```

### 2.2. Các chỉ số được báo cáo tự động:
- **Throughput (RPS)**: Số lượng request xử lý mỗi giây.
- **Phân vị thời gian phản hồi**: Min, p50 (median), p90, **p95 (ngưỡng cam kết SLA < 250ms)**, p99, Max.
- **Biến thiên bộ nhớ**: RSS Delta & V8 Heap Delta (phát hiện rò rỉ bộ nhớ).
- **Phân bổ mã trạng thái HTTP**: HTTP 200, 404, 429, 500.

---

## 3. Sao Lưu & Phục Hồi Thảm Hoạ (Disaster Recovery & Backup)

### 3.1. Quy trình sao lưu tự động (`pnpm db:backup`)

Script `scripts/backup-db.mjs` thực hiện 5 bước an toàn:
1. Kích hoạt `pg_dump` trích xuất schema & data (`--clean --if-exists --no-owner`).
2. Nén luồng tức thời với thuật toán `gzip` cấp độ 9 (tiết kiệm đến 85% dung lượng lưu trữ).
3. Tạo mã băm toàn vẹn **SHA-256** ghi vào tệp đồng hành `.sha256`.
4. Áp dụng chính sách xoay vòng lưu trữ (Retention Policy): Tự động xoá các bản backup cũ quá 30 ngày trên máy chủ để chống đầy ổ cứng.
5. *(Tuỳ chọn)* Tự động đồng bộ lên Cloudflare R2 bucket thông qua biến môi trường `R2_BUCKET_NAME`.

```bash
# Thực hiện sao lưu ngay lập tức
pnpm db:backup
```

### 3.2. Cấu hình Cloudflare R2 Miễn Phí (Zero Egress Fee)

1. Đăng ký tài khoản miễn phí tại [cloudflare.com](https://dash.cloudflare.com) và vào mục **R2 Object Storage**.
2. Tạo bucket có tên: `propops-backups`. Cloudflare cấp miễn phí 10 GB lưu trữ và **miễn phí 100% chi phí tải về (0$ egress)**.
3. Cài đặt `rclone` trên server VPS và cấu hình remote `r2`:
   ```bash
   rclone config
   # Chọn s3 -> Cloudflare R2 -> Nhập Access Key & Secret Key
   ```
4. Đặt biến môi trường trong `.env.production`:
   ```env
   R2_BUCKET_NAME=propops-backups
   ```

### 3.3. Thiết lập Cron Job hàng đêm trên Linux Server

Chạy `crontab -e` và dán cấu hình chạy lúc 02:00 sáng mỗi ngày:
```cron
0 2 * * * cd /opt/propops && node scripts/backup-db.mjs >> /opt/propops/backups/backup.log 2>&1
```

### 3.4. Quy trình Phục Hồi Thảm Hoạ 1-Lệnh (`pnpm db:restore`)

Khi xảy ra sự cố (hỏng ổ cứng, thao tác xoá nhầm, hoặc chuyển server mới):

```bash
# Xem danh sách bản sao lưu có sẵn
pnpm db:restore

# Khôi phục dữ liệu từ bản sao lưu cụ thể (tự động kiểm tra SHA-256 & tạo snapshot an toàn)
pnpm db:restore backups/habi_db_propops_20260930120000.sql.gz
```

**Cơ chế bảo vệ 3 lớp của `pnpm db:restore`:**
- **Lớp 1 (Integrity Check)**: Tự động băm lại tệp `.sql.gz` và đối chiếu với tệp `.sha256`. Nếu tệp bị hỏng hoặc thiếu byte, script sẽ dừng ngay lập tức.
- **Lớp 2 (Safety Snapshot)**: Trước khi xóa/ghi đè database, hệ thống tự động xuất một bản snapshot dự phòng `backups/safety_before_restore_*.sql.gz`.
- **Lớp 3 (User Confirmation)**: Yêu cầu người quản trị gõ chữ `XACNHAN` trước khi thực thi.

---

## 4. Tối Ưu Caching & Realtime Mở Rộng Phân Tán

### 4.1. Cơ chế Hybrid Pub/Sub (`CacheService`)

```
                          ┌────────────────────────┐
                          │   Public Invoice API   │
                          └───────────┬────────────┘
                                      │
            ┌─────────────────────────┴─────────────────────────┐
            ▼                                                   ▼
┌─────────────────────────┐                         ┌─────────────────────────┐
│     Đơn máy chủ VPS     │                         │      Cụm Multi-Node     │
│   (Single Instance)     │                         │   (Cluster Replicas)    │
├─────────────────────────┤                         ├─────────────────────────┤
│ • Cache: In-Memory Map  │                         │ • Cache: In-Memory Map  │
│ • Pub/Sub: EventEmitter │                         │ • Pub/Sub: Redis PubSub │
│ • Chi phí: 0 VNĐ        │                         │ • Đồng bộ: Đa máy chủ   │
└─────────────────────────┘                         └─────────────────────────┘
```

- Khi chạy đơn máy chủ: `CacheService` sử dụng `node:events EventEmitter` nội bộ, đạt độ trễ 0ms và không đòi hỏi cài thêm Redis container nếu muốn tiết kiệm RAM (phù hợp VPS 1GB - 2GB RAM).
- Khi nâng cấp cụm nhiều container hoặc nhiều server: Chỉ cần cấu hình biến `REDIS_URL=redis://...`, `CacheService` tự động chuyển sang chế độ phân tán qua Redis Channel `public_invoice_status_invalidated`.

### 4.2. Giảm tải kết nối SSE

- Hóa đơn đã thanh toán (`PAID`) **không bao giờ mở luồng EventSource**.
- Hóa đơn đang chờ thanh toán sẽ lắng nghe sự kiện; ngay khi nhận trạng thái `PAID`, client sẽ đóng kết nối `stream.close()` ngay lập tức.
- Nhờ vậy, server không bị giữ hàng ngàn idle socket vô ích trong những ngày cao điểm thu tiền nhà.
