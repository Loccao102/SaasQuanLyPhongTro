"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AdminShell } from "../../../components/admin-shell";
import { StatusBadge } from "@propops/ui";
import {
  adminResidentsApi,
  type Resident,
  type ResidentDetailResponse,
  type UpdateResidentInput
} from "../../../lib/admin-residents-api";

const PARTY_ROLE_LABELS: Record<string, string> = {
  PRIMARY_TENANT: "Chủ thuê",
  CO_TENANT: "Đồng thuê",
  OCCUPANT: "Người ở"
};

const LEASE_STATUS_LABELS: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "error" }> = {
  ACTIVE: { label: "Đang hiệu lực", tone: "success" },
  TERMINATION_SCHEDULED: { label: "Đã lên lịch trả", tone: "warning" },
  DRAFT: { label: "Bản nháp", tone: "neutral" },
  TERMINATED: { label: "Đã kết thúc", tone: "neutral" },
  CANCELLED: { label: "Đã hủy", tone: "neutral" }
};

function EditModal({
  resident,
  onClose,
  onSaved
}: {
  resident: Resident;
  onClose: () => void;
  onSaved: (r: Resident) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const input: UpdateResidentInput = {
      fullName: String(form.get("fullName") ?? "").trim(),
      phone: String(form.get("phone") ?? "").trim() || null,
      email: String(form.get("email") ?? "").trim() || null,
      identityDocumentType:
        String(form.get("identityDocumentType") ?? "").trim() || null,
      identityDocumentNumber:
        String(form.get("identityDocumentNumber") ?? "").trim() || null,
      dateOfBirth: String(form.get("dateOfBirth") ?? "").trim() || null,
      notes: String(form.get("notes") ?? "").trim() || null
    };
    if (!input.fullName) {
      setError("Họ và tên không được để trống.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await adminResidentsApi.update(resident.id, input);
      onSaved(result.resident);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể cập nhật.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-resident-title"
    >
      <div className="modal-panel modal-panel--medium">
        <div className="modal-header">
          <h2 id="edit-resident-title" className="modal-title">
            Chỉnh sửa hồ sơ cư dân
          </h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>
        <form className="modal-body" onSubmit={(e) => void handleSubmit(e)}>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="form-row">
            <label className="form-label" htmlFor="er-fullName">
              Họ và tên <span aria-hidden>*</span>
            </label>
            <input
              ref={nameRef}
              id="er-fullName"
              name="fullName"
              className="form-input"
              type="text"
              defaultValue={resident.fullName}
              required
            />
          </div>
          <div className="form-row form-row--2col">
            <div>
              <label className="form-label" htmlFor="er-phone">Số điện thoại</label>
              <input
                id="er-phone"
                name="phone"
                className="form-input"
                type="tel"
                defaultValue={resident.phone ?? ""}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="er-email">Email</label>
              <input
                id="er-email"
                name="email"
                className="form-input"
                type="email"
                defaultValue={resident.email ?? ""}
              />
            </div>
          </div>
          <div className="form-row form-row--2col">
            <div>
              <label className="form-label" htmlFor="er-docType">Loại giấy tờ</label>
              <select
                id="er-docType"
                name="identityDocumentType"
                className="form-select"
                defaultValue={resident.identityDocumentType ?? ""}
              >
                <option value="">-- Chọn loại --</option>
                <option value="CMND">CMND</option>
                <option value="CCCD">CCCD</option>
                <option value="Hộ chiếu">Hộ chiếu</option>
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="er-docNum">Số giấy tờ</label>
              <input
                id="er-docNum"
                name="identityDocumentNumber"
                className="form-input"
                type="text"
                defaultValue={resident.identityDocumentNumber ?? ""}
              />
            </div>
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="er-dob">Ngày sinh</label>
            <input
              id="er-dob"
              name="dateOfBirth"
              className="form-input"
              type="date"
              defaultValue={resident.dateOfBirth ?? ""}
            />
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="er-notes">Ghi chú</label>
            <textarea
              id="er-notes"
              name="notes"
              className="form-input form-textarea"
              rows={2}
              defaultValue={resident.notes ?? ""}
            />
          </div>
          <div className="modal-footer">
            <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
              Hủy
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={saving}
              id="save-resident-submit"
            >
              {saving ? "Đang lưu…" : "Lưu thay đổi"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeactivateConfirm({
  resident,
  onClose,
  onDeactivated
}: {
  resident: Resident;
  onClose: () => void;
  onDeactivated: (r: Resident) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await adminResidentsApi.deactivate(resident.id);
      onDeactivated(result.resident);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Không thể vô hiệu hóa cư dân."
      );
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deactivate-resident-title"
    >
      <div className="modal-panel modal-panel--small">
        <div className="modal-header">
          <h2 id="deactivate-resident-title" className="modal-title">
            Vô hiệu hóa cư dân
          </h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>
        <div className="modal-body">
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <p>
            Bạn có chắc chắn muốn vô hiệu hóa cư dân{" "}
            <strong>{resident.fullName}</strong>?
          </p>
          <p className="form-hint">
            Hành động này không xóa dữ liệu. Cư dân vẫn có thể được tìm thấy
            trong bộ lọc &quot;Đã vô hiệu&quot;. Chỉ được vô hiệu hóa khi không
            còn hợp đồng hiệu lực.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
            Hủy
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => void handleConfirm()}
            disabled={saving}
            id="confirm-deactivate-resident-btn"
          >
            {saving ? "Đang xử lý…" : "Vô hiệu hóa"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ResidentDetailClient() {
  const params = useParams<{ residentId: string }>();
  const router = useRouter();
  const residentId = params.residentId;

  const [data, setData] = useState<ResidentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showDeactivate, setShowDeactivate] = useState(false);

  const load = useCallback(async () => {
    if (!residentId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await adminResidentsApi.detail(residentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải cư dân.");
    } finally {
      setLoading(false);
    }
  }, [residentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const resident = data?.resident;

  return (
    <AdminShell
      title={resident ? resident.fullName : "Cư dân"}
      eyebrow="CƯ DÂN"
      activeNav="Cư dân"
    >
      <div className="page-content">
        {/* Breadcrumb */}
        <nav aria-label="breadcrumb" className="breadcrumb">
          <Link href="/residents" className="breadcrumb__item">
            ← Danh sách cư dân
          </Link>
        </nav>

        {loading && (
          <div className="loading-state" role="status" aria-live="polite">
            <div className="loading-spinner" aria-hidden />
            Đang tải…
          </div>
        )}

        {!loading && error && (
          <div className="error-state" role="alert">
            <p>{error}</p>
            <button type="button" className="secondary-button" onClick={() => void load()}>
              Thử lại
            </button>
          </div>
        )}

        {!loading && !error && resident && (
          <>
            {/* Header */}
            <div className="detail-header">
              <div className="detail-header__avatar" aria-hidden>
                {resident.fullName
                  .trim()
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(-1)[0]
                  ?.charAt(0)
                  .toUpperCase() ?? "?"}
              </div>
              <div className="detail-header__info">
                <div className="detail-header__title-row">
                  <h1 className="page-title">{resident.fullName}</h1>
                  <StatusBadge
                    tone={resident.isActive ? "success" : "neutral"}
                    label={resident.isActive ? "HOẠT ĐỘNG" : "ĐÃ VÔ HIỆU"}
                  />
                </div>
                {resident.phone && (
                  <a href={`tel:${resident.phone}`} className="detail-header__contact">
                    📞 {resident.phone}
                  </a>
                )}
                {resident.email && (
                  <a href={`mailto:${resident.email}`} className="detail-header__contact">
                    ✉️ {resident.email}
                  </a>
                )}
              </div>
              <div className="detail-header__actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowEdit(true)}
                  id="edit-resident-btn"
                >
                  Chỉnh sửa
                </button>
                {resident.isActive && (
                  <button
                    type="button"
                    className="danger-button--outline"
                    onClick={() => setShowDeactivate(true)}
                    id="deactivate-resident-btn"
                  >
                    Vô hiệu hóa
                  </button>
                )}
              </div>
            </div>

            {/* Info cards */}
            <div className="detail-grid">
              {/* Personal info */}
              <section className="detail-card" aria-labelledby="personal-info-heading">
                <h2 id="personal-info-heading" className="detail-card__title">
                  Thông tin cá nhân
                </h2>
                <dl className="info-list">
                  {resident.dateOfBirth && (
                    <>
                      <dt>Ngày sinh</dt>
                      <dd>{resident.dateOfBirth}</dd>
                    </>
                  )}
                  {resident.identityDocumentType && (
                    <>
                      <dt>{resident.identityDocumentType}</dt>
                      <dd>{resident.identityDocumentNumber ?? "—"}</dd>
                    </>
                  )}
                  {resident.notes && (
                    <>
                      <dt>Ghi chú</dt>
                      <dd className="info-list__notes">{resident.notes}</dd>
                    </>
                  )}
                  <dt>Ngày tạo</dt>
                  <dd>{new Date(resident.createdAt).toLocaleDateString("vi-VN")}</dd>
                </dl>
              </section>

              {/* Lease history */}
              <section className="detail-card detail-card--wide" aria-labelledby="lease-history-heading">
                <h2 id="lease-history-heading" className="detail-card__title">
                  Lịch sử hợp đồng ({data?.leases.length ?? 0})
                </h2>
                {(data?.leases.length ?? 0) === 0 ? (
                  <p className="empty-hint">Chưa có hợp đồng nào.</p>
                ) : (
                  <div className="lease-history-list">
                    {data!.leases.map((lease) => {
                      const statusInfo = LEASE_STATUS_LABELS[lease.status] ?? {
                        label: lease.status,
                        tone: "neutral" as const
                      };
                      return (
                        <Link
                          key={lease.leaseId}
                          href={`/leases/${lease.leaseId}`}
                          className="lease-history-item"
                          aria-label={`Hợp đồng ${lease.leaseCode} — ${statusInfo.label}`}
                        >
                          <div className="lease-history-item__meta">
                            <strong>{lease.leaseCode}</strong>
                            <span className="lease-history-item__role">
                              {PARTY_ROLE_LABELS[lease.partyRole] ?? lease.partyRole}
                            </span>
                          </div>
                          <div className="lease-history-item__location">
                            {lease.roomName} ({lease.roomCode}) — {lease.propertyName}
                          </div>
                          <div className="lease-history-item__dates">
                            {lease.startDate}
                            {lease.plannedEndDate ? ` → ${lease.plannedEndDate}` : ""}
                          </div>
                          <StatusBadge tone={statusInfo.tone} label={statusInfo.label} />
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>

      {showEdit && resident && (
        <EditModal
          resident={resident}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => {
            setShowEdit(false);
            setData((prev) => prev ? { ...prev, resident: updated } : null);
          }}
        />
      )}

      {showDeactivate && resident && (
        <DeactivateConfirm
          resident={resident}
          onClose={() => setShowDeactivate(false)}
          onDeactivated={(updated) => {
            setShowDeactivate(false);
            setData((prev) => prev ? { ...prev, resident: updated } : null);
          }}
        />
      )}
    </AdminShell>
  );
}
