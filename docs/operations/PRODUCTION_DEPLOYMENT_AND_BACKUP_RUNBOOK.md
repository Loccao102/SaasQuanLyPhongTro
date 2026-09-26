# Hướng Dẫn Vận Hành & Triển Khai Production (Production Deployment & Backup Runbook)

Tài liệu này cung cấp hướng dẫn chi tiết, chuẩn hoá từ bước chuẩn bị máy chủ VPS/Cloud, cấu hình mạng & tên miền, SSL, thiết lập Docker Compose Production, cho đến quy trình tự động hoá sao lưu (Backup) và phục hồi thảm hoạ (Disaster Recovery).

---

## 1. Kiến Trúc Vận Hành Production (Architecture Overview)

Hệ thống Prop-Ops SaaS được đóng gói thành các container độc lập theo kiến trúc Modular Monolith:

```
[ Internet / Khách thuê / Chủ trọ ]
               │
               ▼
     ┌───────────────────┐
     │   Nginx Reverse   │ (Port 80 / 443 - SSL TLS 1.3)
     │   Proxy & Gzip    │
     └─────────┬─────────┘
               ├─────────────────────────┬────────────────────────┐
               ▼                         ▼                        ▼
     ┌───────────────────┐     ┌───────────────────┐    ┌───────────────────┐
     │   Admin Web       │     │  Public Invoice   │    │    API Backend    │
     │   (Next.js :3000) │     │  (Next.js :3002)  │    │  (NestJS :4000)   │
     └───────────────────┘     └───────────────────┘    └─────────┬─────────┘
                                                                  │
                                           ┌──────────────────────┴───────────────┐
                                           ▼                                      ▼
                               ┌──────────────────────┐               ┌───────────────────────┐
                               │  PostgreSQL 17 DB    │               │  Redis 7.4 (Cache/Q)  │
                               │  (Persistent Volume) │               │  (AOF Persistent)     │
                               └──────────────────────┘               └───────────────────────┘
                                           ▲
                                           │
                               ┌──────────────────────┐
                               │ Background Worker    │
                               │ (Sweep & Reconcile)  │
                               └──────────────────────┘
```

---

## 2. Yêu Cầu Cấu Hình Máy Chủ (Server Hardware & OS)

| Thông số | Tối thiểu (100 - 500 phòng) | Khuyến nghị (1,000+ phòng) |
| :--- | :--- | :--- |
| **Hệ điều hành** | Ubuntu 22.04 LTS / 24.04 LTS | Ubuntu 24.04 LTS |
| **CPU** | 2 vCPU | 4 vCPU |
| **RAM** | 4 GB | 8 GB |
| **Ổ cứng** | 50 GB NVMe SSD | 100 GB NVMe SSD |
| **Băng thông** | 100 Mbps | 1 Gbps |

---

## 3. Cài Đặt Ban Đầu Trên Server (Ubuntu Initial Setup)

### 3.1. Cập nhật hệ thống & cài Docker Engine

```bash
# Cập nhật packages
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw fail2ban jq gzip cron

# Cài đặt Docker & Docker Compose Plugin chính thức
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker
docker --version && docker compose version
```

### 3.2. Cấu hình Firewall (UFW) an toàn

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw --force enable
sudo ufw status verbose
```

---

## 4. Tải Mã Nguồn & Cấu Hình Môi Trường (.env.production)

```bash
# Clone repository
cd /opt
sudo git clone https://github.com/Loccao102/SaasQuanLyPhongTro.git propops
sudo chown -R $USER:$USER /opt/propops
cd /opt/propops

# Tạo tệp biến môi trường production
cp .env.example .env.production 2>/dev/null || touch .env.production
```

Mẫu cấu hình `.env.production` chuẩn:

```ini
# ==============================================================================
# HABI Prop-Ops Production Environment Configuration
# ==============================================================================
NODE_ENV=production

# Database Settings
POSTGRES_DB=propops_prod
POSTGRES_USER=propops_admin
# Sinh mật khẩu ngẫu nhiên: openssl rand -base64 24
POSTGRES_PASSWORD=your_super_strong_postgres_password_here

# API & Security Tokens
# Sinh chuỗi bí mật: openssl rand -hex 32
INTERNAL_WORKER_TOKEN=your_random_worker_token_32_chars_or_more
OBSERVABILITY_METRICS_TOKEN=your_random_metrics_token_32_chars_or_more
DEV_BILLING_WEBHOOK_SECRET=your_random_billing_webhook_secret_here

# Domain & URLs
API_BASE_URL=https://yourdomain.com/api
NEXT_PUBLIC_API_BASE_URL=/api
PUBLIC_INVOICE_BASE_URL=https://yourdomain.com/i
CORS_ORIGINS=https://yourdomain.com

# SePay Bank Integration (Cổng thanh toán tự động VietQR)
SEPAY_API_TOKEN=your_sepay_api_token_here
SEPAY_RENTER_WEBHOOK_SECRET=your_sepay_webhook_secret_here
SEPAY_RECONCILIATION_ENABLED=true
```

---

## 5. Khởi Động Hệ Thống Với Docker Compose

```bash
# Build và chạy ngầm toàn bộ dịch vụ
docker compose -f infra/docker-compose.prod.yml up --build -d

# Xem log các dịch vụ đang chạy
docker compose -f infra/docker-compose.prod.yml logs -f api
docker compose -f infra/docker-compose.prod.yml logs -f worker

# Kiểm tra trạng thái sức khoẻ container
docker compose -f infra/docker-compose.prod.yml ps
```

---

## 6. Thiết Lập Chứng Chỉ SSL / HTTPS Miễn Phí (Let's Encrypt)

Sử dụng Certbot để cấp chứng chỉ SSL cho tên miền của bạn:

```bash
sudo apt install -y certbot

# Cấp chứng chỉ SSL
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com --agree-tos -m admin@yourdomain.com --non-interactive

# Cấu hình chứng chỉ vào Nginx và mở cổng 443
sudo systemctl reload nginx 2>/dev/null || docker compose -f infra/docker-compose.prod.yml restart nginx
```

---

## 7. Kịch Bản Tự Động Sao Lưu Cơ Sở Dữ Liệu (Automated Backups)

Hệ thống đã tích hợp sẵn script [scripts/backup-db.sh](file:///c:/Users/Admin/SaasQuanLyPhongTro/scripts/backup-db.sh):
- Tự động nén chuẩn gzip `habi_db_propops_prod_YYYYMMDD_HHMMSS.sql.gz`.
- Kiểm tra tính toàn vẹn (file size check).
- Áp dụng chính sách lưu trữ: tự động dọn dẹp các bản sao lưu cũ quá 30 ngày (`RETENTION_DAYS=30`).
- Ghi log chi tiết tại `backups/backup.log`.

### 7.1. Cấp quyền thực thi cho scripts

```bash
chmod +x scripts/backup-db.sh
chmod +x scripts/restore-db.sh
```

### 7.2. Kiểm tra chạy thử backup thủ công

```bash
./scripts/backup-db.sh
```
Kết quả hiển thị:
```
[2026-09-26 23:00:00] === Bắt đầu sao lưu cơ sở dữ liệu [propops_prod] ===
[2026-09-26 23:00:02] Sao lưu THÀNH CÔNG: habi_db_propops_prod_20260926_230000.sql.gz (184291 bytes)
[2026-09-26 23:00:02] Áp dụng chính sách lưu trữ: Giữ lại 30 ngày gần nhất...
[2026-09-26 23:00:02] Đã dọn dẹp 0 tệp sao lưu cũ quá 30 ngày.
[2026-09-26 23:00:02] === Hoàn tất quy trình sao lưu ===
```

### 7.3. Cài đặt Cron Job tự động sao lưu lúc 02:00 sáng mỗi ngày

Mở crontab:
```bash
crontab -e
```
Thêm dòng sau vào cuối tệp:
```cron
# Chạy sao lưu Database Prop-Ops mỗi đêm lúc 02:00 sáng
0 2 * * * cd /opt/propops && ./scripts/backup-db.sh >> /opt/propops/backups/cron.log 2>&1
```

---

## 8. Quy Trình Phục Hồi Thảm Hoạ (Disaster Recovery & Restore)

Khi cần khôi phục lại dữ liệu từ một bản sao lưu (do thao tác nhầm hoặc chuyển đổi server):

1. **Xem danh sách các bản backup**:
   ```bash
   ls -lh /opt/propops/backups/*.sql.gz
   ```

2. **Chạy script phục hồi**:
   ```bash
   ./scripts/restore-db.sh backups/habi_db_propops_prod_20260926_230000.sql.gz
   ```

3. **Cơ chế an toàn**: Script sẽ yêu cầu bạn nhập `XACNHAN` và tự động tạo một snapshot an toàn ngay trước khi restore, đảm bảo bạn không bao giờ bị mất dữ liệu ngoài ý muốn.

---

## 9. Cập Nhật Phiên Bản Mới (Zero-Downtime Update)

Khi có bản cập nhật code mới từ Git:

```bash
cd /opt/propops

# 1. Kéo mã nguồn mới nhất
git pull origin main

# 2. Chạy sao lưu nhanh cơ sở dữ liệu trước khi nâng cấp
./scripts/backup-db.sh

# 3. Build lại các container
docker compose -f infra/docker-compose.prod.yml build

# 4. Khởi động lại dịch vụ không gián đoạn
docker compose -f infra/docker-compose.prod.yml up -d --remove-orphans

# 5. Kiểm tra log
docker compose -f infra/docker-compose.prod.yml logs --tail=50 -f api
```
