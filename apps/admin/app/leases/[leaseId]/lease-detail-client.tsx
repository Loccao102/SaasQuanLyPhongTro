"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MoneyDisplay, PageHeader, SectionHeader, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../../components/admin-shell";
import {
  adminLeasesApi,
  type DepositMovement,
  type DepositStatus,
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

function depositStatusMeta(status: DepositStatus) {
  switch (status) {
    case "SETTLED":
      return { label: "ĐÃ QUYẾT TOÁN", tone: "success" as const };
    case "HELD":
      return { label: "ĐÃ THU ĐỦ", tone: "success" as const };
    case "PARTIALLY_SETTLED":
      return { label: "QUYẾT TOÁN MỘT PHẦN", tone: "warning" as const };
    case "PARTIALLY_PAID":
      return { label: "THU MỘT PHẦN", tone: "warning" as const };
    case "UNPAID":
      return { label: "CHƯA THU", tone: "neutral" as const };
    case "NOT_REQUIRED":
      return { label: "KHÔNG YÊU CẦU CỌC", tone: "neutral" as const };
  }
}

function depositMovementLabel(type: string): string {
  switch (type) {
    case "COLLECTION":
      return "Thu tiền cọc";
    case "DEDUCTION":
      return "Khấu trừ cọc";
    case "REFUND":
      return "Hoàn trả cọc";
    case "FORFEITURE":
      return "Tịch thu cọc";
    default:
      return type;
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
    case "LEASE_PRIMARY_TENANT_REPLACED":
      return "Đổi người thuê chính";
    case "LEASE_TERMINATION_READINESS_OVERRIDE":
      return "Cập nhật readiness thủ công";
    case "LEASE_DEPOSIT_COLLECTED":
      return "Thu tiền cọc";
    case "LEASE_DEPOSIT_SETTLED":
      return "Quyết toán tiền cọc";
    case "LEASE_RENEWED":
      return "Gia hạn hợp đồng";
    default:
      return action;
  }
}

function pricingItemTypeLabel(type: string): string {
  switch (type) {
    case "ELECTRICITY_PER_KWH":
      return "Điện (theo kWh)";
    case "WATER_PER_M3":
      return "Nước (theo m³)";
    case "INTERNET":
      return "Internet / Wifi";
    case "PARKING":
      return "Phí gửi xe";
    case "TRASH":
      return "Rác / Vệ sinh";
    case "CUSTOM":
      return "Dịch vụ khác";
    default:
      return type;
  }
}

function pricingItemUnit(type: string): string {
  switch (type) {
    case "ELECTRICITY_PER_KWH":
      return " / kWh";
    case "WATER_PER_M3":
      return " / m³";
    default:
      return " / tháng";
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
  const [primaryResidentQuery, setPrimaryResidentQuery] = useState("");
  const [primaryResidentResults, setPrimaryResidentResults] =
    useState<ResidentSearchResult[]>([]);
  const [selectedPrimaryResident, setSelectedPrimaryResident] =
    useState<ResidentSearchResult | null>(null);
  const [primaryResidentSearching, setPrimaryResidentSearching] =
    useState(false);
  const [primaryReplacementConfirmed, setPrimaryReplacementConfirmed] =
    useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [collectConfirmed, setCollectConfirmed] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleConfirmed, setSettleConfirmed] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewConfirmed, setRenewConfirmed] = useState(false);
  const [renewEndDate, setRenewEndDate] = useState("");
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

  async function handleCollectDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const amountVnd = Number(form.get("amountVnd") ?? 0);
      const paymentMethod = String(form.get("paymentMethod") ?? "BANK_TRANSFER") as
        | "BANK_TRANSFER"
        | "CASH"
        | "OTHER";
      const reference = String(form.get("reference") ?? "").trim() || null;
      const notes = String(form.get("notes") ?? "").trim() || null;
      const occurredAt = String(form.get("occurredAt") ?? "").trim() || null;

      await adminLeasesApi.collectDeposit(leaseId, {
        idempotencyKey: keyFor("collect-deposit"),
        amountVnd,
        paymentMethod,
        reference,
        notes,
        occurredAt
      });
      clearKey("collect-deposit");
      setCollectOpen(false);
      setCollectConfirmed(false);
      setActionSuccess("Đã ghi nhận thu tiền cọc thành công.");
      await load();
    } catch (action) {
      setActionError(
        action instanceof Error ? action.message : "Không thể ghi nhận thu tiền cọc."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSettleDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const deductionAmountVnd = Number(form.get("deductionAmountVnd") ?? 0);
      const refundAmountVnd = Number(form.get("refundAmountVnd") ?? 0);
      const deductionReason = String(form.get("deductionReason") ?? "").trim() || null;
      const refundReference = String(form.get("refundReference") ?? "").trim() || null;
      const notes = String(form.get("notes") ?? "").trim() || null;
      const occurredAt = String(form.get("occurredAt") ?? "").trim() || null;

      await adminLeasesApi.settleDeposit(leaseId, {
        idempotencyKey: keyFor("settle-deposit"),
        deductionAmountVnd,
        refundAmountVnd,
        deductionReason,
        refundReference,
        notes,
        occurredAt
      });
      clearKey("settle-deposit");
      setSettleOpen(false);
      setSettleConfirmed(false);
      setActionSuccess("Đã hoàn tất quyết toán tiền cọc thành công.");
      await load();
    } catch (action) {
      setActionError(
        action instanceof Error ? action.message : "Không thể quyết toán tiền cọc."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRenewLease(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const form = new FormData(event.currentTarget);
    const newPlannedEndDate = String(form.get("newPlannedEndDate") ?? "");
    const rawRent = form.get("newBaseRentVnd");
    const newBaseRentVnd = rawRent ? Number(rawRent) : undefined;
    const note = String(form.get("note") ?? "");

    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await adminLeasesApi.renewLease(leaseId, {
        idempotencyKey: keyFor("renew"),
        expectedVersion: data.lease.version,
        newPlannedEndDate,
        newBaseRentVnd,
        note: note ? note : null
      });
      clearKey("renew");
      setRenewOpen(false);
      setRenewConfirmed(false);
      setActionSuccess("Đã gia hạn hợp đồng thành công.");
      await load();
    } catch (renewError) {
      setActionError(
        renewError instanceof Error
          ? renewError.message
          : "Không thể gia hạn hợp đồng."
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
  const deposit = data.deposit;
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
              href={"/leases/" + lease.id + "/contract"}
              target="_blank"
              rel="noopener noreferrer"
            >
              Văn bản hợp đồng ↗
            </a>
            {data.permissions.manage &&
            (lease.status === "TERMINATED" || lease.status === "CANCELLED") ? (
              <a
                className="primary-link-button"
                href={"/leases/new?roomId=" + lease.room.id}
              >
                + Ký hợp đồng mới cho phòng {lease.room.code}
              </a>
            ) : null}
            {data.permissions.manage && lease.status === "ACTIVE" ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setRenewOpen((prev) => !prev);
                  setCollectOpen(false);
                  setSettleOpen(false);
                }}
              >
                {renewOpen ? "Đóng gia hạn" : "Gia hạn hợp đồng"}
              </button>
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
          <SectionHeader
            title="Tiền phòng & Tiền cọc"
            action={<StatusBadge tone={depositMeta.tone}>{depositMeta.label}</StatusBadge>}
          />
          <dl className="detail-list">
            <div><dt>Tiền phòng cơ bản</dt><dd><MoneyDisplay amountVnd={lease.baseRentVnd} /> / tháng</dd></div>
            <div><dt>Tiền cọc yêu cầu</dt><dd><MoneyDisplay amountVnd={lease.depositRequiredVnd} /></dd></div>
            <div><dt>Đã thu cọc</dt><dd><MoneyDisplay amountVnd={deposit.totalCollectedVnd} /></dd></div>
            <div><dt>Đang giữ thực tế</dt><dd><MoneyDisplay amountVnd={deposit.remainingHeldVnd} /></dd></div>
            {deposit.totalDeductedVnd > 0 || deposit.totalRefundedVnd > 0 ? (
              <>
                <div><dt>Đã khấu trừ</dt><dd><MoneyDisplay amountVnd={deposit.totalDeductedVnd} /></dd></div>
                <div><dt>Đã hoàn trả</dt><dd><MoneyDisplay amountVnd={deposit.totalRefundedVnd} /></dd></div>
              </>
            ) : null}
          </dl>
          <div className="button-row" style={{ marginTop: "1rem" }}>
            {data.permissions.manage &&
            lease.status !== "CANCELLED" &&
            lease.status !== "TERMINATED" ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setCollectOpen((prev) => !prev);
                  setSettleOpen(false);
                }}
              >
                {collectOpen ? "Đóng form thu cọc" : "Thu tiền cọc"}
              </button>
            ) : null}
            {(data.permissions.terminate || data.permissions.manage) &&
            deposit.remainingHeldVnd > 0 &&
            (lease.status === "ACTIVE" || lease.status === "TERMINATION_SCHEDULED") ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setSettleOpen((prev) => !prev);
                  setCollectOpen(false);
                }}
              >
                {settleOpen ? "Đóng form quyết toán" : "Quyết toán cọc"}
              </button>
            ) : null}
          </div>
        </article>
      </section>

      {data.pricingPolicy ? (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <SectionHeader
            title="Bảng giá dịch vụ áp dụng"
            action={
              <span className="scope-label">
                {data.pricingPolicy.name} · Hiệu lực từ {data.pricingPolicy.effectiveFrom}
              </span>
            }
          />
          <dl className="detail-list">
            {data.pricingPolicy.items.map((item) => (
              <div key={item.id}>
                <dt>{item.description} ({pricingItemTypeLabel(item.itemType)})</dt>
                <dd>
                  <MoneyDisplay amountVnd={item.unitPriceVnd} />
                  {pricingItemUnit(item.itemType)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <SectionHeader
            title="Bảng giá dịch vụ áp dụng"
            action={<StatusBadge tone="warning">CHƯA CẤU HÌNH</StatusBadge>}
          />
          <p className="inline-note">
            Cơ sở này chưa thiết lập bảng giá dịch vụ (điện, nước, internet...). Hóa đơn hàng tháng sẽ không tự động tính tiền dịch vụ cho đến khi bạn tạo bảng giá.
          </p>
          <div className="button-row" style={{ marginTop: "10px" }}>
            <a
              className="secondary-link-button secondary-button--compact"
              href={"/billing/pricing"}
            >
              Thiết lập bảng giá dịch vụ →
            </a>
          </div>
        </section>
      )}

      {renewOpen && lease.status === "ACTIVE" ? (
        <section className="panel review-panel" style={{ marginTop: "1rem" }}>
          <SectionHeader
            title="Gia hạn thời hạn hợp đồng"
            action={<span className="scope-label">Hạn hiện tại: {lease.plannedEndDate ?? "Không thời hạn"}</span>}
          />
          <form className="asset-form" onSubmit={(event) => void handleRenewLease(event)}>
            <div className="inline-note asset-form__wide">
              Gia hạn hợp đồng sẽ cập nhật ngày kết thúc dự kiến và có thể điều chỉnh giá phòng cho chu kỳ mới. Lịch sử hợp đồng, tiền cọc và cư dân hiện tại được giữ nguyên.
            </div>

            <div className="asset-form__wide" style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Gia hạn nhanh:</span>
              <button
                className="secondary-button secondary-button--compact"
                type="button"
                onClick={() => {
                  const base = lease.plannedEndDate ? new Date(lease.plannedEndDate) : new Date();
                  base.setMonth(base.getMonth() + 3);
                  setRenewEndDate(base.toISOString().slice(0, 10));
                }}
              >
                +3 tháng
              </button>
              <button
                className="secondary-button secondary-button--compact"
                type="button"
                onClick={() => {
                  const base = lease.plannedEndDate ? new Date(lease.plannedEndDate) : new Date();
                  base.setMonth(base.getMonth() + 6);
                  setRenewEndDate(base.toISOString().slice(0, 10));
                }}
              >
                +6 tháng
              </button>
              <button
                className="secondary-button secondary-button--compact"
                type="button"
                onClick={() => {
                  const base = lease.plannedEndDate ? new Date(lease.plannedEndDate) : new Date();
                  base.setMonth(base.getMonth() + 12);
                  setRenewEndDate(base.toISOString().slice(0, 10));
                }}
              >
                +12 tháng (1 năm)
              </button>
            </div>

            <label>
              <span>Ngày kết thúc mới (YYYY-MM-DD)</span>
              <input
                name="newPlannedEndDate"
                type="date"
                value={renewEndDate}
                onChange={(e) => setRenewEndDate(e.target.value)}
                min={lease.plannedEndDate ?? lease.startDate}
                required
              />
            </label>

            <label>
              <span>Tiền phòng chu kỳ mới (VND)</span>
              <input
                name="newBaseRentVnd"
                type="number"
                min="0"
                step="1"
                defaultValue={lease.baseRentVnd}
                required
              />
            </label>

            <label className="asset-form__wide">
              <span>Ghi chú gia hạn / điều khoản thay đổi</span>
              <input
                name="note"
                placeholder="Ví dụ: Gia hạn thêm 6 tháng, giữ nguyên giá thuê..."
              />
            </label>

            <label className="confirm-check asset-form__wide">
              <input
                type="checkbox"
                checked={renewConfirmed}
                onChange={(event) => setRenewConfirmed(event.target.checked)}
              />
              <span>Tôi xác nhận các điều khoản gia hạn và gia hạn thời hạn hợp đồng này.</span>
            </label>

            <div className="button-row asset-form__wide">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setRenewOpen(false)}
              >
                Hủy
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={saving || !renewConfirmed || !renewEndDate}
              >
                Xác nhận gia hạn
              </button>
            </div>
          </form>
        </section>
      ) : null}


      {collectOpen && lease.status !== "CANCELLED" && lease.status !== "TERMINATED" ? (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <SectionHeader
            title="Ghi nhận thu tiền cọc"
            action={<span className="scope-label">lease.manage · property scope</span>}
          />
          <form className="asset-form" onSubmit={(event) => void handleCollectDeposit(event)}>
            <label>
              <span>Số tiền thu (VND)</span>
              <input
                name="amountVnd"
                type="number"
                min="1"
                step="1"
                defaultValue={
                  deposit.depositRequiredVnd - deposit.totalCollectedVnd > 0
                    ? deposit.depositRequiredVnd - deposit.totalCollectedVnd
                    : ""
                }
                required
              />
            </label>
            <label>
              <span>Phương thức thanh toán</span>
              <select name="paymentMethod" defaultValue="BANK_TRANSFER">
                <option value="BANK_TRANSFER">Chuyển khoản</option>
                <option value="CASH">Tiền mặt</option>
                <option value="OTHER">Khác</option>
              </select>
            </label>
            <label>
              <span>Ngày thu</span>
              <input
                name="occurredAt"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                required
              />
            </label>
            <label>
              <span>Mã tham chiếu giao dịch</span>
              <input name="reference" placeholder="Mã giao dịch ngân hàng / biên nhận" />
            </label>
            <label className="asset-form__wide">
              <span>Ghi chú</span>
              <input name="notes" placeholder="Ghi chú đợt thu cọc (tùy chọn)" />
            </label>
            <label className="confirm-check asset-form__wide">
              <input
                type="checkbox"
                checked={collectConfirmed}
                onChange={(event) => setCollectConfirmed(event.target.checked)}
              />
              <span>Tôi xác nhận đã nhận số tiền cọc này từ khách thuê.</span>
            </label>
            <div className="button-row asset-form__wide">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setCollectOpen(false)}
              >
                Hủy
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={saving || !collectConfirmed}
              >
                Xác nhận thu cọc
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {settleOpen && deposit.remainingHeldVnd > 0 ? (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <SectionHeader
            title="Quyết toán tiền cọc"
            action={<span className="scope-label">Đang giữ: <MoneyDisplay amountVnd={deposit.remainingHeldVnd} /></span>}
          />
          <form className="asset-form" onSubmit={(event) => void handleSettleDeposit(event)}>
            <div className="inline-note asset-form__wide">
              Tổng tiền cọc đang giữ là <strong><MoneyDisplay amountVnd={deposit.remainingHeldVnd} /></strong>.
              Tổng số tiền (Khấu trừ + Hoàn trả) không được vượt quá số tiền đang giữ.
              Nếu số tiền còn lại sau quyết toán bằng 0, cọc sẽ chuyển sang trạng thái ĐÃ QUYẾT TOÁN và tự động kích hoạt readiness cọc cho quy trình trả phòng.
            </div>
            <label>
              <span>Số tiền khấu trừ (hư hại / nợ phí)</span>
              <input name="deductionAmountVnd" type="number" min="0" step="1" defaultValue="0" required />
            </label>
            <label>
              <span>Lý do khấu trừ</span>
              <input name="deductionReason" placeholder="Hư hỏng thiết bị, tiền điện chưa đóng..." />
            </label>
            <label>
              <span>Số tiền hoàn trả cho khách</span>
              <input
                name="refundAmountVnd"
                type="number"
                min="0"
                step="1"
                defaultValue={deposit.remainingHeldVnd}
                required
              />
            </label>
            <label>
              <span>Mã chuyển khoản hoàn cọc</span>
              <input name="refundReference" placeholder="Mã FT chuyển khoản trả khách..." />
            </label>
            <label>
              <span>Ngày quyết toán</span>
              <input
                name="occurredAt"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                required
              />
            </label>
            <label>
              <span>Ghi chú quyết toán</span>
              <input name="notes" placeholder="Ghi chú thêm nếu có..." />
            </label>
            <label className="confirm-check asset-form__wide">
              <input
                type="checkbox"
                checked={settleConfirmed}
                onChange={(event) => setSettleConfirmed(event.target.checked)}
              />
              <span>Tôi xác nhận số tiền khấu trừ và hoàn trả cọc trên là chính xác.</span>
            </label>
            <div className="button-row asset-form__wide">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setSettleOpen(false)}
              >
                Hủy
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={saving || !settleConfirmed}
              >
                Hoàn tất quyết toán cọc
              </button>
            </div>
          </form>
        </section>
      ) : null}

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

      {data.termination ? (
        <section className="panel">
          <SectionHeader
            title="Quy trình trả phòng gần nhất"
            action={
              data.permissions.manage && lease.status === "TERMINATED" ? (
                <a
                  className="primary-link-button primary-button--compact"
                  href={"/leases/new?roomId=" + lease.room.id}
                >
                  + Ký hợp đồng mới cho phòng {lease.room.code}
                </a>
              ) : undefined
            }
          />
          <dl className="detail-list">
            <div><dt>Trạng thái</dt><dd>{data.termination.status}</dd></div>
            <div><dt>Ngày hiệu lực</dt><dd>{data.termination.effectiveDate ?? "—"}</dd></div>
            <div><dt>Lý do</dt><dd>{data.termination.reason}</dd></div>
            <div><dt>Meter</dt><dd>{data.termination.readiness.meter}</dd></div>
            <div><dt>Công nợ</dt><dd>{data.termination.readiness.financial}</dd></div>
            <div><dt>Tiền cọc</dt><dd>{data.termination.readiness.deposit}</dd></div>
          </dl>
          {lease.status === "TERMINATED" ? (
            <div className="inline-note" style={{ marginTop: "1rem" }}>
              Hợp đồng này đã kết thúc. Phòng <strong>{lease.room.code}</strong> hiện đã trống và sẵn sàng để ký hợp đồng mới.
            </div>
          ) : null}
        </section>
      ) : null}

      {deposit && deposit.movements.length > 0 ? (
        <section className="panel">
          <SectionHeader
            title="Lịch sử biến động tiền cọc"
            action={<span className="scope-label">{deposit.movements.length} giao dịch</span>}
          />
          <div style={{ display: "grid", gap: "10px" }}>
            {deposit.movements.map((movement) => (
              <div
                key={movement.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "10px 0",
                  borderTop: "1px solid var(--color-border)",
                }}
              >
                <div style={{ display: "grid", gap: "3px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <StatusBadge
                      tone={
                        movement.movementType === "COLLECTION"
                          ? "success"
                          : movement.movementType === "REFUND"
                            ? "info"
                            : "warning"
                      }
                    >
                      {depositMovementLabel(movement.movementType)}
                    </StatusBadge>
                    <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                      {new Date(movement.occurredAt).toLocaleString("vi-VN")}
                    </span>
                  </div>
                  {movement.notes ? (
                    <span style={{ fontSize: "12px", color: "var(--color-text)" }}>
                      {movement.notes}
                    </span>
                  ) : null}
                  {movement.reference ? (
                    <small style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>
                      Mã tham chiếu: {movement.reference}
                    </small>
                  ) : null}
                </div>
                <div style={{ textAlign: "right" }}>
                  <strong
                    style={{
                      fontSize: "13px",
                      color:
                        movement.movementType === "COLLECTION"
                          ? "var(--color-success)"
                          : "var(--color-text)",
                    }}
                  >
                    {movement.movementType === "COLLECTION" ? "+" : "-"}
                    <MoneyDisplay amountVnd={movement.amountVnd} />
                  </strong>
                </div>
              </div>
            ))}
          </div>
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
