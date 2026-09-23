"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MetricCard, MoneyDisplay, PageHeader, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../components/admin-shell";
import {
  adminLeasesApi,
  type LeaseListResponse,
  type LeaseStatus
} from "../../lib/admin-leases-api";

function statusMeta(status: LeaseStatus) {
  switch (status) {
    case "ACTIVE":
      return { label: "ĐANG HIỆU LỰC", tone: "success" as const };
    case "TERMINATION_SCHEDULED":
      return { label: "ĐÃ LÊN LỊCH TRẢ", tone: "warning" as const };
    case "DRAFT":
      return { label: "BẢN NHÁP", tone: "neutral" as const };
    case "TERMINATED":
      return { label: "ĐÃ KẾT THÚC", tone: "neutral" as const };
    case "CANCELLED":
      return { label: "ĐÃ HỦY", tone: "neutral" as const };
  }
}

export function LeasesClient() {
  const [data, setData] = useState<LeaseListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("CURRENT");
  const [propertyId, setPropertyId] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminLeasesApi.list());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không thể tải danh sách hợp đồng."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const properties = useMemo(() => {
    if (!data) return [];
    const byId = new Map<string, { id: string; name: string }>();
    for (const lease of data.leases) {
      byId.set(lease.property.id, {
        id: lease.property.id,
        name: lease.property.name
      });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, [data]);

  const leases = useMemo(() => {
    if (!data) return [];
    const normalized = query.trim().toLocaleLowerCase("vi");
    return data.leases.filter((lease) => {
      if (
        status === "CURRENT" &&
        lease.status !== "ACTIVE" &&
        lease.status !== "TERMINATION_SCHEDULED" &&
        lease.status !== "DRAFT"
      ) {
        return false;
      }
      if (status !== "CURRENT" && status !== "ALL" && lease.status !== status) {
        return false;
      }
      if (propertyId !== "ALL" && lease.property.id !== propertyId) {
        return false;
      }
      if (!normalized) return true;
      const haystack = [
        lease.code,
        lease.property.name,
        lease.room.code,
        lease.room.name,
        lease.primaryResident?.fullName ?? "",
        lease.primaryResident?.phone ?? ""
      ]
        .join(" ")
        .toLocaleLowerCase("vi");
      return haystack.includes(normalized);
    });
  }, [data, propertyId, query, status]);

  return (
    <AdminShell title="Hợp đồng" activeNav="Hợp đồng">
      <PageHeader
        eyebrow="RESIDENTS & LEASES · LIVE DATA"
        title="Quản lý hợp đồng thuê"
        description="Theo dõi hợp đồng hiện tại, lịch sử người thuê và các workflow kích hoạt / trả phòng theo đúng property scope."
        action={
          <a className="primary-button" href="/leases/new">
            + Tạo hợp đồng
          </a>
        }
      />

      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Không thể tải hợp đồng.</strong>
          <span>{error}</span>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            Thử lại
          </button>
        </div>
      ) : loading || !data ? (
        <div className="admin-state">Đang tải hợp đồng trong phạm vi được cấp…</div>
      ) : (
        <>
          <section className="metrics-grid" aria-label="Tình trạng hợp đồng">
            <MetricCard label="Đang hiệu lực" value={String(data.summary.active)} detail="Đang chiếm dụng phòng" tone="success" />
            <MetricCard label="Đã lên lịch trả" value={String(data.summary.terminationScheduled)} detail="Đang chờ readiness quyết toán" tone="warning" />
            <MetricCard label="Bản nháp" value={String(data.summary.draft)} detail="Chưa kích hoạt / chưa chiếm phòng" tone="neutral" />
            <MetricCard label="Đã kết thúc" value={String(data.summary.terminated)} detail="Lịch sử được giữ nguyên" tone="neutral" />
          </section>

          <section className="panel">
            <div className="lease-toolbar">
              <div className="lease-search">
                <label htmlFor="lease-search">Tìm hợp đồng</label>
                <input
                  id="lease-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Mã HĐ, phòng hoặc người thuê"
                />
              </div>
              <label className="compact-field">
                <span>Trạng thái</span>
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="CURRENT">Đang hiện hành</option>
                  <option value="ACTIVE">Đang hiệu lực</option>
                  <option value="TERMINATION_SCHEDULED">Đã lên lịch trả</option>
                  <option value="DRAFT">Bản nháp</option>
                  <option value="TERMINATED">Đã kết thúc</option>
                  <option value="CANCELLED">Đã hủy</option>
                  <option value="ALL">Tất cả</option>
                </select>
              </label>
              <label className="compact-field">
                <span>Cơ sở</span>
                <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
                  <option value="ALL">Tất cả cơ sở</option>
                  {properties.map((property) => (
                    <option value={property.id} key={property.id}>
                      {property.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {leases.length === 0 ? (
              <div className="admin-state">
                <strong>Không có hợp đồng phù hợp.</strong>
                <span>Thử bỏ bộ lọc hoặc tạo một hợp đồng nháp mới.</span>
              </div>
            ) : (
              <div className="lease-table" role="table" aria-label="Danh sách hợp đồng">
                <div className="lease-table__row lease-table__head" role="row">
                  <span role="columnheader">Hợp đồng</span>
                  <span role="columnheader">Phòng</span>
                  <span role="columnheader">Người thuê chính</span>
                  <span role="columnheader">Thời hạn</span>
                  <span role="columnheader">Tiền phòng</span>
                  <span role="columnheader">Trạng thái</span>
                  <span aria-hidden="true" />
                </div>

                {leases.map((lease) => {
                  const meta = statusMeta(lease.status);
                  return (
                    <a
                      className="lease-table__row"
                      href={"/leases/" + lease.id}
                      role="row"
                      key={lease.id}
                    >
                      <span role="cell">
                        <strong>{lease.code}</strong>
                        <small>{lease.property.name}</small>
                      </span>
                      <strong role="cell">{lease.room.code}</strong>
                      <span role="cell">
                        <strong>{lease.primaryResident?.fullName ?? "Chưa gán"}</strong>
                        <small>{lease.primaryResident?.phone ?? "—"}</small>
                      </span>
                      <span role="cell">
                        <strong>{lease.startDate}</strong>
                        <small>đến {lease.plannedEndDate ?? "Không thời hạn"}</small>
                      </span>
                      <strong role="cell">
                        <MoneyDisplay amountVnd={lease.baseRentVnd} />
                      </strong>
                      <span role="cell">
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                      </span>
                      <span role="cell" aria-hidden="true">→</span>
                    </a>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </AdminShell>
  );
}
