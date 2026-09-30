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

## 3. Identity / Tenant Account

Habi có hai lớp identity:

- `TENANT`: account thuộc đúng một `Organization` qua `users.organization_id`;
- `PLATFORM`: account CMS/control-plane, không thuộc tenant.

Tenant account có đúng một tenant binding. `OrganizationMembership` vẫn giữ role, status và resource scope để authorization rõ ràng và audit được.

Self-service registration tạo organization + OWNER + ORGANIZATION scope + STARTER trial trong cùng transaction. OWNER/CMS có thể tạo thêm tenant account trong giới hạn account-seat của plan.

## 5. SaaS Commercial

SaaS Commercial là business concern của nền tảng, không thuộc CMS UI.

```text
SaaSPlan
  -> SaaSPlanVersion[]

Organization
  -> OrganizationSubscription
      -> SaaSPlanVersion
```

Nguyên tắc:
- plan/price/limit là data, không hard-code rải trong feature code;
- thay đổi plan tạo version mới;
- subscription giữ `plan_version_id` để cấu hình lịch sử không bị rewrite;
- CMS chỉ là một client/operator surface gọi application service;
- phí subscription SaaS tách khỏi Invoice/Payment nghiệp vụ người thuê trả cho chủ trọ;
- room usage lấy từ Room source of truth, không copy thành authoritative counter trong CMS.

Subscription baseline:
- `TRIALING`;
- `ACTIVE`;
- `PAST_DUE`;
- `GRACE_PERIOD`;
- `SUSPENDED`;
- `CANCELLED`.

## 5. Administrative Area

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

## 6. Operational Group

Nhóm vận hành do organization tự định nghĩa, độc lập với địa giới hành chính.

Ví dụ:
- Cụm Tây Hà Nội;
- Cụm Bắc Hà Nội;
- Ca nhân viên A.

Một property có thể thuộc một administrative area và một hoặc nhiều operational group.

## 7. Property / Floor / Room

Property là một địa điểm/cơ sở cụ thể. Room không mang trực tiếp thông tin người thuê hiện tại; quan hệ người thuê đi qua Lease.

Room occupancy được suy ra từ Lease có trạng thái `ACTIVE` hoặc `TERMINATION_SCHEDULED`; không lưu một `current_tenant_id` mutable trên Room.

## 8. Lease / Resident

```text
Room
  -> Lease
      -> LeaseResident[]
          -> Resident
```

Lease có lịch sử độc lập. Người thuê chuyển đi không xóa Lease cũ, và hợp đồng tiếp theo luôn là Lease mới.

Lifecycle baseline:

```text
DRAFT -> ACTIVE -> TERMINATION_SCHEDULED -> TERMINATED
   \-> CANCELLED

TERMINATION_SCHEDULED -> ACTIVE
```

Chỉ được hoàn tất chấm dứt khi Metering, financial settlement và deposit settlement đều đã `READY` hoặc `NOT_REQUIRED`.

Leasing chỉ giữ trạng thái readiness để orchestration; meter reading, invoice, payment vẫn thuộc module sở hữu tương ứng.

Một Lease lưu contractual snapshot cơ bản:
- start_date / planned_end_date;
- base_rent_vnd;
- deposit_required_vnd;
- billing_day;
- parties/residents;
- lifecycle/version.

Các số tiền dùng integer VND.

## 9. Pricing

Pricing Policy chứa các Pricing Item:
- ROOM_RENT
- ELECTRICITY_PER_KWH (đồng hồ)
- ELECTRICITY_PER_PERSON (khoán theo đầu người)
- ELECTRICITY_PER_ROOM (khoán theo phòng)
- WATER_PER_M3 (đồng hồ m³)
- WATER_PER_PERSON (theo đầu người)
- WATER_PER_ROOM (khoán theo phòng)
- VEHICLE_PARKING (theo số lượng xe)
- SERVICE_PER_PERSON (dịch vụ theo người)
- INTERNET
- PARKING (khoán theo phòng)
- TRASH
- ELEVATOR (thang máy)
- CUSTOM

Invoice phải snapshot mô tả, quantity, unit_price và amount; sửa pricing hiện tại không được làm thay đổi invoice lịch sử.

## 10. Metering

Các entity chính:
- Meter
- MeterReading
- BillingCycle
- StaffAssignment

Reading có client UUID/idempotency key để offline retry không tạo duplicate.

## 11. Invoice

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

## 12. Payment

```text
PaymentTransaction
  -> PaymentAllocation
      -> Invoice
```

Không gắn một transaction trực tiếp vào một invoice vì cần hỗ trợ partial payment, nhiều transaction/1 invoice và tương lai 1 transaction/nhiều invoice.

## 13. Notification

```text
NotificationJob
  -> NotificationAttempt[]
  -> Provider Adapter
```

Mọi job đều có trạng thái và không được thất bại âm thầm.
