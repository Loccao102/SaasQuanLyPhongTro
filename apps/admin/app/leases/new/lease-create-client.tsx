"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { PageHeader, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../../components/admin-shell";
import {
  adminAssetsApi,
  type AdminPropertyDetail
} from "../../../lib/admin-assets-api";
import { adminLeasesApi } from "../../../lib/admin-leases-api";

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
  const [properties, setProperties] = useState<AdminPropertyDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!commandIdentity.current) {
      commandIdentity.current = {
        leaseId: crypto.randomUUID(),
        residentId: crypto.randomUUID(),
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
        primaryResident: {
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
        description="Hợp đồng nháp chưa chiếm dụng phòng. Sau khi kiểm tra điều khoản và người thuê, kích hoạt là một domain transition riêng."
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
                <select name="roomId" required defaultValue="">
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
                <input name="baseRentVnd" type="number" min="0" step="1" required />
              </label>
              <label>
                <span>Tiền cọc yêu cầu (VND)</span>
                <input name="depositRequiredVnd" type="number" min="0" step="1" defaultValue="0" required />
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
            </div>
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
            <p className="inline-note">
              Slice hiện tại tạo Resident mới cùng hợp đồng. Workflow tìm/chọn Resident
              đã tồn tại sẽ được bổ sung khi hoàn thiện module cư dân.
            </p>
          </section>

          {mutationError ? (
            <div className="admin-state admin-state--error">
              <strong>Chưa tạo được hợp đồng.</strong>
              <span>{mutationError}</span>
              <small>
                Dữ liệu trên form vẫn được giữ. Thử lại sẽ dùng cùng idempotency key.
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
              <li>Tạo Lease và người thuê chính trong cùng transaction.</li>
              <li>Bản nháp không làm phòng chuyển sang trạng thái đang thuê.</li>
              <li>Kích hoạt sau đó sẽ kiểm tra quyền, trạng thái và ràng buộc một hợp đồng hiện hành mỗi phòng.</li>
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
