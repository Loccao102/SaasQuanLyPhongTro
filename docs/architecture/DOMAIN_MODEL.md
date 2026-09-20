# Domain Model

## 1. Cây quản lý tài sản

```text
Organization / Landlord Account
├── Administrative Areas
├── Operational Groups
└── Properties
    └── Floors
        └── Rooms
            └── Leases
                └── Residents
```

## 2. Organization

Một organization là một tài khoản khách hàng SaaS. Có thể là:
- cá nhân;
- hộ kinh doanh;
- công ty.

Không giả định khách hàng phải là doanh nghiệp.

## 3. Administrative Area

Mô hình dạng cây:

```text
Province/City
  -> Ward/Commune or other administrative level
```

Tránh hard-code schema theo một phiên bản địa giới hành chính. Entity nên có:
- id;
- parent_id;
- code;
- name;
- type;
- effective_from/effective_to nếu cần lịch sử.

## 4. Operational Group

Nhóm vận hành do organization tự định nghĩa, độc lập với địa giới hành chính.

Ví dụ:
- Cụm Tây Hà Nội;
- Cụm Bắc Hà Nội;
- Ca nhân viên A.

Một property có thể thuộc một administrative area và một hoặc nhiều operational group.

## 5. Property / Floor / Room

Property là một địa điểm/cơ sở cụ thể. Room không mang trực tiếp thông tin người thuê hiện tại; quan hệ người thuê đi qua Lease.

## 6. Lease / Resident

```text
Resident -> Lease -> Room
```

Lease có thời gian hiệu lực, trạng thái và lịch sử. Đổi người thuê không phá lịch sử invoice cũ.

## 7. Pricing

Pricing Policy chứa các Pricing Item:
- ROOM_RENT
- ELECTRICITY_PER_KWH
- WATER_PER_M3
- WATER_PER_PERSON
- INTERNET
- PARKING
- TRASH
- CUSTOM

Invoice phải snapshot mô tả, quantity, unit_price và amount; sửa pricing hiện tại không được làm thay đổi invoice lịch sử.

## 8. Metering

Các entity chính:
- Meter
- MeterReading
- BillingCycle
- StaffAssignment

Reading có client UUID/idempotency key để offline retry không tạo duplicate.

## 9. Invoice

```text
Invoice
  -> InvoiceLine[]
```

Invoice lưu:
- organization_id;
- room_id;
- lease_id;
- billing_cycle_id;
- total_amount;
- paid_amount;
- remaining_amount;
- status;
- public token;
- payment code.

## 10. Payment

```text
PaymentTransaction
  -> PaymentAllocation
      -> Invoice
```

Không gắn một transaction trực tiếp vào một invoice vì cần hỗ trợ partial payment, nhiều transaction/1 invoice và tương lai 1 transaction/nhiều invoice.

## 11. Notification

```text
NotificationJob
  -> NotificationAttempt[]
  -> Provider Adapter
```

Mọi job đều có trạng thái và không được thất bại âm thầm.
