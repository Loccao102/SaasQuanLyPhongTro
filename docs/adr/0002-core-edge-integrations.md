# ADR-0002: Separate Core Domains from Edge Integrations

- Status: Accepted
- Date: 2026-09-21

## Context

Zalo/Playwright, SePay, Telegram, SMS và các provider khác có thể thay API, lỗi hoặc bị thay thế.

## Decision

Core domains chỉ phụ thuộc contracts. Provider-specific implementations nằm ở integration/worker layer.

Playwright automation là transitional notification adapter, không phải business capability của Billing.

## Consequences

- Provider hỏng không làm hỏng invoice/property core.
- Có thể thay Playwright bằng official provider mà không sửa Billing.
- Integration tests phải test contract và provider separately.
