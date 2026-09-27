"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { StatusBadge } from "@propops/ui";
import {
  cmsApi,
  type CmsOrganization,
  type CmsTenantAccount,
  type CmsTenantAccountsView
} from "../../../lib/cms-api";

type AccountAction =
  | { kind: "status"; account: CmsTenantAccount; status: "ACTIVE" | "SUSPENDED" }
  | { kind: "resetPassword"; account: CmsTenantAccount }
  | { kind: "revokeSessions"; account: CmsTenantAccount }
  | null;

const roles: CmsTenantAccount["role"][] = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "STAFF",
  "ACCOUNTANT",
  "VIEWER"
];

export default function TenantAccountsPage() {
  const params = useParams<{ organizationId: string }>();
  const organizationId = String(params.organizationId ?? "");
  const [organization, setOrganization] = useState<CmsOrganization | null>(null);
  const [data, setData] = useState<CmsTenantAccountsView | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [action, setAction] = useState<AccountAction>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const [accounts, organizations] = await Promise.all([
        cmsApi.tenantAccounts(organizationId),
        cmsApi.organizations()
      ]);
      setData(accounts);
      setOrganization(
        organizations.find((item) => item.id === organizationId) ?? null
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể tải tài khoản tenant."
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const quotaLabel = useMemo(() => {
    if (!data) return "—";
    return String(data.used) + " / " + String(data.limit);
  }, [data]);

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await cmsApi.createTenantAccount(organizationId, {
        displayName: String(form.get("displayName") ?? ""),
        email: String(form.get("email") ?? ""),
        role: String(form.get("role") ?? "STAFF") as CmsTenantAccount["role"],
        temporaryPassword: String(form.get("temporaryPassword") ?? ""),
        reason: String(form.get("reason") ?? "")
      });
      setShowCreate(false);
      setSuccess("Đã tạo tài khoản tenant và ghi audit.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể tạo tài khoản.");
    } finally {
      setSaving(false);
    }
  }

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") ?? "").trim();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (action.kind === "status") {
        await cmsApi.setTenantAccountStatus(
          organizationId,
          action.account.id,
          action.status,
          reason
        );
        setSuccess(
          action.status === "SUSPENDED"
            ? "Đã khóa tài khoản và thu hồi session đang hoạt động."
            : "Đã mở lại tài khoản."
        );
      } else if (action.kind === "resetPassword") {
        await cmsApi.resetTenantAccountPassword(
          organizationId,
          action.account.id,
          String(form.get("temporaryPassword") ?? ""),
          reason
        );
        setSuccess("Đã đặt mật khẩu tạm mới và thu hồi toàn bộ session.");
      } else {
        await cmsApi.revokeTenantAccountSessions(
          organizationId,
          action.account.id,
          reason
        );
        setSuccess("Đã thu hồi toàn bộ session của tài khoản.");
      }
      setAction(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể cập nhật tài khoản.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="cms-content" style={{ maxWidth: 1180, margin: "0 auto", padding: 28 }}>
      <header className="cms-topbar" style={{ marginBottom: 24 }}>
        <div>
          <span className="cms-eyebrow">CONTROL PLANE · TENANT ACCOUNTS</span>
          <h1>{organization?.name ?? "Tenant accounts"}</h1>
          <p className="cms-note">
            Account gắn cố định với tenant. Quota hiện tại: <strong>{quotaLabel}</strong>.
          </p>
        </div>
        <div className="cms-topbar__actions">
          <Link className="secondary-button" href="/">
            ← CMS
          </Link>
          <button
            className="primary-button"
            type="button"
            disabled={!data || data.used >= data.limit}
            onClick={() => setShowCreate((value) => !value)}
          >
            {showCreate ? "Đóng" : "+ Tạo tài khoản"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="cms-state cms-state--error" role="alert">
          <strong>Thao tác chưa hoàn tất.</strong>
          <span>{error}</span>
        </div>
      ) : null}
      {success ? (
        <div className="cms-state">
          <strong>Thành công.</strong>
          <span>{success}</span>
        </div>
      ) : null}

      {showCreate ? (
        <section className="cms-panel" style={{ marginBottom: 24 }}>
          <h2>Tạo tài khoản trong tenant</h2>
          <p className="cms-note">
            CMS có thể tạo cả OWNER. Tài khoản mới chiếm một seat ngay khi tạo.
          </p>
          <form onSubmit={(event) => void createAccount(event)} className="cms-form-grid">
            <label>
              Họ tên
              <input name="displayName" required />
            </label>
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <label>
              Role
              <select name="role" defaultValue="STAFF">
                {roles.map((role) => <option key={role}>{role}</option>)}
              </select>
            </label>
            <label>
              Mật khẩu tạm
              <input name="temporaryPassword" type="password" minLength={12} required />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Lý do thao tác
              <input
                name="reason"
                placeholder="Ví dụ: Khởi tạo OWNER cho khách hàng"
                required
              />
            </label>
            <div style={{ gridColumn: "1 / -1" }}>
              <button className="primary-button" type="submit" disabled={saving}>
                {saving ? "Đang tạo…" : "Tạo tài khoản"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="cms-panel">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
          <div>
            <span className="cms-eyebrow">ACCOUNTS</span>
            <h2>{data?.accounts.length ?? 0} tài khoản</h2>
          </div>
          <strong>{quotaLabel} seats</strong>
        </div>

        {loading ? (
          <div className="cms-state">Đang tải tài khoản…</div>
        ) : data?.accounts.length ? (
          <div className="cms-table-wrap">
            <table className="cms-table">
              <thead>
                <tr>
                  <th>Tài khoản</th>
                  <th>Role</th>
                  <th>Trạng thái</th>
                  <th>Membership</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <strong>{account.displayName}</strong>
                      <small>{account.email}</small>
                    </td>
                    <td>{account.role}</td>
                    <td>
                      <StatusBadge tone={account.userStatus === "ACTIVE" ? "success" : "danger"}>
                        {account.userStatus}
                      </StatusBadge>
                    </td>
                    <td>
                      <StatusBadge tone={account.membershipStatus === "ACTIVE" ? "success" : "warning"}>
                        {account.membershipStatus}
                      </StatusBadge>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          className={account.userStatus === "ACTIVE" ? "text-button text-button--danger" : "text-button"}
                          type="button"
                          onClick={() =>
                            setAction({
                              kind: "status",
                              account,
                              status: account.userStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE"
                            })
                          }
                        >
                          {account.userStatus === "ACTIVE" ? "Khóa" : "Mở lại"}
                        </button>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => setAction({ kind: "resetPassword", account })}
                        >
                          Reset mật khẩu
                        </button>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => setAction({ kind: "revokeSessions", account })}
                        >
                          Revoke sessions
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="cms-state">Tenant chưa có tài khoản.</div>
        )}
      </section>

      {action ? (
        <div className="cms-modal-backdrop" role="presentation">
          <section className="cms-modal" role="dialog" aria-modal="true">
            <h2>
              {action.kind === "status"
                ? action.status === "SUSPENDED"
                  ? "Khóa tài khoản"
                  : "Mở lại tài khoản"
                : action.kind === "resetPassword"
                  ? "Reset mật khẩu"
                  : "Thu hồi toàn bộ session"}
            </h2>
            <p className="modal-warning">
              {action.account.displayName} · {action.account.email}
              {action.kind === "status" && action.status === "SUSPENDED"
                ? ". Session đang hoạt động sẽ bị thu hồi ngay."
                : action.kind === "resetPassword"
                  ? ". Mật khẩu hiện tại mất hiệu lực và mọi session sẽ bị thu hồi."
                  : ". Người dùng phải đăng nhập lại trên mọi thiết bị."}
            </p>
            <form onSubmit={(event) => void submitAction(event)}>
              {action.kind === "resetPassword" ? (
                <label>
                  Mật khẩu tạm mới
                  <input
                    name="temporaryPassword"
                    type="password"
                    minLength={12}
                    required
                  />
                </label>
              ) : null}
              <label>
                Lý do
                <input name="reason" required />
              </label>
              <div className="table-actions" style={{ marginTop: 18 }}>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setAction(null)}
                  disabled={saving}
                >
                  Hủy
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? "Đang xử lý…" : "Xác nhận"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
