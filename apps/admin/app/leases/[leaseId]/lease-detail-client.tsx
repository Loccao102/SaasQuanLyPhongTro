"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MoneyDisplay, PageHeader, SectionHeader, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../../components/admin-shell";
import {
  adminLeasesApi,
  type LeaseAmendment,
  type LeaseAttachment,
  type LeaseDepositSummary,
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

function depositStatusMeta(status: LeaseDepositSummary["status"]) {
  switch (status) {
    case "NOT_REQUIRED":
      return { label: "KHÔNG YÊU CẦU", tone: "neutral" as const };
    case "UNPAID":
      return { label: "CHƯA THU", tone: "warning" as const };
    case "PARTIALLY_HELD":
      return { label: "ĐÃ THU MỘT PHẦN", tone: "warning" as const };
    case "HELD":
      return { label: "ĐANG GIỮ CỌC", tone: "success" as const };
    case "SETTLED":
      return { label: "ĐÃ TẤT TOÁN", tone: "success" as const };
  }
}

function attachmentTypeMeta(type: string) {
  switch (type) {
    case "CITIZEN_ID_FRONT":
      return { label: "CCCD MẶT TRƯỚC", tone: "info" as const };
    case "CITIZEN_ID_BACK":
      return { label: "CCCD MẶT SAU", tone: "info" as const };
    case "HANDOVER_MINUTES":
      return { label: "BIÊN BẢN BÀN GIAO", tone: "success" as const };
    case "CONTRACT_SCAN":
      return { label: "BẢN SCAN HỢP ĐỒNG", tone: "neutral" as const };
    default:
      return { label: "TÀI LIỆU KHÁC", tone: "neutral" as const };
  }
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatVnd(amount: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(amount);
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
    case "LEASE_PRIMARY_TENANT_REPLACED":
      return "Đổi người thuê chính";
    case "LEASE_TERMINATION_READINESS_OVERRIDE":
      return "Cập nhật readiness thủ công";
    case "LEASE_TERMINATION_METER_READINESS_SYNCED":
      return "Đồng bộ chỉ số cuối trả phòng";
    case "LEASE_DEPOSIT_COLLECTED":
      return "Ghi nhận thu tiền cọc";
    case "LEASE_DEPOSIT_SETTLED":
      return "Tất toán tiền cọc";
    case "LEASE_RENEWAL_DRAFT_CREATED":
      return "Tạo bản nháp gia hạn hợp đồng";
    case "LEASE_ATTACHMENT_ADDED":
      return "Thêm tệp đính kèm";
    case "LEASE_ATTACHMENT_REMOVED":
      return "Xóa tệp đính kèm";
    case "LEASE_AMENDED":
      return "Ký phụ lục hợp đồng";
    default:
      return action;
  }
}

export function LeaseDetailClient({ leaseId }: { leaseId: string }) {
  const [data, setData] = useState<LeaseDetailResponse | null>(null);
  const [deposit, setDeposit] = useState<LeaseDepositSummary | null>(null);
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
  const [primaryResidentQuery, setPrimaryResidentQuery] = useState("");
  const [primaryResidentResults, setPrimaryResidentResults] =
    useState<ResidentSearchResult[]>([]);
  const [selectedPrimaryResident, setSelectedPrimaryResident] =
    useState<ResidentSearchResult | null>(null);
  const [primaryResidentSearching, setPrimaryResidentSearching] =
    useState(false);
  const [primaryReplacementConfirmed, setPrimaryReplacementConfirmed] =
    useState(false);
  const [renewalModalOpen, setRenewalModalOpen] = useState(false);
  const [renewalConfirmed, setRenewalConfirmed] = useState(false);
  const [attachments, setAttachments] = useState<LeaseAttachment[]>([]);
  const [amendments, setAmendments] = useState<LeaseAmendment[]>([]);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [amendmentModalOpen, setAmendmentModalOpen] = useState(false);
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
      const [leaseData, depositData, attachmentData, amendmentData] = await Promise.all([
        adminLeasesApi.detail(leaseId),
        adminLeasesApi.deposit(leaseId),
        adminLeasesApi.attachments(leaseId),
        adminLeasesApi.amendments(leaseId)
      ]);
      setData(leaseData);
      setDeposit(depositData);
      setAttachments(attachmentData.attachments);
      setAmendments(amendmentData.amendments);
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

  async function searchPrimaryResidents() {
    if (!data || primaryResidentQuery.trim().length < 2) return;
    setPrimaryResidentSearching(true);
    setActionError(null);
    try {
      const result = await adminLeasesApi.searchResidents(
        data.lease.property.id,
        primaryResidentQuery
      );
      setPrimaryResidentResults(
        result.residents.filter(
          (resident) =>
            resident.id !== data.lease.primaryResident?.id
        )
      );
    } catch (action) {
      setActionError(
        action instanceof Error
          ? action.message
          : "Không thể tìm resident."
      );
    } finally {
      setPrimaryResidentSearching(false);
    }
  }

  async function replacePrimaryTenant(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    if (!data) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await adminLeasesApi.replaceDraftPrimaryTenant(leaseId, {
        expectedVersion: data.lease.version,
        idempotencyKey: keyFor("replace-primary"),
        residentId:
          selectedPrimaryResident?.id ?? crypto.randomUUID(),
        previousPrimaryDisposition: String(
          form.get("previousPrimaryDisposition") ?? "REMOVE"
        ) as "REMOVE" | "CO_TENANT" | "OCCUPANT",
        resident: selectedPrimaryResident
          ? null
          : {
              fullName: String(form.get("fullName") ?? ""),
              phone: String(form.get("phone") ?? "") || null,
              email: String(form.get("email") ?? "") || null
            }
      });
      clearKey("replace-primary");
      setSelectedPrimaryResident(null);
      setPrimaryResidentResults([]);
      setPrimaryResidentQuery("");
      setPrimaryReplacementConfirmed(false);
      event.currentTarget.reset();
      setActionSuccess(
        "Đã đổi người thuê chính trên bản nháp hợp đồng."
      );
      await load();
    } catch (action) {
      setActionError(
        action instanceof Error
          ? action.message
          : "Không thể đổi người thuê chính."
      );
    } finally {
      setSaving(false);
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

  async function recordDepositCollection(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    if (!deposit) return;
    const form = new FormData(event.currentTarget);
    const occurredAt = new Date(String(form.get("occurredAt") ?? ""));
    if (Number.isNaN(occurredAt.getTime())) {
      setActionError("Thời điểm thu cọc không hợp lệ.");
      return;
    }

    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await adminLeasesApi.recordDepositCollection(leaseId, {
        idempotencyKey: keyFor("deposit-collection"),
        amountVnd: Number(form.get("amountVnd") ?? 0),
        occurredAt: occurredAt.toISOString(),
        note: String(form.get("note") ?? "") || null
      });
      clearKey("deposit-collection");
      event.currentTarget.reset();
      setActionSuccess("Đã ghi nhận khoản thu tiền cọc.");
      await load();
    } catch (action) {
      setActionError(
        action instanceof Error
          ? action.message
          : "Không thể ghi nhận tiền cọc."
      );
    } finally {
      setSaving(false);
    }
  }

  async function settleDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deposit) return;
    const form = new FormData(event.currentTarget);
    const occurredAt = new Date(String(form.get("occurredAt") ?? ""));
    if (Number.isNaN(occurredAt.getTime())) {
      setActionError("Thời điểm tất toán cọc không hợp lệ.");
      return;
    }

    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await adminLeasesApi.settleDeposit(leaseId, {
        idempotencyKey: keyFor("deposit-settlement"),
        refundVnd: Number(form.get("refundVnd") ?? 0),
        deductionVnd: Number(form.get("deductionVnd") ?? 0),
        occurredAt: occurredAt.toISOString(),
        note: String(form.get("note") ?? "")
      });
      clearKey("deposit-settlement");
      event.currentTarget.reset();
      setActionSuccess(
        "Đã tất toán tiền cọc và cập nhật readiness trả phòng."
      );
      await load();
    } catch (action) {
      setActionError(
        action instanceof Error
          ? action.message
          : "Không thể tất toán tiền cọc."
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

  async function submitRenewal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const form = new FormData(event.currentTarget);
    const newLeaseId = crypto.randomUUID();
    const idempotencyKey = keyFor("renew-lease");

    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const result = await adminLeasesApi.renewLease(leaseId, {
        newLeaseId,
        idempotencyKey,
        newLeaseCode: String(form.get("newLeaseCode") ?? "").trim(),
        startDate: String(form.get("startDate") ?? "").trim(),
        plannedEndDate: String(form.get("plannedEndDate") ?? "").trim() || null,
        baseRentVnd: Number(form.get("baseRentVnd") ?? 0),
        depositRequiredVnd: Number(form.get("depositRequiredVnd") ?? 0),
        billingDay: Number(form.get("billingDay") ?? 1),
        rolloverDeposit: form.get("rolloverDeposit") === "on"
      });
      clearKey("renew-lease");
      setRenewalModalOpen(false);
      setRenewalConfirmed(false);
      setActionSuccess("Đã tạo bản nháp gia hạn thành công. Đang chuyển hướng...");
      window.location.assign("/leases/" + result.leaseId);
    } catch (action) {
      setActionError(
        action instanceof Error
          ? action.message
          : "Không thể gia hạn hợp đồng."
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitAttachment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file") as File | null;
    if (!file || file.size === 0) {
      setActionError("Vui lòng chọn tệp tài liệu / ảnh.");
      return;
    }

    setSaving(true);
    setActionError(null);
    setActionSuccess(null);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const fileUrl = String(reader.result);
        await adminLeasesApi.addAttachment(leaseId, {
          attachmentType: String(form.get("attachmentType") ?? "OTHER") as any,
          fileName: file.name,
          fileUrl,
          fileSizeBytes: file.size,
          mimeType: file.type,
          note: String(form.get("note") ?? "") || null
        });
        setUploadModalOpen(false);
        setActionSuccess("Đã thêm tệp đính kèm thành công.");
        await load();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Không thể tải lên tệp.");
      } finally {
        setSaving(false);
      }
    };
    reader.onerror = () => {
      setActionError("Lỗi đọc tệp tải lên.");
      setSaving(false);
    };
    reader.readAsDataURL(file);
  }

  async function removeAttachment(attachmentId: string) {
    if (!confirm("Bạn có chắc chắn muốn xóa tệp đính kèm này?")) return;
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await adminLeasesApi.deleteAttachment(leaseId, attachmentId);
      setActionSuccess("Đã xóa tệp đính kèm.");
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Không thể xóa tệp.");
    } finally {
      setSaving(false);
    }
  }

  async function submitAmendment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const adjustedRent = form.get("adjustedBaseRentVnd");
      const adjustedDeposit = form.get("adjustedDepositRequiredVnd");
      const adjustedEndDate = form.get("adjustedPlannedEndDate");

      await adminLeasesApi.createAmendment(leaseId, {
        amendmentNumber: String(form.get("amendmentNumber") ?? "").trim(),
        effectiveDate: String(form.get("effectiveDate") ?? "").trim(),
        changesSummary: String(form.get("changesSummary") ?? "").trim(),
        adjustedBaseRentVnd: adjustedRent ? Number(adjustedRent) : undefined,
        adjustedDepositRequiredVnd: adjustedDeposit ? Number(adjustedDeposit) : undefined,
        adjustedPlannedEndDate: adjustedEndDate ? String(adjustedEndDate).trim() : undefined,
        note: String(form.get("note") ?? "").trim() || undefined
      });
      setAmendmentModalOpen(false);
      setActionSuccess("Đã ký phụ lục hợp đồng và cập nhật điều khoản thành công.");
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Không thể tạo phụ lục.");
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

  if (loading || !data || !deposit) {
    return (
      <AdminShell title="Chi tiết hợp đồng" activeNav="Hợp đồng">
        <div className="admin-state">Đang tải hợp đồng…</div>
      </AdminShell>
    );
  }

  const lease = data.lease;
  const meta = statusMeta(lease.status);
  const depositMeta = depositStatusMeta(deposit.status);

  return (
    <AdminShell title={"Hợp đồng " + lease.code} activeNav="Hợp đồng">
      <PageHeader
        eyebrow={lease.property.name + " · PHÒNG " + lease.room.code}
        title={lease.primaryResident?.fullName ?? lease.code}
        description="Lease giữ lịch sử độc lập; thay người thuê hoặc trả phòng không sửa/xóa hợp đồng cũ."
        action={
          <div className="button-row">
            <a className="secondary-link-button" href="/leases">← Danh sách</a>
            <a
              className="secondary-link-button"
              href={"/leases/" + lease.id + "/print"}
              target="_blank"
              rel="noopener noreferrer"
            >
              In hợp đồng
            </a>
            {data.permissions.manage && lease.status === "ACTIVE" ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => setRenewalModalOpen(true)}
              >
                Gia hạn hợp đồng
              </button>
            ) : null}
            {lease.status === "TERMINATED" ? (
              <a
                className="primary-link-button"
                href={
                  "/leases/new?roomId=" +
                  encodeURIComponent(lease.room.id) +
                  "&baseRentVnd=" +
                  lease.baseRentVnd +
                  "&depositRequiredVnd=" +
                  lease.depositRequiredVnd
                }
              >
                + Tạo HĐ mới cho phòng này
              </a>
            ) : null}
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

      {renewalModalOpen && lease.status === "ACTIVE" ? (
        <section className="panel" style={{ border: "2px solid var(--color-primary)", marginBottom: "20px" }}>
          <SectionHeader
            title="Gia hạn hợp đồng (Tạo bản nháp mới)"
            action={
              <button
                className="secondary-button"
                type="button"
                onClick={() => setRenewalModalOpen(false)}
              >
                Đóng
              </button>
            }
          />
          <p className="inline-note" style={{ marginBottom: "16px" }}>
            Hợp đồng mới sẽ được tạo ở trạng thái <strong>BẢN NHÁP (DRAFT)</strong> và liên kết với hợp đồng hiện tại ({lease.code}).
            Toàn bộ thông tin người thuê chính và người ở cùng sẽ được tự động sao chép. Hợp đồng hiện tại tiếp tục hiệu lực cho đến khi hợp đồng mới được kích hoạt.
          </p>
          <form className="asset-form" onSubmit={(event) => void submitRenewal(event)}>
            <label>
              <span>Mã hợp đồng mới</span>
              <input
                name="newLeaseCode"
                required
                defaultValue={lease.code + "-GH"}
                placeholder="VD: HD-2026-0002"
              />
            </label>
            <label>
              <span>Ngày bắt đầu mới</span>
              <input
                name="startDate"
                type="date"
                required
                defaultValue={
                  lease.plannedEndDate
                    ? (() => {
                        const d = new Date(lease.plannedEndDate);
                        d.setDate(d.getDate() + 1);
                        return d.toISOString().slice(0, 10);
                      })()
                    : new Date().toISOString().slice(0, 10)
                }
              />
            </label>
            <label>
              <span>Ngày kết thúc dự kiến</span>
              <input
                name="plannedEndDate"
                type="date"
                defaultValue={
                  lease.plannedEndDate
                    ? (() => {
                        const d = new Date(lease.plannedEndDate);
                        d.setFullYear(d.getFullYear() + 1);
                        return d.toISOString().slice(0, 10);
                      })()
                    : ""
                }
              />
            </label>
            <label>
              <span>Tiền phòng / tháng (VND)</span>
              <input
                name="baseRentVnd"
                type="number"
                min="0"
                step="1"
                required
                defaultValue={lease.baseRentVnd}
              />
            </label>
            <label>
              <span>Tiền cọc yêu cầu (VND)</span>
              <input
                name="depositRequiredVnd"
                type="number"
                min="0"
                step="1"
                required
                defaultValue={lease.depositRequiredVnd}
              />
            </label>
            <label>
              <span>Ngày chốt hàng tháng</span>
              <input
                name="billingDay"
                type="number"
                min="1"
                max="31"
                required
                defaultValue={lease.billingDay}
              />
            </label>
            <label className="asset-form__wide confirm-check">
              <input
                type="checkbox"
                name="rolloverDeposit"
                defaultChecked={deposit ? deposit.heldVnd > 0 : false}
              />
              <span>
                Chuyển tiếp số dư tiền cọc đang giữ ({deposit ? <MoneyDisplay amountVnd={deposit.heldVnd} /> : "0đ"}) sang hợp đồng gia hạn
              </span>
            </label>
            <label className="asset-form__wide confirm-check">
              <input
                type="checkbox"
                checked={renewalConfirmed}
                onChange={(e) => setRenewalConfirmed(e.target.checked)}
              />
              <span>Tôi xác nhận tạo bản nháp gia hạn với các điều khoản trên.</span>
            </label>
            <div className="button-row asset-form__wide">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setRenewalModalOpen(false)}
              >
                Hủy
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={saving || !renewalConfirmed}
              >
                {saving ? "Đang xử lý…" : "Tạo hợp đồng gia hạn"}
              </button>
            </div>
          </form>
        </section>
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
            {lease.renewedFromLeaseId ? (
              <div>
                <dt>Gia hạn từ hợp đồng</dt>
                <dd>
                  <a
                    href={"/leases/" + lease.renewedFromLeaseId}
                    style={{ color: "var(--color-primary)", textDecoration: "underline" }}
                  >
                    Xem hợp đồng gốc →
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        </article>

        <article className="panel">
          <SectionHeader
            title="Tiền cọc"
            action={
              <StatusBadge tone={depositMeta.tone}>
                {depositMeta.label}
              </StatusBadge>
            }
          />
          <dl className="detail-list">
            <div><dt>Tiền phòng cơ bản</dt><dd><MoneyDisplay amountVnd={lease.baseRentVnd} /> / tháng</dd></div>
            <div><dt>Tiền cọc yêu cầu</dt><dd><MoneyDisplay amountVnd={deposit.requiredVnd} /></dd></div>
            <div><dt>Đã thu</dt><dd><MoneyDisplay amountVnd={deposit.collectedVnd} /></dd></div>
            <div><dt>Đang giữ</dt><dd><MoneyDisplay amountVnd={deposit.heldVnd} /></dd></div>
            <div><dt>Còn phải thu</dt><dd><MoneyDisplay amountVnd={deposit.outstandingVnd} /></dd></div>
            <div><dt>Đã hoàn</dt><dd><MoneyDisplay amountVnd={deposit.refundedVnd} /></dd></div>
            <div><dt>Đã khấu trừ</dt><dd><MoneyDisplay amountVnd={deposit.deductedVnd} /></dd></div>
            <div><dt>Readiness trả phòng</dt><dd>{deposit.terminationDepositReadiness ?? "—"}</dd></div>
          </dl>

          {deposit.permissions.reconcile &&
          deposit.outstandingVnd > 0 &&
          (lease.status === "DRAFT" || lease.status === "ACTIVE") ? (
            <form
              className="asset-form"
              onSubmit={(event) => void recordDepositCollection(event)}
              onChange={() => clearKey("deposit-collection")}
            >
              <label>
                <span>Số tiền thu</span>
                <input
                  name="amountVnd"
                  type="number"
                  min="1"
                  max={deposit.outstandingVnd}
                  step="1"
                  defaultValue={deposit.outstandingVnd}
                  required
                />
              </label>
              <label>
                <span>Thời điểm thu</span>
                <input name="occurredAt" type="datetime-local" required />
              </label>
              <label className="asset-form__wide">
                <span>Ghi chú</span>
                <input
                  name="note"
                  placeholder="Ví dụ: Thu cọc khi nhận phòng"
                />
              </label>
              <div className="button-row asset-form__wide">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={saving}
                >
                  Ghi nhận thu cọc
                </button>
              </div>
            </form>
          ) : null}

          {deposit.permissions.reconcile &&
          lease.status === "TERMINATION_SCHEDULED" ? (
            <form
              className="asset-form"
              onSubmit={(event) => void settleDeposit(event)}
              onChange={() => clearKey("deposit-settlement")}
            >
              <label>
                <span>Hoàn lại người thuê</span>
                <input
                  name="refundVnd"
                  type="number"
                  min="0"
                  max={deposit.heldVnd}
                  step="1"
                  defaultValue={deposit.heldVnd}
                  required
                />
              </label>
              <label>
                <span>Khấu trừ</span>
                <input
                  name="deductionVnd"
                  type="number"
                  min="0"
                  max={deposit.heldVnd}
                  step="1"
                  defaultValue={0}
                  required
                />
              </label>
              <label>
                <span>Thời điểm tất toán</span>
                <input name="occurredAt" type="datetime-local" required />
              </label>
              <label className="asset-form__wide">
                <span>Lý do / biên bản đối soát</span>
                <input
                  name="note"
                  placeholder={
                    deposit.heldVnd === 0
                      ? "Xác nhận không còn tiền cọc phải xử lý"
                      : "Ví dụ: Hoàn cọc sau khi trừ 500.000đ sửa khóa"
                  }
                  required
                />
              </label>
              <p className="inline-note asset-form__wide">
                Tổng hoàn + khấu trừ phải bằng số tiền đang giữ:{" "}
                <strong><MoneyDisplay amountVnd={deposit.heldVnd} /></strong>.
                Khi ghi nhận xong, deposit readiness của quy trình trả phòng
                sẽ được cập nhật tự động.
              </p>
              <div className="button-row asset-form__wide">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={saving}
                >
                  Tất toán tiền cọc
                </button>
              </div>
            </form>
          ) : null}

          {deposit.entries.length > 0 ? (
            <ol className="timeline">
              {deposit.entries.slice(0, 6).map((entry, index) => (
                <li key={entry.id}>
                  <span
                    className={
                      "timeline__dot" +
                      (index > 0 ? " timeline__dot--muted" : "")
                    }
                  />
                  <div>
                    <strong>
                      {entry.type === "COLLECTION"
                        ? "Thu cọc"
                        : entry.type === "REFUND"
                          ? "Hoàn cọc"
                          : "Khấu trừ cọc"}{" "}
                      · <MoneyDisplay amountVnd={entry.amountVnd} />
                    </strong>
                    <span>
                      {new Date(entry.occurredAt).toLocaleString("vi-VN")}
                      {entry.note ? " · " + entry.note : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="inline-note">
              Chưa có giao dịch tiền cọc. Lease vẫn chỉ lưu điều khoản cọc;
              mọi biến động tiền được ghi ở ledger và audit riêng.
            </p>
          )}
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
            <SectionHeader title="Đổi người thuê chính" />
            <p className="inline-note">
              Chỉ áp dụng cho DRAFT. Hãy chọn rõ cách giữ hoặc gỡ
              người thuê chính hiện tại trước khi kích hoạt hợp đồng.
            </p>
            <form
              className="asset-form"
              onSubmit={(event) => void replacePrimaryTenant(event)}
              onChange={() => clearKey("replace-primary")}
            >
              <div className="resident-search asset-form__wide">
                <label>
                  <span>Tìm resident cũ</span>
                  <input
                    value={primaryResidentQuery}
                    onChange={(event) => {
                      setPrimaryResidentQuery(event.target.value);
                      setPrimaryReplacementConfirmed(false);
                    }}
                    placeholder="Tên, điện thoại hoặc email"
                  />
                </label>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={
                    primaryResidentSearching ||
                    primaryResidentQuery.trim().length < 2
                  }
                  onClick={() => void searchPrimaryResidents()}
                >
                  {primaryResidentSearching ? "Đang tìm…" : "Tìm"}
                </button>
              </div>

              {primaryResidentResults.length > 0 &&
              !selectedPrimaryResident ? (
                <div className="resident-search-results asset-form__wide">
                  {primaryResidentResults.map((resident) => (
                    <button
                      className="resident-search-result"
                      type="button"
                      key={resident.id}
                      onClick={() => {
                        clearKey("replace-primary");
                        setSelectedPrimaryResident(resident);
                        setPrimaryReplacementConfirmed(false);
                      }}
                    >
                      <strong>{resident.fullName}</strong>
                      <span>
                        {resident.phone ??
                          resident.email ??
                          "Chưa có liên hệ"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {selectedPrimaryResident ? (
                <div className="resident-selected asset-form__wide">
                  <StatusBadge tone="info">REUSE RESIDENT</StatusBadge>
                  <div>
                    <strong>{selectedPrimaryResident.fullName}</strong>
                    <span>
                      {selectedPrimaryResident.phone ??
                        selectedPrimaryResident.email ??
                        "Chưa có liên hệ"}
                    </span>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      clearKey("replace-primary");
                      setSelectedPrimaryResident(null);
                      setPrimaryReplacementConfirmed(false);
                    }}
                  >
                    Đổi người
                  </button>
                </div>
              ) : (
                <>
                  <label>
                    <span>Họ tên người thuê chính mới</span>
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

              <label className="asset-form__wide">
                <span>Xử lý người thuê chính hiện tại</span>
                <select
                  name="previousPrimaryDisposition"
                  defaultValue="REMOVE"
                >
                  <option value="REMOVE">
                    Gỡ khỏi bản nháp hợp đồng
                  </option>
                  <option value="CO_TENANT">
                    Giữ lại làm đồng thuê
                  </option>
                  <option value="OCCUPANT">
                    Giữ lại làm người ở
                  </option>
                </select>
              </label>

              <div className="inline-note asset-form__wide">
                Người hiện tại:{" "}
                <strong>
                  {lease.primaryResident?.fullName ?? "Chưa xác định"}
                </strong>
                . Người mới sẽ trở thành PRIMARY_TENANT ngay trên
                bản nháp; chưa làm phòng chuyển sang trạng thái đang thuê.
              </div>

              <label className="confirm-check asset-form__wide">
                <input
                  type="checkbox"
                  checked={primaryReplacementConfirmed}
                  onChange={(event) =>
                    setPrimaryReplacementConfirmed(event.target.checked)
                  }
                />
                <span>
                  Tôi đã kiểm tra người thuê chính mới và cách xử lý
                  người thuê chính hiện tại.
                </span>
              </label>

              <div className="button-row asset-form__wide">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={saving || !primaryReplacementConfirmed}
                >
                  Đổi người thuê chính
                </button>
              </div>
            </form>
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

      <section className="panel">
        <SectionHeader
          title="Tài liệu & Hồ sơ đính kèm"
          action={
            data.permissions.manage ? (
              <button
                className="secondary-button secondary-button--compact"
                type="button"
                onClick={() => setUploadModalOpen(!uploadModalOpen)}
              >
                {uploadModalOpen ? "Đóng form tải lên" : "+ Tải lên tài liệu / CCCD"}
              </button>
            ) : null
          }
        />

        {uploadModalOpen ? (
          <div style={{ background: "var(--color-bg-secondary, #f8fafc)", padding: "16px", borderRadius: "8px", marginBottom: "16px", border: "1px solid var(--color-border, #e2e8f0)" }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: "14px", fontWeight: 600 }}>Tải lên tài liệu mới</h4>
            <form className="asset-form" onSubmit={(event) => void submitAttachment(event)}>
              <label>
                <span>Loại tài liệu</span>
                <select name="attachmentType" defaultValue="CITIZEN_ID_FRONT" required>
                  <option value="CITIZEN_ID_FRONT">CCCD Mặt trước</option>
                  <option value="CITIZEN_ID_BACK">CCCD Mặt sau</option>
                  <option value="CONTRACT_SCAN">Bản scan hợp đồng đã ký</option>
                  <option value="HANDOVER_MINUTES">Biên bản bàn giao phòng / đồ đạc</option>
                  <option value="OTHER">Tài liệu khác</option>
                </select>
              </label>
              <label>
                <span>Tệp tin (ảnh hoặc PDF)</span>
                <input name="file" type="file" accept="image/*,application/pdf" required />
              </label>
              <label>
                <span>Ghi chú bổ sung (tùy chọn)</span>
                <input name="note" placeholder="VD: CCCD người thuê phụ hoặc ghi chú bàn giao..." />
              </label>
              <div className="button-row" style={{ marginTop: "12px" }}>
                <button className="secondary-button" type="button" onClick={() => setUploadModalOpen(false)}>Hủy</button>
                <button className="primary-button" type="submit" disabled={saving}>Tải lên</button>
              </div>
            </form>
          </div>
        ) : null}

        {attachments.length === 0 ? (
          <div className="admin-state">Chưa có tài liệu hoặc ảnh CCCD nào được đính kèm.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
            {attachments.map((item) => {
              const typeMeta = attachmentTypeMeta(item.attachmentType);
              return (
                <div
                  key={item.id}
                  style={{
                    border: "1px solid var(--color-border, #e2e8f0)",
                    borderRadius: "8px",
                    padding: "12px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: "8px",
                    background: "var(--color-bg, #ffffff)"
                  }}
                >
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                      <StatusBadge tone={typeMeta.tone}>
                        {typeMeta.label}
                      </StatusBadge>
                      <span style={{ fontSize: "11px", color: "var(--color-muted, #64748b)" }}>
                        {formatBytes(item.fileSizeBytes)}
                      </span>
                    </div>
                    <strong style={{ display: "block", fontSize: "13px", wordBreak: "break-all" }}>
                      {item.fileName}
                    </strong>
                    {item.note ? (
                      <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--color-muted, #64748b)" }}>
                        {item.note}
                      </p>
                    ) : null}
                    <div style={{ fontSize: "11px", color: "var(--color-muted, #94a3b8)", marginTop: "6px" }}>
                      Đã tải lên: {new Date(item.uploadedAt).toLocaleDateString("vi-VN")}
                    </div>
                  </div>
                  <div className="button-row" style={{ marginTop: "8px", justifyContent: "flex-end" }}>
                    <a
                      className="secondary-link-button secondary-link-button--compact"
                      href={item.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={item.fileName}
                    >
                      Xem / Tải về
                    </a>
                    {data.permissions.manage ? (
                      <button
                        className="danger-button danger-button--compact"
                        type="button"
                        disabled={saving}
                        onClick={() => void removeAttachment(item.id)}
                      >
                        Xóa
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <SectionHeader
          title="Phụ lục hợp đồng điều chỉnh"
          action={
            data.permissions.manage && (lease.status === "ACTIVE" || lease.status === "TERMINATION_SCHEDULED") ? (
              <button
                className="secondary-button secondary-button--compact"
                type="button"
                onClick={() => setAmendmentModalOpen(!amendmentModalOpen)}
              >
                {amendmentModalOpen ? "Đóng form phụ lục" : "+ Ký phụ lục điều chỉnh"}
              </button>
            ) : null
          }
        />

        {amendmentModalOpen ? (
          <div style={{ background: "var(--color-bg-secondary, #f8fafc)", padding: "16px", borderRadius: "8px", marginBottom: "16px", border: "1px solid var(--color-border, #e2e8f0)" }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: "14px", fontWeight: 600 }}>Tạo phụ lục điều chỉnh hợp đồng</h4>
            <p className="inline-note" style={{ marginBottom: "12px" }}>
              Khi lưu phụ lục, hệ thống sẽ lưu vết lịch sử điều chỉnh pháp lý và tự động cập nhật điều khoản của hợp đồng hiện tại (giá thuê, tiền cọc, ngày kết thúc).
            </p>
            <form className="asset-form" onSubmit={(event) => void submitAmendment(event)}>
              <label>
                <span>Số hiệu phụ lục</span>
                <input
                  name="amendmentNumber"
                  required
                  defaultValue={"PL-" + lease.code + "-" + String(amendments.length + 1).padStart(2, "0")}
                  placeholder="VD: PL-01/HD-2026"
                />
              </label>
              <label>
                <span>Ngày có hiệu lực</span>
                <input
                  name="effectiveDate"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </label>
              <label>
                <span>Tóm tắt nội dung thay đổi</span>
                <textarea
                  name="changesSummary"
                  required
                  placeholder="VD: Điều chỉnh giá thuê từ tháng 10/2026 và gia hạn thêm 6 tháng hợp đồng"
                  rows={2}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <label>
                  <span>Giá thuê mới (VND/tháng) - Để trống nếu không đổi</span>
                  <input
                    name="adjustedBaseRentVnd"
                    type="number"
                    min="0"
                    step="1000"
                    placeholder={"Hiện tại: " + formatVnd(lease.baseRentVnd)}
                  />
                </label>
                <label>
                  <span>Tiền cọc yêu cầu mới (VND) - Để trống nếu không đổi</span>
                  <input
                    name="adjustedDepositRequiredVnd"
                    type="number"
                    min="0"
                    step="1000"
                    placeholder={"Hiện tại: " + formatVnd(lease.depositRequiredVnd)}
                  />
                </label>
              </div>
              <label>
                <span>Ngày kết thúc mới - Để trống nếu không đổi</span>
                <input
                  name="adjustedPlannedEndDate"
                  type="date"
                  placeholder={lease.plannedEndDate ?? ""}
                />
              </label>
              <label>
                <span>Ghi chú thêm</span>
                <input name="note" placeholder="Thỏa thuận riêng giữa hai bên..." />
              </label>
              <div className="button-row" style={{ marginTop: "12px" }}>
                <button className="secondary-button" type="button" onClick={() => setAmendmentModalOpen(false)}>Hủy</button>
                <button className="primary-button" type="submit" disabled={saving}>Xác nhận ký phụ lục</button>
              </div>
            </form>
          </div>
        ) : null}

        {amendments.length === 0 ? (
          <div className="admin-state">Chưa có phụ lục điều chỉnh nào được ký cho hợp đồng này.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {amendments.map((am) => (
              <div
                key={am.id}
                style={{
                  border: "1px solid var(--color-border, #e2e8f0)",
                  borderRadius: "8px",
                  padding: "14px",
                  background: "var(--color-bg, #ffffff)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <strong style={{ fontSize: "14px" }}>{am.amendmentNumber}</strong>
                    <StatusBadge tone="info">Hiệu lực: {am.effectiveDate}</StatusBadge>
                  </div>
                  <span style={{ fontSize: "12px", color: "var(--color-muted, #64748b)" }}>
                    {new Date(am.createdAt).toLocaleDateString("vi-VN")}
                  </span>
                </div>
                <p style={{ margin: "0 0 10px 0", fontSize: "13px", color: "var(--color-text, #1e293b)" }}>
                  {am.changesSummary}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", fontSize: "12px", background: "var(--color-bg-secondary, #f8fafc)", padding: "8px 12px", borderRadius: "6px" }}>
                  {am.adjustedBaseRentVnd !== null ? (
                    <div>Giá thuê mới: <strong><MoneyDisplay amountVnd={am.adjustedBaseRentVnd} /></strong></div>
                  ) : null}
                  {am.adjustedDepositRequiredVnd !== null ? (
                    <div>Cọc mới: <strong><MoneyDisplay amountVnd={am.adjustedDepositRequiredVnd} /></strong></div>
                  ) : null}
                  {am.adjustedPlannedEndDate !== null ? (
                    <div>Kết thúc mới: <strong>{am.adjustedPlannedEndDate}</strong></div>
                  ) : null}
                  {am.note ? (
                    <div style={{ color: "var(--color-muted, #64748b)" }}>Ghi chú: {am.note}</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
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
