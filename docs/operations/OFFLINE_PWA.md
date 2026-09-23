# Staff PWA — Offline First

## UX objective

Nhân viên phải nhập điện/nước nhanh bằng một tay:
- điện mới;
- Next/Tab sang nước;
- Enter lưu;
- tự chuyển phòng tiếp theo.

## Local persistence

Dùng IndexedDB thay vì chỉ LocalStorage cho dữ liệu nghiệp vụ.

Local reading state:
- DRAFT;
- PENDING_SYNC;
- SYNCING;
- SYNCED;
- CONFLICT;
- FAILED.

Mỗi reading được tạo client UUID để server có thể xử lý retry idempotently.

## Sync

```text
Input -> IndexedDB -> PENDING_SYNC
      -> network available
      -> API upsert/idempotent command
      -> SYNCED
```

Không xóa local record trước khi server xác nhận.

## Validation

Hard error:
- current < previous.

Warning:
- consumption bất thường so với baseline.

Warning không nhất thiết chặn thao tác nhưng phải được audit/acknowledge nếu policy yêu cầu.

## Conflict

Server trả version/conflict khi reading đã được người khác chỉnh.

Không silently overwrite. UI phải cho:
- giữ server;
- dùng local với quyền phù hợp;
- admin review.

## Caching

Service worker cache app shell/static assets.

Không coi service-worker cache là persistence cho meter reading.


## Implemented baseline

The Staff PWA now uses:

- IndexedDB for cached checklists and local meter readings;
- client-generated UUIDs that remain stable across retries;
- local states DRAFT / PENDING_SYNC / SYNCING / SYNCED / CONFLICT / FAILED;
- save-local-first meter entry before any network request;
- app-shell service-worker caching without treating cache as business persistence;
- previous-reading validation and a historical-usage anomaly warning;
- structured server conflict payloads with the existing server reading;
- explicit keep-server conflict resolution; local-winning corrections remain an Admin/manual correction concern;
- Admin property-level meter-progress monitoring.

The current assignment baseline is the existing membership scope model. A separate StaffAssignment aggregate should only be introduced when operational scheduling/shift assignment must differ from authorization scope.
