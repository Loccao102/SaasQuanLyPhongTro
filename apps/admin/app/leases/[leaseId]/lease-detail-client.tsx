"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MoneyDisplay, PageHeader, SectionHeader, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../../components/admin-shell";
import {
  adminLeasesApi,
  type LeaseDetailResponse,
  type LeaseStatus,
  type ResidentSearchResult
} from "../../../lib/admin-leases-api";

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

function auditLabel(action: string): string {
  switch (action) {
    case "LEASE_DRAFT_CREATED":
      return "Tạo hợp đồng nháp";
    case "LEASE_ACTIVATED":
      return "Kích hoạt hợp đồng";
    case "LEASE_DRAFT_CANCELLED":
      return "Hủy bản nháp";
    case "LEASE_TERMINATION_SCHEDULED":
      return "Lên lịch chấm dứt";
    case "LEASE_TERMINATION_CANCELLED":
      return "Hủy lịch chấm dứt";
    case "LEASE_TERMINATED":
      return "Hoàn tất chấm dứt";
    case "LEASE_DRAFT_UPDATED":
      return "Cập nhật bản nháp";
    case "LEASE_PARTY_ADDED":
      return "Thêm người vào hợp đồng";
    case "LEASE_PARTY_REMOVED":
      return "Xóa người khỏi hợp đồng";
    case "LEASE_TERMINATION_READINESS_OVERRIDE":
      return "Cập nhật readiness thủ công";
    default:
      return action;
  }
}

export function LeaseDetailClient({ leaseId }: { leaseId: string }) {
  const [data, setData] = useState<LeaseDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activationConfirmed, setActivationConfirmed] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [residentQuery, setResidentQuery] = useState("");
  const [residentResults, setResidentResults] = useState<ResidentSearchResult[]>([]);
  const [selectedPartyResident, setSelectedPartyResident] =
    useState<ResidentSearchResult | null>(null);
  const [residentSearching, setResidentSearching] = useState(false);
  const commandKeys = useRef<Record<string, string>>({});

  const keyFor = (action: string) => {
    commandKeys.current[action] ??= crypto.randomUUID();
    return commandKeys.current[action]!;
  };

  const clearKey = (action: string) => {
    delete commandKeys.current[action];
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminLeasesApi.detail(leaseId));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không thể tải hợp đồng."
      );
    } finally {
      setLoading(false);
    }
  }, [leaseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function activate() {
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await adminLeasesApi.activate(leaseId, keyFor("activate"));
      clearKey("activate");
      setActivationConfirmed(false);
      setActionSuccess("Hợp đồng đã được kích hoạt và phòng đã chuyển sang đang thuê.");
      await load();
    } catch (action) {
      setActionError(
        action instanceof Error ? action.message : "Không thể kích hoạt hợp đồng."
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await adminLeasesApi.updateDraft(leaseId, {
        expectedVersion: data.lease.version,
        leaseCode: String(form.get("leaseCode") ?? ""),
        startDate: String(form.get("startDate") ?? ""),
        plannedEndDate: String(form.get("plannedEndDate") ?? "") || null,
        baseRentVnd: Number(form.get("baseRentVnd") ?? 0),
        depositRequiredVnd: Number(form.get("depositRequiredVnd") ?? 0),
        billingDay: Number(form.get("billingDay") ?? 1)
      });
      setActionSuccess("Đã cập nhật điều khoản bản nháp.");
      await load();
    } catch (action) {
      setActionError(
        action instanceof Error ? action.message : "Không thể cập nhật bản nháp."
      );
    } finally {
      setSaving(false);
    }
  }

  async function searchResidents() {
    if (!data || residentQuery.trim().length < 2) return;
    setResidentSearching(true);
    setActionError(null);
    try {
      const result = await adminLeasesApi.searchResidents(
        data.lease.property.id,
        residentQuery
      );
      setResidentResults(result.residents);
    } catch (action) {
      setActionError(
        action instanceof Error ? action.message : "Không thể tìm resident."
      );
    } finally {
      setResidentSearching(false);
    }
  }

  async function addParty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await adminLeasesApi.addDraftParty(leaseId, {
        residentId: selectedPartyResident?.id ?? crypto.randomUUID(),
        partyRole: String(form.get("partyRole") ?? "OCCUPANT") as
          | "CO_TENANT"
          | "OCCUPANT",
        resident: selectedPartyResident
          ? null
          : {
              fullName: String(form.get("fullName") ?? ""),
              phone: String(form.get("phone") ?? "") || null,
              email: String(form.get("email") ?? "") || null
            }
      });
      setSelectedPartyResident(null);
      setResidentResults([]);
      setResidentQuery("");
      event.currentTarget.reset();
      setActionSuccess("Đã thêm người vào bản nháp hợp đồng.");
      await load();
    } catch (action) {
      setActionError(
        action instanceof Error ? action.message : "Không thể thêm người."
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeParty(residentId: string) {
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await adminLeasesApi.removeDraftParty(leaseId, residentId);
      setActionSuccess("Đã xóa người khỏi bản nháp hợp đồng.");
      await load();
    } catch (action) {
      setActionError(
        action instanceof Error ? action.message : "Không thể xóa người."
      );
    } finally {
      setSaving(false);
    }
  }

  async function cancelDraft() {
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await adminLeasesApi.cancelDraft(leaseId, keyFor("cancel-draft"));
      clearKey("cancel-draft");
      setCancelConfirmOpen(false);
      setCancelConfirmed(false);
      setActionSuccess("Bản nháp đã được hủy. Lịch sử hợp đồng vẫn được giữ.");
      await load();
    } catch (action) {
      setActionError(
        action instanceof Error ? action.message : "Không thể hủy bản nháp."
      );
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <AdminShell title="Chi tiết hợp đồng" activeNav="Hợp đồng">
        <a className="back-link" href="/leases">← Danh sách hợp đồng</a>
        <div className="admin-state admin-state--error">
          <strong>Không thể tải hợp đồng.</strong>
          <span>{error}</span>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            Thử lại
          </button>
        </div>
      </AdminShell>
    );
  }

  if (loading || !data) {
    return (
      <AdminShell title="Chi tiết hợp đồng" activeNav="Hợp đồng">
        <div className="admin-state">Đang tải hợp đồng…</div>
      </AdminShell>
    );
  }

  const lease = data.lease;
  const meta = statusMeta(lease.status);

  return (
    <AdminShell title={"Hợp đồng " + lease.code} activeNav="Hợp đồng">
      <PageHeader
        eyebrow={lease.property.name + " · PHÒNG " + lease.room.code}
        title={lease.primaryResident?.fullName ?? lease.code}
        description="Lease giữ lịch sử độc lập; thay người thuê hoặc trả phòng không sửa/xóa hợp đồng cũ."
        action={
          <div className="button-row">
            <a className="secondary-link-button" href="/leases">← Danh sách</a>
            {data.permissions.terminate &&
            (lease.status === "ACTIVE" || lease.status === "TERMINATION_SCHEDULED") ? (
              <a className="danger-link-button" href={"/leases/" + lease.id + "/terminate"}>
                {lease.status === "ACTIVE" ? "Chấm dứt hợp đồng" : "Mở quy trình trả phòng"}
              </a>
            ) : null}
          </div>
        }
      />

      {actionError ? (
        <div className="admin-state admin-state--error">
          <strong>Hành động chưa hoàn tất.</strong>
          <span>{actionError}</span>
          <small>Thử lại sẽ dùng cùng idempotency key của hành động này.</small>
        </div>
      ) : null}
      {actionSuccess ? (
        <div className="admin-state admin-state--success">
          <strong>Đã cập nhật hợp đồng.</strong>
          <span>{actionSuccess}</span>
        </div>
      ) : null}

      <section className="lease-detail-grid">
        <article className="panel">
          <SectionHeader
            title="Thông tin hợp đồng"
            action={<StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>}
          />
          <dl className="detail-list">
            <div><dt>Mã hợp đồng</dt><dd>{lease.code}</dd></div>
            <div><dt>Cơ sở / phòng</dt><dd>{lease.property.name} · {lease.room.code}</dd></div>
            <div><dt>Ngày bắt đầu</dt><dd>{lease.startDate}</dd></div>
            <div><dt>Ngày kết thúc dự kiến</dt><dd>{lease.plannedEndDate ?? "Không thời hạn"}</dd></div>
            <div><dt>Ngày chốt hàng tháng</dt><dd>Ngày {lease.billingDay}</dd></div>
            <div><dt>Phiên bản</dt><dd>v{lease.version}</dd></div>
          </dl>
        </article>

        <article className="panel">
          <SectionHeader title="Điều khoản tiền" />
          <dl className="detail-list">
            <div><dt>Tiền phòng cơ bản</dt><dd><MoneyDisplay amountVnd={lease.baseRentVnd} /> / tháng</dd></div>
            <div><dt>Tiền cọc yêu cầu</dt><dd><MoneyDisplay amountVnd={lease.depositRequiredVnd} /></dd></div>
            <div><dt>Trạng thái cọc thực tế</dt><dd><StatusBadge tone="neutral">CHỜ PAYMENT/SETTLEMENT</StatusBadge></dd></div>
          </dl>
          <p className="inline-note">
            Lease chỉ lưu điều khoản. Thu/hoàn/khấu trừ tiền cọc sẽ thuộc Payment/Settlement và có audit riêng.
          </p>
        </article>
      </section>

      {lease.status === "DRAFT" && data.permissions.manage ? (
        <section className="lease-draft-edit-grid">
          <article className="panel">
            <SectionHeader title="Chỉnh điều khoản bản nháp" />
            <form className="asset-form" onSubmit={(event) => void updateDraft(event)}>
              <label>
                <span>Mã hợp đồng</span>
                <input name="leaseCode" defaultValue={lease.code} required />
              </label>
              <label>
                <span>Ngày bắt đầu</span>
                <input name="startDate" type="date" defaultValue={lease.startDate} required />
              </label>
              <label>
                <span>Ngày kết thúc dự kiến</span>
                <input name="plannedEndDate" type="date" defaultValue={lease.plannedEndDate ?? ""} />
              </label>
              <label>
                <span>Tiền phòng / tháng</span>
                <input name="baseRentVnd" type="number" min="0" step="1" defaultValue={lease.baseRentVnd} required />
              </label>
              <label>
                <span>Tiền cọc yêu cầu</span>
                <input name="depositRequiredVnd" type="number" min="0" step="1" defaultValue={lease.depositRequiredVnd} required />
              </label>
              <label>
                <span>Ngày chốt</span>
                <input name="billingDay" type="number" min="1" max="31" defaultValue={lease.billingDay} required />
              </label>
              <div className="button-row asset-form__wide">
                <button className="primary-button" type="submit" disabled={saving}>
                  Lưu bản nháp
                </button>
              </div>
            </form>
            <p className="inline-note">
              Dùng version hiện tại để chống ghi đè khi hai người cùng sửa draft.
            </p>
          </article>

          <article className="panel">
            <SectionHeader title="Thêm người ở / đồng thuê" />
            <div className="resident-search">
              <label>
                <span>Tìm resident cũ</span>
                <input
                  value={residentQuery}
                  onChange={(event) => setResidentQuery(event.target.value)}
                  placeholder="Tên, điện thoại hoặc email"
                />
              </label>
              <button
                className="secondary-button"
                type="button"
                disabled={residentSearching || residentQuery.trim().length < 2}
                onClick={() => void searchResidents()}
              >
                {residentSearching ? "Đang tìm…" : "Tìm"}
              </button>
            </div>

            {residentResults.length > 0 && !selectedPartyResident ? (
              <div className="resident-search-results">
                {residentResults.map((resident) => (
                  <button
                    className="resident-search-result"
                    type="button"
                    key={resident.id}
                    onClick={() => setSelectedPartyResident(resident)}
                  >
                    <strong>{resident.fullName}</strong>
                    <span>{resident.phone ?? resident.email ?? "Chưa có liên hệ"}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <form className="asset-form" onSubmit={(event) => void addParty(event)}>
              <label>
                <span>Vai trò</span>
                <select name="partyRole" defaultValue="OCCUPANT">
                  <option value="CO_TENANT">Đồng thuê</option>
                  <option value="OCCUPANT">Người ở</option>
                </select>
              </label>
              {selectedPartyResident ? (
                <div className="resident-selected asset-form__wide">
                  <StatusBadge tone="info">REUSE RESIDENT</StatusBadge>
                  <div>
                    <strong>{selectedPartyResident.fullName}</strong>
                    <span>{selectedPartyResident.phone ?? selectedPartyResident.email ?? "Chưa có liên hệ"}</span>
                  </div>
                  <button className="secondary-button" type="button" onClick={() => setSelectedPartyResident(null)}>
                    Đổi người
                  </button>
                </div>
              ) : (
                <>
                  <label>
                    <span>Họ tên người mới</span>
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
                </>
              )}
              <div className="button-row asset-form__wide">
                <button className="primary-button" type="submit" disabled={saving}>
                  + Thêm vào hợp đồng
                </button>
              </div>
            </form>
          </article>
        </section>
      ) : null}

      {lease.status === "DRAFT" && data.permissions.manage ? (
        <section className="panel review-panel">
          <SectionHeader title="Kích hoạt hợp đồng" />
          <ul className="consequence-list">
            <li>Lease chuyển từ DRAFT sang ACTIVE.</li>
            <li>Phòng {lease.room.code} bắt đầu được xem là đang thuê.</li>
            <li>Database từ chối nếu phòng đã có một Lease ACTIVE/TERMINATION_SCHEDULED khác.</li>
            <li>Không tự động thu tiền hoặc tạo giao dịch thanh toán.</li>
          </ul>
          <label className="confirm-check">
            <input
              type="checkbox"
              checked={activationConfirmed}
              onChange={(event) => setActivationConfirmed(event.target.checked)}
            />
            <span>Tôi đã kiểm tra phòng, người thuê và điều khoản hợp đồng.</span>
          </label>
          <div className="final-action">
            <div>
              <strong>Kích hoạt sẽ làm hợp đồng có hiệu lực</strong>
              <span>Hành động được audit và idempotent.</span>
            </div>
            <div className="button-row">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setCancelConfirmOpen(true)}
                disabled={saving}
              >
                Hủy bản nháp
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void activate()}
                disabled={saving || !activationConfirmed}
              >
                Kích hoạt hợp đồng
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {cancelConfirmOpen && lease.status === "DRAFT" ? (
        <section className="destructive-banner">
          <div>
            <strong>Hủy bản nháp {lease.code}?</strong>
            <p>
              Lease chuyển sang CANCELLED và không thể kích hoạt lại bằng lifecycle hiện tại.
              Resident và audit history không bị xóa.
            </p>
            <label className="confirm-check">
              <input
                type="checkbox"
                checked={cancelConfirmed}
                onChange={(event) => setCancelConfirmed(event.target.checked)}
              />
              <span>Tôi hiểu bản nháp sẽ chuyển sang trạng thái đã hủy.</span>
            </label>
          </div>
          <div className="button-row">
            <button className="secondary-button" type="button" onClick={() => setCancelConfirmOpen(false)}>
              Giữ bản nháp
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={saving || !cancelConfirmed}
              onClick={() => void cancelDraft()}
            >
              Hủy bản nháp
            </button>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <SectionHeader
          title="Người ở / bên thuê"
          action={<span className="scope-label">lease.read · property scope</span>}
        />
        {data.parties.length === 0 ? (
          <div className="admin-state">Chưa có bên thuê trên hợp đồng.</div>
        ) : (
          data.parties.map((party) => (
            <div className="resident-row" key={party.residentId}>
              <div className="resident-avatar">
                {party.fullName
                  .split(" ")
                  .slice(-2)
                  .map((part) => part[0])
                  .join("")
                  .toUpperCase()}
              </div>
              <div>
                <strong>{party.fullName}</strong>
                <span>{party.phone ?? party.email ?? "Chưa có liên hệ"}</span>
              </div>
              <div className="button-row">
                <StatusBadge tone={party.role === "PRIMARY_TENANT" ? "info" : "neutral"}>
                  {party.role}
                </StatusBadge>
                {lease.status === "DRAFT" &&
                data.permissions.manage &&
                party.role !== "PRIMARY_TENANT" ? (
                  <button
                    className="secondary-button secondary-button--compact"
                    type="button"
                    disabled={saving}
                    onClick={() => void removeParty(party.residentId)}
                  >
                    Xóa
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </section>

      {data.termination ? (
        <section className="panel">
          <SectionHeader title="Quy trình trả phòng gần nhất" />
          <dl className="detail-list">
            <div><dt>Trạng thái</dt><dd>{data.termination.status}</dd></div>
            <div><dt>Ngày hiệu lực</dt><dd>{data.termination.effectiveDate ?? "—"}</dd></div>
            <div><dt>Lý do</dt><dd>{data.termination.reason}</dd></div>
            <div><dt>Meter</dt><dd>{data.termination.readiness.meter}</dd></div>
            <div><dt>Công nợ</dt><dd>{data.termination.readiness.financial}</dd></div>
            <div><dt>Tiền cọc</dt><dd>{data.termination.readiness.deposit}</dd></div>
          </dl>
        </section>
      ) : null}

      <section className="panel">
        <SectionHeader title="Lịch sử hợp đồng" />
        {data.audit.length === 0 ? (
          <div className="admin-state">Chưa có audit event cho hợp đồng này.</div>
        ) : (
          <ol className="timeline">
            {data.audit.map((item, index) => (
              <li key={item.action + item.occurredAt + String(index)}>
                <span className={"timeline__dot" + (index > 0 ? " timeline__dot--muted" : "")} />
                <div>
                  <strong>{auditLabel(item.action)}</strong>
                  <span>{new Date(item.occurredAt).toLocaleString("vi-VN")}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </AdminShell>
  );
}
