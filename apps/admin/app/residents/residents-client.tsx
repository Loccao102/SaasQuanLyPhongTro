"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react";
import Link from "next/link";
import { AdminShell } from "../../components/admin-shell";
import { StatusBadge } from "@propops/ui";
import {
  adminResidentsApi,
  type CreateResidentInput,
  type Resident,
  type ResidentListResponse
} from "../../lib/admin-residents-api";

function ResidentCard({ resident }: { resident: Resident }) {
  return (
    <Link
      href={`/residents/${resident.id}`}
      className="resident-card"
      aria-label={`Xem chi tiết cư dân ${resident.fullName}`}
    >
      <div className="resident-card__avatar" aria-hidden>
        {resident.fullName
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(-1)[0]
          ?.charAt(0)
          .toUpperCase() ?? "?"}
      </div>
      <div className="resident-card__body">
        <div className="resident-card__name">{resident.fullName}</div>
        {resident.phone && (
          <div className="resident-card__meta">{resident.phone}</div>
        )}
        {resident.email && (
          <div className="resident-card__meta">{resident.email}</div>
        )}
        {resident.identityDocumentNumber && (
          <div className="resident-card__meta resident-card__meta--id">
            <span className="resident-card__doc-label">
              {resident.identityDocumentType ?? "CMND/CCCD"}:
            </span>{" "}
            {resident.identityDocumentNumber}
          </div>
        )}
      </div>
      <div className="resident-card__aside">
        <StatusBadge
          tone={resident.isActive ? "success" : "neutral"}
          label={resident.isActive ? "HOẠT ĐỘNG" : "ĐÃ VÔ HIỆU"}
        />
        <span className="resident-card__chevron" aria-hidden>
          ›
        </span>
      </div>
    </Link>
  );
}

function CreateModal({
  onClose,
  onCreated
}: {
  onClose: () => void;
  onCreated: (r: Resident) => void;
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
    const input: CreateResidentInput = {
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
      const result = await adminResidentsApi.create(input);
      onCreated(result.resident);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Không thể tạo cư dân."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-resident-title"
    >
      <div className="modal-panel modal-panel--medium">
        <div className="modal-header">
          <h2 id="create-resident-title" className="modal-title">
            Thêm cư dân mới
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Đóng"
          >
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
            <label className="form-label" htmlFor="cr-fullName">
              Họ và tên <span aria-hidden>*</span>
            </label>
            <input
              ref={nameRef}
              id="cr-fullName"
              name="fullName"
              className="form-input"
              type="text"
              placeholder="Nguyễn Văn A"
              required
              autoComplete="name"
            />
          </div>
          <div className="form-row form-row--2col">
            <div>
              <label className="form-label" htmlFor="cr-phone">
                Số điện thoại
              </label>
              <input
                id="cr-phone"
                name="phone"
                className="form-input"
                type="tel"
                placeholder="0901234567"
                autoComplete="tel"
              />
            </div>
            <div>
              <label className="form-label" htmlFor="cr-email">
                Email
              </label>
              <input
                id="cr-email"
                name="email"
                className="form-input"
                type="email"
                placeholder="example@gmail.com"
                autoComplete="email"
              />
            </div>
          </div>
          <div className="form-row form-row--2col">
            <div>
              <label className="form-label" htmlFor="cr-docType">
                Loại giấy tờ
              </label>
              <select id="cr-docType" name="identityDocumentType" className="form-select">
                <option value="">-- Chọn loại --</option>
                <option value="CMND">CMND</option>
                <option value="CCCD">CCCD</option>
                <option value="Hộ chiếu">Hộ chiếu</option>
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="cr-docNum">
                Số giấy tờ
              </label>
              <input
                id="cr-docNum"
                name="identityDocumentNumber"
                className="form-input"
                type="text"
                placeholder="0123456789"
              />
            </div>
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="cr-dob">
              Ngày sinh
            </label>
            <input
              id="cr-dob"
              name="dateOfBirth"
              className="form-input"
              type="date"
            />
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="cr-notes">
              Ghi chú
            </label>
            <textarea
              id="cr-notes"
              name="notes"
              className="form-input form-textarea"
              rows={2}
              placeholder="Thông tin thêm..."
            />
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={saving}
            >
              Hủy
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={saving}
              id="create-resident-submit"
            >
              {saving ? "Đang lưu…" : "Tạo cư dân"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ResidentsClient() {
  const [data, setData] = useState<ResidentListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isActive, setIsActive] = useState<"ALL" | "ACTIVE" | "INACTIVE">(
    "ACTIVE"
  );
  const [showCreate, setShowCreate] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (q: string, activeFilter: "ALL" | "ACTIVE" | "INACTIVE") => {
      setLoading(true);
      setError(null);
      try {
        const result = await adminResidentsApi.list({
          q: q.trim() || undefined,
          isActive:
            activeFilter === "ACTIVE"
              ? true
              : activeFilter === "INACTIVE"
                ? false
                : undefined
        });
        setData(result);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Không thể tải danh sách cư dân."
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void load(query, isActive);
    }, 300);
    return () => clearTimeout(timer);
  }, [load, query, isActive]);

  const handleCreated = (resident: Resident) => {
    setShowCreate(false);
    void load(query, isActive);
    // Optimistic add for UX
    setData((prev) =>
      prev
        ? { ...prev, residents: [resident, ...prev.residents] }
        : { residents: [resident], hasMore: false, nextCursor: null }
    );
  };

  const totalCount = data?.residents.length ?? 0;

  return (
    <AdminShell title="Cư dân" activeNav="Cư dân">
      <div className="page-content">
        <div className="page-header">
          <div className="page-header__text">
            <h1 className="page-title">Cư dân</h1>
            <p className="page-subtitle">
              Quản lý hồ sơ cư dân và lịch sử hợp đồng
            </p>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={() => setShowCreate(true)}
            id="add-resident-btn"
          >
            + Thêm cư dân
          </button>
        </div>

        {/* Filters */}
        <div className="filter-bar">
          <div className="filter-bar__search">
            <label htmlFor="residents-search" className="sr-only">
              Tìm kiếm cư dân
            </label>
            <input
              ref={searchRef}
              id="residents-search"
              type="search"
              className="form-input filter-bar__search-input"
              placeholder="Tìm theo tên, SĐT, email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="filter-bar__tabs" role="group" aria-label="Trạng thái">
            {(
              [
                ["ACTIVE", "Đang hoạt động"],
                ["INACTIVE", "Đã vô hiệu"],
                ["ALL", "Tất cả"]
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`filter-tab${isActive === value ? " filter-tab--active" : ""}`}
                onClick={() => setIsActive(value)}
                aria-pressed={isActive === value}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        {loading && (
          <div className="loading-state" role="status" aria-live="polite">
            <div className="loading-spinner" aria-hidden />
            Đang tải…
          </div>
        )}

        {!loading && error && (
          <div className="error-state" role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void load(query, isActive)}
            >
              Thử lại
            </button>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {data.residents.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state__icon" aria-hidden>
                  👤
                </div>
                <p className="empty-state__title">
                  {query.trim()
                    ? "Không tìm thấy cư dân phù hợp"
                    : "Chưa có cư dân nào"}
                </p>
                {!query.trim() && (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => setShowCreate(true)}
                  >
                    + Thêm cư dân đầu tiên
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="list-meta" aria-live="polite">
                  {totalCount} cư dân
                  {data.hasMore ? "+" : ""}
                </div>
                <div className="residents-list" role="list">
                  {data.residents.map((r) => (
                    <div key={r.id} role="listitem">
                      <ResidentCard resident={r} />
                    </div>
                  ))}
                </div>
                {data.hasMore && (
                  <div className="load-more-row">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        // TODO: implement load more with cursor
                      }}
                    >
                      Tải thêm
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </AdminShell>
  );
}
