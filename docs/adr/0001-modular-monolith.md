# ADR-0001: Start with a Modular Monolith

- Status: Accepted
- Date: 2026-09-21

## Context

Sản phẩm có nhiều domain nhưng pilot và team chưa có nhu cầu vận hành microservices độc lập. Microservices quá sớm làm tăng deployment, tracing, transaction và operational complexity.

## Decision

Bắt đầu bằng modular monolith với module boundaries rõ ràng và background workers riêng.

## Consequences

Positive:
- transaction đơn giản;
- deploy đơn giản;
- tốc độ phát triển cao;
- module vẫn có thể tách sau.

Constraints:
- không cross-module repository access tùy tiện;
- interface/domain event rõ ràng;
- đo metrics trước khi tách service.
