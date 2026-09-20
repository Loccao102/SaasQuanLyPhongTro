# SaaS Quản Lý Phòng Trọ — Prop-Ops

Nền tảng SaaS quản lý vận hành chuỗi phòng trọ/chung cư mini, tập trung vào hai luồng cốt lõi:

1. Ghi chỉ số điện/nước nhanh, offline-first.
2. Tự động hóa phát hành hóa đơn, thu tiền và gạch nợ.

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
Admin Web ─────┐
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
- [Domain Model](docs/architecture/DOMAIN_MODEL.md)
- [Scalability](docs/architecture/SCALABILITY.md)
- [Security & Multi-tenancy](docs/architecture/SECURITY.md)
- [Design System](docs/design/DESIGN_SYSTEM.md)
- [Notification Automation](docs/operations/NOTIFICATION_AUTOMATION.md)
- [Offline PWA](docs/operations/OFFLINE_PWA.md)
- [Payment Reconciliation](docs/operations/PAYMENT_RECONCILIATION.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture Decision Records](docs/adr/)

## AI/Codex development rules

Repo có `AGENTS.md` và các project skills trong `.agents/skills/`.

Đối với mọi thay đổi user-facing, `AGENTS.md` bắt buộc agent đọc `product-design`, `frontend-pwa` và Design System trước khi thiết kế hoặc viết UI. Mỗi frontend app còn có nested `AGENTS.md` riêng để tăng mức enforce theo context.

Mọi thay đổi kiến trúc quan trọng phải cập nhật ADR và docs tương ứng trước hoặc cùng PR với code.
