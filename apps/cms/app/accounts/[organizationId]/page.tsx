"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import { useParams } from "next/navigation";
import { StatusBadge } from "@propops/ui";
import {
  cmsApi,
  type CmsOrganization,
  type CmsTenantAccount,
  type CmsTenantAccountsView,
  type CmsTenantFeatureKey
} from "../../../lib/cms-api";

type AccountAction =
  | { kind: "status"; account: CmsTenantAccount; status: "ACTIVE" | "SUSPENDED" }
  | { kind: "role"; account: CmsTenantAccount }
  | { kind: "resetPassword"; account: CmsTenantAccount }
  | { kind: "resetAuthenticators"; account: CmsTenantAccount }
  | { kind: "revokeSessions"; account: CmsTenantAccount }
  | {
      kind: "feature";
      feature: CmsTenantFeatureKey;
      enabled: boolean;
      source: "PLAN" | "OVERRIDE";
    }
  | {
      kind: "featureReset";
      feature: CmsTenantFeatureKey;
    }
  | null;

const roles: CmsTenantAccount["role"][] = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "STAFF",
  "ACCOUNTANT",
  "VIEWER"
];

const featureLabels: Record<CmsTenantFeatureKey, string> = {
  properties: "Tài sản / cơ sở",
  leases: "Hợp đồng",
  metering: "Điện nước",
  pricing: "Biểu giá",
  billing: "Hóa đơn",
  payments: "Thanh toán",
  credit_balance: "Số dư khách thuê",
  finances: "Sổ quỹ",
  maintenance: "Bảo trì",
  notifications: "Thông báo",
  reports: "Báo cáo",
  team_management: "Đội ngũ & phân quyền",
  advanced_reports: "Báo cáo nâng cao",
  audit_log: "Nhật ký kiểm toán"
};

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
      } else if (action.kind === "role") {
        await cmsApi.setTenantAccountRole(
          organizationId,
          action.account.id,
          String(form.get("role") ?? action.account.role) as CmsTenantAccount["role"],
          reason
        );
        setSuccess("Đã cập nhật role tài khoản và ghi audit.");
      } else if (action.kind === "feature") {
        await cmsApi.setEntitlementOverride(
          organizationId,
          action.feature,
          {
            value: !action.enabled,
            expiresAt: null,
            reason
          }
        );
        setSuccess(
          (!action.enabled ? "Đã bật " : "Đã tắt ") +
            featureLabels[action.feature] +
            " cho tenant."
        );
      } else if (action.kind === "featureReset") {
        await cmsApi.revokeEntitlementOverride(
          organizationId,
          action.feature,
          reason
        );
        setSuccess(
          "Đã trả " + featureLabels[action.feature] + " về cấu hình theo plan."
        );
      } else if (action.kind === "resetPassword") {
        await cmsApi.resetTenantAccountPassword(
          organizationId,
          action.account.id,
          String(form.get("temporaryPassword") ?? ""),
          reason
        );
        setSuccess("Đã đặt mật khẩu tạm mới và thu hồi toàn bộ session.");
      } else if (action.kind === "resetAuthenticators") {
        const result = await cmsApi.resetTenantAccountAuthenticators(
          organizationId,
          action.account.id,
          reason
        );
        setSuccess(
          "Đã reset authenticator, xóa " +
            String(result.removedPasskeys) +
            " passkey và thu hồi " +
            String(result.sessionsRevoked) +
            " session."
        );
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
            <ArrowLeftOutlined aria-hidden="true" /> CMS
          </Link>
          <button
            className="primary-button"
            type="button"
            disabled={!data || data.used >= data.limit}
            onClick={() => setShowCreate((value) => !value)}
          >
            {showCreate ? "Đóng" : <><PlusOutlined aria-hidden="true" /> Tạo tài khoản</>}
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

      {data ? (
        <section className="cms-panel" style={{ marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
              alignItems: "center",
              marginBottom: 16
            }}
          >
            <div>
              <span className="cms-eyebrow">TENANT FEATURES</span>
              <h2>Quyền chức năng hiệu lực</h2>
              <p className="cms-note">
                {data.planCode} · {data.subscriptionStatus}. PLAN là mặc định của gói;
                OVERRIDE là ngoại lệ CMS áp riêng cho tenant này.
              </p>
            </div>
            <strong>{quotaLabel} tài khoản</strong>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12
            }}
          >
            {(Object.entries(data.features) as Array<
              [
                CmsTenantFeatureKey,
                { enabled: boolean; source: "PLAN" | "OVERRIDE" }
              ]
            >).map(([feature, state]) => (
              <article
                key={feature}
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: 10,
                  padding: 14,
                  display: "grid",
                  gap: 10
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <strong>{featureLabels[feature]}</strong>
                  <StatusBadge tone={state.enabled ? "success" : "neutral"}>
                    {state.enabled ? "BẬT" : "TẮT"}
                  </StatusBadge>
                </div>
                <small>Nguồn: {state.source}</small>
                <div className="table-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      setAction({
                        kind: "feature",
                        feature,
                        enabled: state.enabled,
                        source: state.source
                      })
                    }
                  >
                    {state.enabled ? "Tắt cho tenant" : "Bật cho tenant"}
                  </button>
                  {state.source === "OVERRIDE" ? (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        setAction({
                          kind: "featureReset",
                          feature
                        })
                      }
                    >
                      Dùng lại plan
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
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
                  <th>Bảo mật</th>
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
                      <div style={{ display: "grid", gap: 4 }}>
                        <small>
                          TOTP: {account.totpEnabled ? "Bật" : "Tắt"}
                        </small>
                        <small>
                          Passkey: {account.passkeyCount}
                        </small>
                      </div>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => setAction({ kind: "role", account })}
                        >
                          Đổi role
                        </button>
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
                          className="text-button text-button--danger"
                          type="button"
                          disabled={!account.totpEnabled && account.passkeyCount === 0}
                          onClick={() =>
                            setAction({
                              kind: "resetAuthenticators",
                              account
                            })
                          }
                        >
                          Reset MFA/passkey
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
                : action.kind === "role"
                  ? "Đổi role tài khoản"
                  : action.kind === "feature"
                    ? (action.enabled ? "Tắt " : "Bật ") + featureLabels[action.feature]
                    : action.kind === "featureReset"
                      ? "Trả về cấu hình theo plan: " + featureLabels[action.feature]
                      : action.kind === "resetPassword"
                        ? "Reset mật khẩu"
                        : action.kind === "resetAuthenticators"
                          ? "Reset MFA & passkey"
                          : "Thu hồi toàn bộ session"}
            </h2>
            <p className="modal-warning">
              {action.kind === "feature"
                ? `Thay đổi này áp cho toàn tenant và được backend enforce ngay. Nguồn hiện tại: ${action.source}.`
                : action.kind === "featureReset"
                  ? "Override hiện tại sẽ bị revoke và feature quay về giá trị của plan."
                  : `${action.account.displayName} · ${action.account.email}`}
              {action.kind === "status" && action.status === "SUSPENDED"
                ? ". Session đang hoạt động sẽ bị thu hồi ngay."
                : action.kind === "resetPassword"
                  ? ". Mật khẩu hiện tại mất hiệu lực và mọi session sẽ bị thu hồi."
                  : action.kind === "role"
                    ? ". Quyền mới có hiệu lực trên request tiếp theo."
                    : action.kind === "revokeSessions"
                      ? ". Người dùng phải đăng nhập lại trên mọi thiết bị."
                      : ""}
            </p>
            <form onSubmit={(event) => void submitAction(event)}>
              {action.kind === "role" ? (
                <label>
                  Role mới
                  <select name="role" defaultValue={action.account.role}>
                    {roles.map((role) => (
                      <option key={role}>{role}</option>
                    ))}
                  </select>
                </label>
              ) : null}
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
