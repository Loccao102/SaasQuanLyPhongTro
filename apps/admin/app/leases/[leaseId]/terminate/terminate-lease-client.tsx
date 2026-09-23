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
              <SectionHeader title="2–4. Readiness từ module liên quan" />
              <div className="readiness-list">
                <div className="readiness-row">
                  <div>
                    <strong>Chỉ số điện / nước cuối</strong>
                    <span>Metering giữ reading source-of-truth.</span>
                  </div>
                  <StatusBadge tone={readinessTone(readiness!.meter)}>
                    {readiness!.meter}
                  </StatusBadge>
                </div>
                <div className="readiness-row">
                  <div>
                    <strong>Công nợ cuối</strong>
                    <span>Billing/Payment giữ invoice và settlement source-of-truth.</span>
                  </div>
                  <StatusBadge tone={readinessTone(readiness!.financial)}>
                    {readiness!.financial}
                  </StatusBadge>
                </div>
                <div className="readiness-row">
                  <div>
                    <strong>Tiền cọc</strong>
                    <span>Yêu cầu theo HĐ: <MoneyDisplay amountVnd={lease.depositRequiredVnd} /></span>
                  </div>
                  <StatusBadge tone={readinessTone(readiness!.deposit)}>
                    {readiness!.deposit}
                  </StatusBadge>
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
