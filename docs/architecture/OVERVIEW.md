# System Architecture Overview

## 1. Mục tiêu

Hệ thống quản lý vận hành phòng trọ theo hướng SaaS, từ vài trăm đến nhiều nghìn/phân tán nhiều địa bàn mà không phải thay đổi kiến trúc nền.

Pilot 200 phòng chỉ là dữ liệu khởi đầu, không phải giới hạn thiết kế.

## 2. Các client

### CMS / Internal Control Surface
Ứng dụng nội bộ cho đội vận hành SaaS để cấu hình system settings, plans/limits, inspect organization, theo dõi jobs/logs và audit. CMS là product surface riêng nhưng không sở hữu business data/DB riêng; mọi mutation đi qua backend application/domain services.

### Admin Web
Quản lý tài sản, địa bàn, biểu giá, kỳ chốt, phân công, hóa đơn, thu nợ, báo cáo và cấu hình integration.

### Staff PWA
Nhập chỉ số điện/nước theo checklist, ưu tiên tốc độ thao tác và offline-first.

### Public Invoice Web
Trang zero-install cho người thuê: xem chi tiết hóa đơn, VietQR/deeplink, trạng thái thanh toán.

## 3. Backend

Backend là **Modular Monolith** với bounded modules:

- Identity & Access
- Organizations
- Administrative Areas
- Operational Groups
- Properties
- Rooms
- Residents & Leases
- Pricing
- Billing Cycles
- Metering
- Invoices
- Payments
- Notifications
- Reporting
- Integrations

Module giao tiếp qua service contracts/domain events nội bộ, không truy cập repository của module khác tùy tiện.

## 4. Workers

Tác vụ không cần trả kết quả tức thì đi qua queue:

- invoice generation;
- notification delivery;
- payment webhook processing;
- Excel import/export;
- aggregate/report refresh.

Playwright chạy thành worker riêng để browser crash/logout không ảnh hưởng API.

## 5. Persistence

PostgreSQL là source of truth. Redis chỉ dùng cho queue/cache/ephemeral coordination, không phải source of truth tài chính.

CMS không có business DB riêng; nó thao tác SaaS state thông qua backend contracts.

## 6. Core vs Edge

### Core
Property, Lease, Metering, Pricing, Billing, Invoice, Payment.

### Edge
Zalo, Playwright, SePay, SMS, Telegram, Excel, QR provider, bank deeplink.

Core chỉ biết interface/contract; Edge implementation có thể thay thế.

## 7. Realtime

Ưu tiên SSE cho:
- payment status của public invoice;
- tiến độ kỳ chốt;
- notification progress.

WebSocket chỉ thêm khi có use case hai chiều thực sự.
