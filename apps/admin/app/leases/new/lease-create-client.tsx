"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../../components/admin-shell";
import {
  adminAssetsApi,
  type AdminPropertyDetail
} from "../../../lib/admin-assets-api";
import {
  adminLeasesApi,
  type ResidentSearchResult
} from "../../../lib/admin-leases-api";

type RoomOption = {
  id: string;
  code: string;
  name: string;
  occupancy: "OCCUPIED" | "VACANT";
  propertyId: string;
  propertyName: string;
  floorName: string;
};

export function LeaseCreateClient() {
  const searchParams = useSearchParams();
  const paramRoomId = searchParams.get("roomId") ?? "";
  const paramBaseRent = searchParams.get("baseRentVnd") ?? "";
  const paramDeposit = searchParams.get("depositRequiredVnd") ?? "";

  const [properties, setProperties] = useState<AdminPropertyDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState(paramRoomId);
  const [residentQuery, setResidentQuery] = useState("");
  const [residentResults, setResidentResults] = useState<ResidentSearchResult[]>([]);
  const [selectedResident, setSelectedResident] =
    useState<ResidentSearchResult | null>(null);
  const [residentSearching, setResidentSearching] = useState(false);
  const commandIdentity = useRef<{
    leaseId: string;
    residentId: string;
    idempotencyKey: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const overview = await adminAssetsApi.overview();
        const details = await Promise.all(
          overview.properties.map((property) =>
            adminAssetsApi.property(property.id)
          )
        );
        if (active) setProperties(details);
      } catch (error) {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Không thể tải danh sách phòng."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const rooms = useMemo<RoomOption[]>(
    () =>
      properties.flatMap((property) =>
        property.floors.flatMap((floor) =>
          floor.rooms.map((room) => ({
            id: room.id,
            code: room.code,
            name: room.name,
            occupancy: room.occupancy,
            propertyId: property.property.id,
            propertyName: property.property.name,
            floorName: floor.name
          }))
        )
      ),
    [properties]
  );

  useEffect(() => {
    if (paramRoomId && !selectedRoomId && rooms.some((r) => r.id === paramRoomId)) {
      setSelectedRoomId(paramRoomId);
    }
  }, [paramRoomId, selectedRoomId, rooms]);

  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? null;

  async function searchResidents() {
    if (!selectedRoom) {
      setMutationError("Chọn phòng trước khi tìm người thuê cũ.");
      return;
    }
    if (residentQuery.trim().length < 2) {
      setMutationError("Nhập ít nhất 2 ký tự để tìm người thuê.");
      return;
    }

    setResidentSearching(true);
    setMutationError(null);
    try {
      const result = await adminLeasesApi.searchResidents(
        selectedRoom.propertyId,
        residentQuery
      );
      setResidentResults(result.residents);
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : "Không thể tìm người thuê."
      );
    } finally {
      setResidentSearching(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!commandIdentity.current) {
      commandIdentity.current = {
        leaseId: crypto.randomUUID(),
        residentId: selectedResident?.id ?? crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID()
      };
    }

    setSaving(true);
    setMutationError(null);
    try {
      const result = await adminLeasesApi.createDraft({
        ...commandIdentity.current,
        roomId: String(form.get("roomId") ?? ""),
        leaseCode: String(form.get("leaseCode") ?? ""),
        startDate: String(form.get("startDate") ?? ""),
        plannedEndDate: String(form.get("plannedEndDate") ?? "") || null,
        baseRentVnd: Number(form.get("baseRentVnd") ?? 0),
        depositRequiredVnd: Number(form.get("depositRequiredVnd") ?? 0),
        billingDay: Number(form.get("billingDay") ?? 1),
        primaryResident: selectedResident
          ? null
          : {
              fullName: String(form.get("fullName") ?? ""),
              phone: String(form.get("phone") ?? "") || null,
              email: String(form.get("email") ?? "") || null
            }
      });
      commandIdentity.current = null;
      window.location.assign("/leases/" + result.leaseId);
    } catch (error) {
      setMutationError(
        error instanceof Error
          ? error.message
          : "Không thể tạo hợp đồng nháp."
      );
      setSaving(false);
    }
  }

  return (
    <AdminShell title="Tạo hợp đồng" activeNav="Hợp đồng">
      <PageHeader
        eyebrow="LEASE.MANAGE · DRAFT"
        title="Tạo hợp đồng nháp"
        description="Hợp đồng nháp chưa chiếm dụng phòng. Có thể reuse người thuê cũ, thêm người ở và chỉnh điều khoản trước khi kích hoạt."
        action={
          <a className="secondary-link-button" href="/leases">
            ← Danh sách hợp đồng
          </a>
        }
      />

      {loadError ? (
        <div className="admin-state admin-state--error">
          <strong>Không thể tải phòng.</strong>
          <span>{loadError}</span>
        </div>
      ) : loading ? (
        <div className="admin-state">Đang tải tài sản và phòng được cấp quyền…</div>
      ) : rooms.length === 0 ? (
        <div className="admin-state">
          <strong>Chưa có phòng để tạo hợp đồng.</strong>
          <span>Hãy tạo cơ sở / tầng / phòng trước khi tạo hợp đồng.</span>
          <a className="secondary-link-button" href="/assets">Mở quản lý phòng</a>
        </div>
      ) : (
        <form className="lease-create-layout" onSubmit={(event) => void submit(event)}>
          {paramRoomId && selectedRoom ? (
            <div className="admin-state admin-state--success" style={{ gridColumn: "1 / -1", marginBottom: "8px" }}>
              <strong>Tạo hợp đồng mới thay thế cho phòng {selectedRoom.code}</strong>
              <span>Phòng: {selectedRoom.propertyName} · {selectedRoom.code}. Các thông số giá thuê và tiền cọc đã được điền sẵn từ hợp đồng trước.</span>
            </div>
          ) : null}
          <section className="panel">
            <div className="asset-section-heading">
              <div>
                <span className="eyebrow">HỢP ĐỒNG</span>
                <h2>Điều khoản cơ bản</h2>
              </div>
              <StatusBadge tone="neutral">BẢN NHÁP</StatusBadge>
            </div>
            <div className="asset-form">
              <label className="asset-form__wide">
                <span>Phòng</span>
                <select
                  name="roomId"
                  required
                  value={selectedRoomId}
                  onChange={(event) => {
                    setSelectedRoomId(event.target.value);
                    setSelectedResident(null);
                    setResidentResults([]);
                  }}
                >
                  <option value="" disabled>Chọn phòng</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.propertyName} · {room.floorName} · {room.code}
                      {room.occupancy === "OCCUPIED" ? " · đang có HĐ" : " · trống"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Mã hợp đồng</span>
                <input name="leaseCode" required placeholder="HD-2026-0001" />
              </label>
              <label>
                <span>Ngày bắt đầu</span>
                <input name="startDate" type="date" required />
              </label>
              <label>
                <span>Ngày kết thúc dự kiến</span>
                <input name="plannedEndDate" type="date" />
              </label>
              <label>
                <span>Tiền phòng / tháng (VND)</span>
                <input
                  name="baseRentVnd"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={paramBaseRent || undefined}
                  required
                />
              </label>
              <label>
                <span>Tiền cọc yêu cầu (VND)</span>
                <input
                  name="depositRequiredVnd"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={paramDeposit || "0"}
                  required
                />
              </label>
              <label>
                <span>Ngày chốt hàng tháng</span>
                <input name="billingDay" type="number" min="1" max="31" step="1" defaultValue="1" required />
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="asset-section-heading">
              <div>
                <span className="eyebrow">PRIMARY TENANT</span>
                <h2>Người thuê chính</h2>
              </div>
              {selectedResident ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setSelectedResident(null)}
                >
                  Dùng người mới
                </button>
              ) : null}
            </div>

            <div className="resident-search">
              <label>
                <span>Tìm người thuê đã có</span>
                <input
                  value={residentQuery}
                  onChange={(event) => setResidentQuery(event.target.value)}
                  placeholder="Tên, số điện thoại hoặc email"
                />
              </label>
              <button
                className="secondary-button"
                type="button"
                disabled={residentSearching || !selectedRoom}
                onClick={() => void searchResidents()}
              >
                {residentSearching ? "Đang tìm…" : "Tìm resident"}
              </button>
            </div>

            {residentResults.length > 0 && !selectedResident ? (
              <div className="resident-search-results">
                {residentResults.map((resident) => (
                  <button
                    type="button"
                    className="resident-search-result"
                    key={resident.id}
                    onClick={() => setSelectedResident(resident)}
                  >
                    <strong>{resident.fullName}</strong>
                    <span>{resident.phone ?? resident.email ?? "Chưa có liên hệ"}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {selectedResident ? (
              <div className="resident-selected">
                <StatusBadge tone="info">REUSE RESIDENT</StatusBadge>
                <div>
                  <strong>{selectedResident.fullName}</strong>
                  <span>
                    {selectedResident.phone ??
                      selectedResident.email ??
                      "Chưa có liên hệ"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="asset-form">
                <label>
                  <span>Họ tên</span>
                  <input name="fullName" required />
                </label>
                <label>
                  <span>Số điện thoại</span>
                  <input name="phone" inputMode="tel" />
                </label>
                <label>
                  <span>Email</span>
                  <input name="email" type="email" />
                </label>
              </div>
            )}
            <p className="inline-note">
              Resident cũ chỉ được tìm/reuse trong phạm vi mà membership hiện tại được phép quản lý.
            </p>
          </section>

          {mutationError ? (
            <div className="admin-state admin-state--error">
              <strong>Chưa hoàn tất thao tác.</strong>
              <span>{mutationError}</span>
              <small>
                Nếu create đã được gửi, thử lại sẽ tiếp tục dùng cùng idempotency key.
              </small>
            </div>
          ) : null}

          <section className="panel review-panel">
            <div className="asset-section-heading">
              <div>
                <span className="eyebrow">REVIEW</span>
                <h2>Tạo bản nháp trước, kích hoạt sau</h2>
              </div>
            </div>
            <ul className="consequence-list">
              <li>Resident mới và Lease được tạo trong cùng transaction; Resident cũ được reuse theo ID.</li>
              <li>Bản nháp không làm phòng chuyển sang trạng thái đang thuê.</li>
              <li>Sau khi tạo có thể sửa điều khoản và thêm CO_TENANT / OCCUPANT trước khi kích hoạt.</li>
            </ul>
            <div className="final-action">
              <div>
                <strong>Hành động hiện tại không kích hoạt hợp đồng</strong>
                <span>Bạn sẽ được xem lại chi tiết trước khi kích hoạt.</span>
              </div>
              <button className="primary-button" type="submit" disabled={saving}>
                {saving ? "Đang tạo…" : "Tạo hợp đồng nháp"}
              </button>
            </div>
          </section>
        </form>
      )}
    </AdminShell>
  );
}
