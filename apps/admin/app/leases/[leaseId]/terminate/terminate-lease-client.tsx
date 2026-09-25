"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MoneyDisplay, PageHeader, SectionHeader, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../../../components/admin-shell";
import {
  adminLeasesApi,
  type LeaseDetailResponse
} from "../../../../lib/admin-leases-api";

function readinessTone(value: "PENDING" | "READY" | "NOT_REQUIRED") {
  return value === "PENDING" ? "warning" as const : "success" as const;
}

export function TerminateLeaseClient({ leaseId }: { leaseId: string }) {
  const [data, setData] = useState<LeaseDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scheduleConfirmed, setScheduleConfirmed] = useState(false);
  const [finalizeConfirmed, setFinalizeConfirmed] = useState(false);
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [meterFormOpen, setMeterFormOpen] = useState(false);
  const [selectedMeterId, setSelectedMeterId] = useState("");
  const [meterReadingValue, setMeterReadingValue] = useState("");
  const [meterReadingDate, setMeterReadingDate] = useState("");
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
          : "Không thể tải quy trình chấm dứt."
      );
    } finally {
      setLoading(false);
    }
  }, [leaseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await adminLeasesApi.scheduleTermination(
        leaseId,
        keyFor("schedule"),
        {
          effectiveDate: String(form.get("effectiveDate") ?? ""),
          reason: String(form.get("reason") ?? "")
        }
      );
      clearKey("schedule");
      setScheduleConfirmed(false);
      setActionSuccess(
        "Đã lên lịch chấm dứt. Hợp đồng vẫn chiếm dụng phòng cho tới khi workflow được hoàn tất."
      );
      await load();
    } catch (action) {
      setActionError(
        action instanceof Error
          ? action.message
          : "Không thể lên lịch chấm dứt."
      );
    } finally {
      setSaving(false);
    }
  }

  async function cancelSchedule() {
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await adminLeasesApi.cancelTermination(
        leaseId,
        keyFor("cancel-termination")
      );
      clearKey("cancel-termination");
      setCancelConfirmed(false);
      setActionSuccess(
        "Đã hủy lịch chấm dứt. Hợp đồng quay lại trạng thái ACTIVE."
      );
      await load();
    } catch (action) {
      setActionError(
        action instanceof Error
          ? action.message
          : "Không thể hủy lịch chấm dứt."
      );
    } finally {
      setSaving(false);
    }
  }

  async function setReadiness(
    kind: "meter" | "financial" | "deposit",
    state: "READY" | "NOT_REQUIRED" | "PENDING"
  ) {
    const reason = window.prompt(
      "Lý do manual override readiness (sẽ được ghi audit):"
    );
    if (!reason?.trim()) return;

    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await adminLeasesApi.setTerminationReadiness(leaseId, {
        kind,
        state,
        reason: reason.trim()
      });
      setActionSuccess("Đã cập nhật readiness và ghi audit manual override.");
      await load();
    } catch (action) {
      setActionError(
        action instanceof Error
          ? action.message
          : "Không thể cập nhật readiness."
      );
    } finally {
      setSaving(false);
    }
  }

  async function syncSystemReadiness() {
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await adminLeasesApi.syncTerminationReadiness(leaseId);
      setActionSuccess(
        `Đã đồng bộ kiểm tra từ hệ thống (Điện/nước: ${res.meter}, Công nợ: ${res.financial}, Tiền cọc: ${res.deposit}).`
      );
      await load();
    } catch (action) {
      setActionError(
        action instanceof Error
          ? action.message
          : "Không thể đồng bộ readiness từ hệ thống."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRecordMeterReading(e: FormEvent) {
    e.preventDefault();
    if (!selectedMeterId || !meterReadingValue || !meterReadingDate) return;
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await adminLeasesApi.recordTerminationMeterReading(leaseId, {
        meterId: selectedMeterId,
        readingDate: meterReadingDate,
        readingValue: Number(meterReadingValue)
      });
      setActionSuccess("Đã lưu chỉ số chốt ngày trả phòng và cập nhật tiến trình.");
      setMeterFormOpen(false);
      setMeterReadingValue("");
      await load();
    } catch (action) {
      setActionError(
        action instanceof Error
          ? action.message
          : "Không thể lưu chỉ số đồng hồ."
      );
    } finally {
      setSaving(false);
    }
  }

  async function finalize() {
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await adminLeasesApi.finalizeTermination(
        leaseId,
        keyFor("finalize")
      );
      clearKey("finalize");
      setFinalizeConfirmed(false);
      setActionSuccess(
        "Đã hoàn tất chấm dứt. Phòng không còn bị hợp đồng này chiếm dụng."
      );
      await load();
    } catch (action) {
      setActionError(
        action instanceof Error
          ? action.message
          : "Không thể hoàn tất chấm dứt."
      );
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <AdminShell title="Chấm dứt hợp đồng" activeNav="Hợp đồng">
        <div className="admin-state admin-state--error">
          <strong>Không thể tải workflow.</strong>
          <span>{error}</span>
        </div>
      </AdminShell>
    );
  }

  if (loading || !data) {
    return (
      <AdminShell title="Chấm dứt hợp đồng" activeNav="Hợp đồng">
        <div className="admin-state">Đang tải workflow trả phòng…</div>
      </AdminShell>
    );
  }

  const lease = data.lease;
  const termination = data.termination;
  const readiness = termination?.readiness ?? null;
  const allReady =
    readiness !== null &&
    readiness.meter !== "PENDING" &&
    readiness.financial !== "PENDING" &&
    readiness.deposit !== "PENDING";

  const steps = [
    {
      label: "Ngày hiệu lực",
      state: termination ? "complete" : "current"
    },
    {
      label: "Chốt điện / nước",
      state: readiness?.meter === "PENDING" ? "current" : readiness ? "complete" : "pending"
    },
    {
      label: "Công nợ cuối",
      state: readiness?.financial === "PENDING" ? "current" : readiness ? "complete" : "pending"
    },
    {
      label: "Xử lý tiền cọc",
      state: readiness?.deposit === "PENDING" ? "current" : readiness ? "complete" : "pending"
    },
    {
      label: "Kiểm tra & hoàn tất",
      state: allReady ? "current" : "pending"
    }
  ] as const;

  return (
    <AdminShell title="Chấm dứt hợp đồng" activeNav="Hợp đồng">
      <PageHeader
        eyebrow={lease.code + " · " + lease.property.name + " · " + lease.room.code}
        title="Quy trình trả phòng"
        description="Chấm dứt là domain transition có ảnh hưởng trạng thái phòng, công nợ và tiền cọc; hợp đồng cũ không bị xóa."
        action={
          <a className="secondary-link-button" href={"/leases/" + lease.id}>
            ← Quay lại hợp đồng
          </a>
        }
      />

      {!data.permissions.terminate ? (
        <div className="admin-state admin-state--error">
          <strong>Bạn không có quyền chấm dứt hợp đồng này.</strong>
          <span>Backend vẫn áp dụng lease.terminate theo property scope.</span>
        </div>
      ) : null}

      {actionError ? (
        <div className="admin-state admin-state--error">
          <strong>Hành động chưa hoàn tất.</strong>
          <span>{actionError}</span>
          <small>Thử lại sẽ giữ nguyên idempotency key.</small>
        </div>
      ) : null}
      {actionSuccess ? (
        <div className="admin-state admin-state--success">
          <strong>Workflow đã được cập nhật.</strong>
          <span>{actionSuccess}</span>
        </div>
      ) : null}

      <section className="destructive-banner" aria-label="Ảnh hưởng khi chấm dứt hợp đồng">
        <div>
          <strong>Sau khi hoàn tất</strong>
          <p>
            Hợp đồng {lease.code} chuyển sang TERMINATED. Phòng {lease.room.code}
            trở thành sẵn sàng cho hợp đồng mới; Resident, invoice và audit history
            vẫn được giữ.
          </p>
        </div>
        <StatusBadge tone="danger">HÀNH ĐỘNG NHẠY CẢM</StatusBadge>
      </section>

      {lease.status === "ACTIVE" && data.permissions.terminate ? (
        <section className="panel review-panel">
          <SectionHeader title="Lên lịch chấm dứt" />
          <form className="termination-schedule-form" onSubmit={(event) => void schedule(event)}>
            <label>
              <span>Ngày trả phòng hiệu lực</span>
              <input
                name="effectiveDate"
                type="date"
                min={lease.startDate}
                required
              />
            </label>
            <label>
              <span>Lý do</span>
              <textarea
                name="reason"
                required
                rows={3}
                placeholder="Ví dụ: người thuê chuyển nơi ở"
              />
            </label>
            <ul className="consequence-list">
              <li>Lease chuyển sang TERMINATION_SCHEDULED và vẫn chiếm dụng phòng.</li>
              <li>Meter, Billing/Payment và Deposit readiness khởi tạo ở PENDING.</li>
              <li>Chỉ khi tất cả readiness đã READY/NOT_REQUIRED mới được hoàn tất.</li>
            </ul>
            <label className="confirm-check">
              <input
                type="checkbox"
                checked={scheduleConfirmed}
                onChange={(event) => setScheduleConfirmed(event.target.checked)}
              />
              <span>Tôi đã kiểm tra ngày hiệu lực và hiểu hợp đồng chưa kết thúc ngay.</span>
            </label>
            <div className="button-row">
              <button
                className="danger-button"
                type="submit"
                disabled={saving || !scheduleConfirmed}
              >
                Lên lịch chấm dứt
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {lease.status === "TERMINATION_SCHEDULED" && termination ? (
        <section className="termination-layout">
          <aside className="panel termination-steps">
            <SectionHeader title="Tiến trình" />
            <ol>
              {steps.map((step, index) => (
                <li
                  className={"termination-step termination-step--" + step.state}
                  key={step.label}
                >
                  <span className="termination-step__index">{index + 1}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <span>
                      {step.state === "complete"
                        ? "Đã sẵn sàng"
                        : step.state === "current"
                          ? "Cần xử lý"
                          : "Chưa sẵn sàng"}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </aside>

          <div className="termination-main">
            <article className="panel">
              <SectionHeader title="1. Ngày hiệu lực & lý do" action={<StatusBadge tone="success">ĐÃ LÊN LỊCH</StatusBadge>} />
              <dl className="detail-list">
                <div><dt>Ngày trả phòng hiệu lực</dt><dd>{termination.effectiveDate ?? "—"}</dd></div>
                <div><dt>Lý do</dt><dd>{termination.reason}</dd></div>
              </dl>
            </article>

            <article className="panel">
              <SectionHeader
                title="2–4. Readiness từ module liên quan"
                action={
                  data.permissions.terminate ? (
                    <button
                      className="secondary-button secondary-button--compact"
                      type="button"
                      disabled={saving}
                      onClick={() => void syncSystemReadiness()}
                    >
                      🔄 Đồng bộ kiểm tra từ hệ thống
                    </button>
                  ) : undefined
                }
              />
              <div className="readiness-list">
                <div className="readiness-row">
                  <div style={{ flex: 1 }}>
                    <strong>Chỉ số điện / nước cuối</strong>
                    <span>Chốt số điện, nước tại thời điểm trả phòng để tính tiền lần cuối.</span>
                    {data.meters && data.meters.length > 0 ? (
                      <div style={{ marginTop: "8px", display: "grid", gap: "6px" }}>
                        {data.meters.map((m) => (
                          <div
                            key={m.meterId}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              fontSize: "12px",
                              padding: "4px 8px",
                              background: "var(--color-bg-subtle, #f9fafb)",
                              borderRadius: "4px"
                            }}
                          >
                            <span>
                              {m.meterType === "ELECTRICITY" ? "⚡ Điện" : "💧 Nước"} ({m.label ?? m.unit}):
                            </span>
                            {m.latestReading ? (
                              <strong>
                                {m.latestReading.readingValue} {m.unit} (ngày {m.latestReading.readingDate})
                              </strong>
                            ) : (
                              <span style={{ color: "var(--color-warning)" }}>Chưa có chỉ số</span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--color-text-muted)" }}>
                        Phòng này chưa có đồng hồ điện/nước nào được cấu hình.
                      </p>
                    )}

                    {meterFormOpen ? (
                      <form
                        onSubmit={(e) => void handleRecordMeterReading(e)}
                        style={{
                          marginTop: "10px",
                          padding: "12px",
                          border: "1px solid var(--color-border)",
                          borderRadius: "6px",
                          background: "var(--color-bg, white)",
                          display: "grid",
                          gap: "8px"
                        }}
                      >
                        <strong style={{ fontSize: "13px" }}>Ghi chỉ số chốt ngày trả phòng</strong>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                          <div>
                            <label style={{ fontSize: "11px", display: "block", marginBottom: "2px" }}>
                              Chọn đồng hồ
                            </label>
                            <select
                              value={selectedMeterId}
                              onChange={(e) => setSelectedMeterId(e.target.value)}
                              required
                              style={{ width: "100%", padding: "6px", fontSize: "12px" }}
                            >
                              <option value="">-- Chọn đồng hồ --</option>
                              {data.meters?.map((m) => (
                                <option key={m.meterId} value={m.meterId}>
                                  {m.meterType === "ELECTRICITY" ? "Điện" : "Nước"} ({m.label ?? m.unit})
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label style={{ fontSize: "11px", display: "block", marginBottom: "2px" }}>
                              Chỉ số chốt mới
                            </label>
                            <input
                              type="number"
                              step="0.001"
                              min="0"
                              placeholder="vd: 150.5"
                              value={meterReadingValue}
                              onChange={(e) => setMeterReadingValue(e.target.value)}
                              required
                              style={{ width: "100%", padding: "6px", fontSize: "12px" }}
                            />
                          </div>
                        </div>
                        <div>
                          <label style={{ fontSize: "11px", display: "block", marginBottom: "2px" }}>
                            Ngày ghi chỉ số
                          </label>
                          <input
                            type="date"
                            value={meterReadingDate}
                            onChange={(e) => setMeterReadingDate(e.target.value)}
                            required
                            style={{ width: "100%", padding: "6px", fontSize: "12px" }}
                          />
                        </div>
                        <div className="button-row" style={{ marginTop: "4px" }}>
                          <button
                            className="primary-button primary-button--compact"
                            type="submit"
                            disabled={saving}
                          >
                            Lưu chỉ số chốt
                          </button>
                          <button
                            className="secondary-button secondary-button--compact"
                            type="button"
                            onClick={() => setMeterFormOpen(false)}
                          >
                            Đóng
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                  <div className="button-row" style={{ alignItems: "flex-start" }}>
                    <StatusBadge tone={readinessTone(readiness!.meter)}>
                      {readiness!.meter}
                    </StatusBadge>
                    {data.permissions.terminate ? (
                      <>
                        {data.meters && data.meters.length > 0 && !meterFormOpen ? (
                          <button
                            className="secondary-button secondary-button--compact"
                            type="button"
                            onClick={() => {
                              setSelectedMeterId(data.meters?.[0]?.meterId ?? "");
                              setMeterReadingDate(termination.effectiveDate ?? new Date().toISOString().slice(0, 10));
                              setMeterFormOpen(true);
                            }}
                          >
                            + Ghi số chốt
                          </button>
                        ) : null}
                        <button className="secondary-button secondary-button--compact" type="button" disabled={saving} onClick={() => void setReadiness("meter", "READY")}>Ghi đè Ready</button>
                        <button className="secondary-button secondary-button--compact" type="button" disabled={saving} onClick={() => void setReadiness("meter", "NOT_REQUIRED")}>N/A</button>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="readiness-row">
                  <div style={{ flex: 1 }}>
                    <strong>Công nợ cuối</strong>
                    <span>Kiểm tra các hóa đơn tiền phòng và dịch vụ chưa thanh toán.</span>
                    {data.financial ? (
                      <div style={{ marginTop: "6px" }}>
                        {data.financial.unpaidInvoicesCount === 0 ? (
                          <div style={{ fontSize: "12px", color: "var(--color-success)", fontWeight: 600 }}>
                            ✓ Sạch công nợ: Không có hóa đơn chưa thanh toán (tổng {data.financial.totalInvoicesCount} hóa đơn).
                          </div>
                        ) : (
                          <div style={{ display: "grid", gap: "4px" }}>
                            <div style={{ fontSize: "12px", color: "var(--color-danger)", fontWeight: 700 }}>
                              ⚠️ Còn nợ <MoneyDisplay amountVnd={data.financial.totalDebtVnd} /> trên {data.financial.unpaidInvoicesCount} hóa đơn:
                            </div>
                            <ul style={{ margin: "2px 0 0 16px", padding: 0, fontSize: "12px" }}>
                              {data.financial.unpaidInvoices.map((inv) => (
                                <li key={inv.id}>
                                  <a
                                    href={`/billing/invoices/${inv.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ textDecoration: "underline" }}
                                  >
                                    {inv.invoiceNumber}
                                  </a>
                                  : hạn {inv.dueDate} — còn nợ <MoneyDisplay amountVnd={inv.remainingVnd} />
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="button-row" style={{ alignItems: "flex-start" }}>
                    <StatusBadge tone={readinessTone(readiness!.financial)}>
                      {readiness!.financial}
                    </StatusBadge>
                    {data.permissions.terminate ? (
                      <>
                        {data.financial && data.financial.unpaidInvoicesCount === 0 && readiness!.financial === "PENDING" ? (
                          <button
                            className="primary-button primary-button--compact"
                            type="button"
                            disabled={saving}
                            onClick={() => void syncSystemReadiness()}
                          >
                            Xác nhận sạch nợ
                          </button>
                        ) : null}
                        <button className="secondary-button secondary-button--compact" type="button" disabled={saving} onClick={() => void setReadiness("financial", "READY")}>Ghi đè Ready</button>
                        <button className="secondary-button secondary-button--compact" type="button" disabled={saving} onClick={() => void setReadiness("financial", "NOT_REQUIRED")}>N/A</button>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="readiness-row">
                  <div style={{ flex: 1 }}>
                    <strong>Tiền cọc</strong>
                    <span>
                      {data.deposit ? (
                        <>
                          Đang giữ thực tế: <MoneyDisplay amountVnd={data.deposit.remainingHeldVnd} />
                          {data.deposit.remainingHeldVnd > 0
                            ? " · Cần quyết toán hoàn trả / khấu trừ trước khi trả phòng."
                            : data.deposit.status === "SETTLED"
                              ? " · Đã hoàn tất quyết toán cọc."
                              : data.deposit.status === "NOT_REQUIRED"
                                ? " · Hợp đồng không yêu cầu tiền cọc."
                                : " · Chưa ghi nhận số dư cọc."}
                        </>
                      ) : (
                        <>Yêu cầu theo HĐ: <MoneyDisplay amountVnd={lease.depositRequiredVnd} /></>
                      )}
                    </span>
                  </div>
                  <div className="button-row" style={{ alignItems: "flex-start" }}>
                    <StatusBadge tone={readinessTone(readiness!.deposit)}>
                      {readiness!.deposit}
                    </StatusBadge>
                    {data.deposit && data.deposit.remainingHeldVnd > 0 ? (
                      <a
                        href={"/leases/" + lease.id}
                        className="secondary-button secondary-button--compact"
                        style={{ textDecoration: "none" }}
                      >
                        Quyết toán cọc
                      </a>
                    ) : null}
                    {data.permissions.terminate ? (
                      <>
                        <button
                          className="secondary-button secondary-button--compact"
                          type="button"
                          disabled={saving}
                          onClick={() => void setReadiness("deposit", "READY")}
                        >
                          Ghi đè Ready
                        </button>
                        <button
                          className="secondary-button secondary-button--compact"
                          type="button"
                          disabled={saving}
                          onClick={() => void setReadiness("deposit", "NOT_REQUIRED")}
                        >
                          N/A
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>

            <article className="panel review-panel">
              <SectionHeader title="5. Kiểm tra trước khi hoàn tất" />
              <ul className="consequence-list">
                <li>Lease chuyển sang TERMINATED và không còn chiếm dụng phòng.</li>
                <li>Phòng {lease.room.code} có thể được kích hoạt với Lease mới.</li>
                <li>Resident, Lease, invoice và audit history không bị xóa.</li>
                <li>Backend chặn hoàn tất nếu còn readiness PENDING.</li>
              </ul>
              <label className="confirm-check">
                <input
                  type="checkbox"
                  checked={finalizeConfirmed}
                  onChange={(event) => setFinalizeConfirmed(event.target.checked)}
                  disabled={!allReady}
                />
                <span>
                  {allReady
                    ? "Tôi đã kiểm tra readiness và xác nhận hoàn tất trả phòng."
                    : "Chưa thể xác nhận vì còn readiness PENDING."}
                </span>
              </label>
              <div className="final-action">
                <div>
                  <strong>{allReady ? "Đã đủ điều kiện hoàn tất" : "Chưa thể hoàn tất"}</strong>
                  <span>
                    {allReady
                      ? "Finalization vẫn được kiểm tra lại trong transaction."
                      : "Meter / công nợ / tiền cọc cần được module sở hữu xử lý."}
                  </span>
                </div>
                <button
                  className="danger-button"
                  type="button"
                  disabled={saving || !allReady || !finalizeConfirmed}
                  onClick={() => void finalize()}
                >
                  Hoàn tất chấm dứt hợp đồng
                </button>
              </div>
            </article>

            <article className="panel">
              <SectionHeader title="Hủy lịch chấm dứt" />
              <p className="inline-note">
                Chỉ hủy orchestration hiện tại và đưa Lease về ACTIVE. Không xóa lịch sử audit.
              </p>
              <label className="confirm-check">
                <input
                  type="checkbox"
                  checked={cancelConfirmed}
                  onChange={(event) => setCancelConfirmed(event.target.checked)}
                />
                <span>Tôi muốn giữ hợp đồng tiếp tục hiệu lực.</span>
              </label>
              <div className="button-row">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saving || !cancelConfirmed}
                  onClick={() => void cancelSchedule()}
                >
                  Hủy lịch chấm dứt
                </button>
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {lease.status === "TERMINATED" ? (
        <div className="admin-state">
          <strong>Hợp đồng đã kết thúc.</strong>
          <span>Phòng không còn bị Lease này chiếm dụng. Lịch sử vẫn được giữ nguyên.</span>
        </div>
      ) : null}

      {lease.status === "DRAFT" || lease.status === "CANCELLED" ? (
        <div className="admin-state">
          <strong>Workflow chấm dứt không áp dụng cho trạng thái {lease.status}.</strong>
          <span>Chỉ Lease ACTIVE mới có thể lên lịch chấm dứt.</span>
        </div>
      ) : null}
    </AdminShell>
  );
}
