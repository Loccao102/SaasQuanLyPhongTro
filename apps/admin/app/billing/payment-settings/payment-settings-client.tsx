"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { StatusBadge } from "@propops/ui";
import { AdminShell } from "../../../components/admin-shell";
import {
  renterPaymentsApi,
  type OrganizationPaymentProfile,
  type PaymentProfileResponse
} from "../../../lib/renter-payments-api";

type PendingProfile = {
  bankId: string;
  accountNo: string;
  accountName: string;
  vietQrTemplate: string;
  isActive: boolean;
};

export function PaymentSettingsClient() {
  const [data, setData] = useState<PaymentProfileResponse | null>(null);
  const [pending, setPending] = useState<PendingProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await renterPaymentsApi.paymentProfile());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không thể tải tài khoản nhận tiền."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending({
      bankId: String(form.get("bankId") ?? "").trim(),
      accountNo: String(form.get("accountNo") ?? "").trim(),
      accountName: String(form.get("accountName") ?? "").trim(),
      vietQrTemplate: String(form.get("vietQrTemplate") ?? "compact2").trim(),
      isActive: form.get("isActive") === "on"
    });
    setError(null);
    setSuccess(null);
  }

  async function confirm() {
    if (!pending) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await renterPaymentsApi.updatePaymentProfile(pending);
      setPending(null);
      setSuccess(
        "Đã cập nhật tài khoản nhận tiền. VietQR mới sẽ dùng cấu hình này."
      );
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Không thể cập nhật tài khoản nhận tiền."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell
      title="Tài khoản nhận tiền"
      eyebrow="RENTER PAYMENTS · ORGANIZATION PROFILE"
      activeNav="Hóa đơn"
    >
      <a className="back-link" href="/billing">← Hóa đơn</a>

      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Chưa cập nhật cấu hình thanh toán.</strong>
          <span>{error}</span>
        </div>
      ) : null}
      {success ? (
        <div className="admin-state admin-state--success">
          <strong>Đã cập nhật.</strong>
          <span>{success}</span>
        </div>
      ) : null}

      {loading || !data ? (
        <div className="admin-state">Đang tải payment profile…</div>
      ) : (
        <>
          <section className="asset-context">
            <div>
              <span className="eyebrow">ORGANIZATION PAYMENT DESTINATION</span>
              <h2>{data.organization.name}</h2>
              <p>
                Tài khoản này được dùng để tạo VietQR cho các hóa đơn người thuê
                còn công nợ. Thay đổi cấu hình sẽ ảnh hưởng các public invoice mở
                sau thời điểm lưu.
              </p>
            </div>
            <StatusBadge tone={data.profile?.isActive ? "success" : "neutral"}>
              {data.profile?.isActive ? "ACTIVE" : "NOT CONFIGURED"}
            </StatusBadge>
          </section>

          {!data.canManage ? (
            <div className="admin-state">
              <strong>Chỉ xem cấu hình.</strong>
              <span>
                Cần payment.reconcile ở scope toàn tổ chức để thay đổi tài khoản
                nhận tiền.
              </span>
            </div>
          ) : (
            <section className="panel">
              <div className="asset-section-heading">
                <div>
                  <span className="eyebrow">PAYMENT.RECONCILE</span>
                  <h2>Cấu hình VietQR</h2>
                </div>
              </div>
              <PaymentProfileForm
                profile={data.profile}
                disabled={saving}
                onSubmit={prepare}
              />
            </section>
          )}

          {pending ? (
            <section className="panel">
              <div className="asset-section-heading">
                <div>
                  <span className="eyebrow">REVIEW PAYMENT DESTINATION</span>
                  <h2>Xác nhận tài khoản nhận tiền</h2>
                </div>
                <StatusBadge tone="warning">FINANCIAL CONFIG</StatusBadge>
              </div>
              <dl className="detail-list">
                <div><dt>Ngân hàng / BIN</dt><dd>{pending.bankId}</dd></div>
                <div><dt>Số tài khoản</dt><dd>{pending.accountNo}</dd></div>
                <div><dt>Tên thụ hưởng</dt><dd>{pending.accountName}</dd></div>
                <div><dt>VietQR template</dt><dd>{pending.vietQrTemplate}</dd></div>
                <div><dt>Trạng thái</dt><dd>{pending.isActive ? "ACTIVE" : "INACTIVE"}</dd></div>
              </dl>
              <p className="inline-note">
                Sau khi xác nhận, các public invoice sẽ tạo QR hướng tiền về đúng
                tài khoản này. Hãy kiểm tra kỹ số tài khoản và tên thụ hưởng.
              </p>
              <div className="button-row">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => setPending(null)}
                >
                  Quay lại chỉnh
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => void confirm()}
                >
                  {saving ? "Đang cập nhật…" : "Cập nhật tài khoản nhận tiền"}
                </button>
              </div>
            </section>
          ) : null}
        </>
      )}
    </AdminShell>
  );
}

function PaymentProfileForm({
  profile,
  disabled,
  onSubmit
}: {
  profile: OrganizationPaymentProfile | null;
  disabled: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="asset-form" onSubmit={onSubmit}>
      <label>
        <span>Mã ngân hàng / BIN</span>
        <input
          name="bankId"
          required
          defaultValue={profile?.bankId ?? ""}
          placeholder="970422 hoặc MBBank"
        />
      </label>
      <label>
        <span>Số tài khoản</span>
        <input
          name="accountNo"
          required
          defaultValue={profile?.accountNo ?? ""}
          inputMode="numeric"
          autoComplete="off"
        />
      </label>
      <label>
        <span>Tên thụ hưởng</span>
        <input
          name="accountName"
          required
          defaultValue={profile?.accountName ?? ""}
          autoComplete="off"
        />
      </label>
      <label>
        <span>VietQR template</span>
        <input
          name="vietQrTemplate"
          required
          defaultValue={profile?.vietQrTemplate ?? "compact2"}
        />
      </label>
      <label className="team-check">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={profile?.isActive ?? true}
        />
        <span>Cho phép public invoice hiển thị VietQR</span>
      </label>
      <div className="button-row">
        <button className="primary-button" type="submit" disabled={disabled}>
          Xem lại thay đổi
        </button>
      </div>
    </form>
  );
}
