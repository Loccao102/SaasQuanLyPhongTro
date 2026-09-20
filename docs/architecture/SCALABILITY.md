# Scalability Strategy

## Nguyên tắc

Không tối ưu cho "200 phòng"; tối ưu cho mô hình dữ liệu và workload có thể tăng theo:
- số organization;
- số khu vực;
- số property;
- số room;
- số invoice kỳ;
- số notification job;
- số payment webhook.

## Database

### Bắt buộc từ đầu
- index các foreign key thường lọc;
- composite index với `organization_id`;
- unique key cho idempotency/provider event;
- pagination theo cursor cho danh sách lớn;
- không N+1 query;
- money không dùng float.

### Chỉ thêm khi đo được nhu cầu
- table partitioning;
- read replicas;
- materialized view;
- sharding.

Partitioning theo tenant_id không mặc định áp dụng ngay vì có thể tạo overhead. Quyết định dựa trên kích thước bảng và query profile.

## Aggregation

Không lưu room_count thủ công trong administrative area.

Nguồn chuẩn là Room/Property. Khi scale lớn, dùng cached aggregate/materialized projection được rebuild từ source of truth.

## Queue

Notification, import/export và billing batch không chạy trong HTTP request.

Queue consumer có:
- concurrency limit;
- retry/backoff;
- dead-letter/manual review;
- idempotency key.

## Horizontal scaling

API phải stateless để chạy nhiều replica khi cần.

Worker scale độc lập theo loại job. Playwright worker đặc biệt phải có concurrency thấp và session isolation.

## Observability

Theo dõi tối thiểu:
- API latency/error rate;
- queue depth/oldest job age;
- failed jobs;
- invoice generation duration;
- payment webhook lag;
- notification success/failure;
- DB slow queries;
- PWA sync failures.

## Scale milestones

### 0–5k rooms
Một VPS/VM mạnh vừa đủ + PostgreSQL + Redis + workers.

### 5k–50k rooms
Tách DB managed nếu cần, nhiều API/worker replicas, object storage, aggregate projections.

### >50k rooms
Đánh giá partitioning, read replicas, dedicated queues, service extraction dựa trên bottleneck thực tế.

Không tách microservice theo dự đoán.
