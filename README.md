# Habi — SaaS vận hành nhà cho thuê

Nền tảng SaaS quản lý vận hành chuỗi phòng trọ/chung cư mini, tập trung vào hai luồng cốt lõi:

1. Ghi chỉ số điện/nước nhanh, offline-first.
2. Tự động hóa phát hành hóa đơn, thu tiền và gạch nợ.

## Chạy hệ thống

### Full Docker

Chỉ cần Docker trên máy:

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

Nếu máy đã có pnpm:

```bash
pnpm docker:up
```

Compose tự chạy PostgreSQL, Redis, migration/seed, API, Admin, Staff, Public Invoice, CMS và ba worker role.

### Chạy ngoài Docker

```bash
corepack enable
corepack prepare pnpm@12.4.1 --activate
pnpm install
cp .env.example .env

# PostgreSQL/Redis có thể cài native; hoặc chỉ chạy infra bằng Docker:
pnpm infra:up

pnpm db:setup
pnpm dev
```

Các địa chỉ mặc định:

- Admin: http://localhost:3000
- Staff: http://localhost:3001
- Public Invoice: http://localhost:3002
- CMS: http://localhost:3003
- API: http://localhost:4000/api

Xem [Local Development Runtime](docs/operations/LOCAL_DEVELOPMENT.md) để biết chi tiết.

## Nguyên tắc kiến trúc

- **Modular Monolith trước, tách service khi có bằng chứng cần thiết.**
- **Scale theo tổ chức → địa bàn → cơ sở → tầng → phòng**, không theo con số pilot.
- **Core không phụ thuộc provider bên ngoài.** Zalo, Playwright, SePay, Telegram, SMS, Excel là Edge integrations.
- **Mọi tác vụ có thể retry phải idempotent.**
- **Không có thất bại âm thầm.** Notification/payment/import job luôn phải có trạng thái truy vết được.
- **Multi-tenant ngay từ schema và authorization.**
- **Auditability:** giá, chỉ số, hóa đơn và webhook phải truy ngược được lịch sử.
- **Public invoice là zero-install mobile web.**
- **Staff app là PWA offline-first.**
- **Design-before-code:** mọi user-facing feature phải qua Product Design Preflight trước khi viết UI code.

## Kiến trúc cấp cao

```text
CMS ───────────┐
Admin Web ─────┤
Staff PWA ─────┼──> Backend API (Modular Monolith) ──> PostgreSQL
Public Invoice ┘                 │
                                 ├──> Redis / Job Queue
                                 │       ├──> General Worker
                                 │       └──> Playwright Notification Worker
                                 │
                                 └──> Integration Adapters
                                         ├── SePay
                                         ├── Zalo / Playwright (transition)
                                         ├── Telegram
                                         └── future providers
```

## Tài liệu

- [System Overview](docs/architecture/OVERVIEW.md)
- [CMS / Internal Control Surface](docs/architecture/CMS.md)
- [CMS Workflows](docs/design/CMS_WORKFLOWS.md)
- [Domain Model](docs/architecture/DOMAIN_MODEL.md)
- [Scalability](docs/architecture/SCALABILITY.md)
- [Security & Multi-tenancy](docs/architecture/SECURITY.md)
- [Design System](docs/design/DESIGN_SYSTEM.md)
- [Local Development Runtime](docs/operations/LOCAL_DEVELOPMENT.md)
- [Notification Automation](docs/operations/NOTIFICATION_AUTOMATION.md)
- [Offline PWA](docs/operations/OFFLINE_PWA.md)
- [Payment Reconciliation](docs/operations/PAYMENT_RECONCILIATION.md)
- [Active Development Backlog](develop.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture Decision Records](docs/adr/)

## AI/Codex development rules

Repo có `AGENTS.md` và các project skills trong `.agents/skills/`.

Đối với mọi thay đổi user-facing, `AGENTS.md` bắt buộc agent đọc `product-design`, `frontend-pwa` và Design System trước khi thiết kế hoặc viết UI. Mỗi frontend app còn có nested `AGENTS.md` riêng để tăng mức enforce theo context.

Mọi thay đổi kiến trúc quan trọng phải cập nhật ADR và docs tương ứng trước hoặc cùng PR với code.
