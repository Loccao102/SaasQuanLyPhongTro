"use client";

import Link from "next/link";
import { TotpQrCode } from "@propops/ui/totp-qr";
import { HabiBrand, HabiMark } from "@propops/ui/habi-brand";
import {
  AccountBookOutlined,
  ApartmentOutlined,
  BarChartOutlined,
  BellOutlined,
  CloseOutlined,
  CrownOutlined,
  DashboardOutlined,
  DollarOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  WalletOutlined
} from "@ant-design/icons";
import {
  authenticateWithPasskey,
  browserSupportsPasskeys,
  createPasskey
} from "@propops/ui/passkey";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useAdminAuth } from "./admin-auth-provider";
import {
  adminAuthApi,
  type AdminAuthSessionItem,
  type AdminTenantFeatureKey,
  type PasskeyItem,
  type SecurityAlertItem
} from "../lib/admin-auth-api";
import {
  rejectAdminStepUp,
  resolveAdminStepUp,
  subscribeToAdminStepUpRequired
} from "../lib/step-up";

const navItems: Array<{
  label: string;
  href: string;
  icon: ReactNode;
  feature?: AdminTenantFeatureKey;
}> = [
  { label: "Tổng quan", href: "/", icon: <DashboardOutlined /> },
  { label: "Tài sản", href: "/assets", icon: <ApartmentOutlined />, feature: "properties" },
  { label: "Hợp đồng", href: "/leases", icon: <FileTextOutlined />, feature: "leases" },
  { label: "Chốt số", href: "/metering", icon: <ThunderboltOutlined />, feature: "metering" },
  { label: "Hóa đơn", href: "/billing", icon: <FileDoneOutlined />, feature: "billing" },
  { label: "Thu tiền", href: "/payments", icon: <DollarOutlined />, feature: "payments" },
  { label: "Tín dụng", href: "/credit-balance", icon: <WalletOutlined />, feature: "credit_balance" },
  { label: "Sổ quỹ Thu - Chi", href: "/finances", icon: <AccountBookOutlined />, feature: "finances" },
  { label: "Báo cáo", href: "/reports", icon: <BarChartOutlined />, feature: "reports" },
  { label: "Báo hỏng & Sửa chữa", href: "/maintenance", icon: <ToolOutlined />, feature: "maintenance" },
  { label: "Thông báo", href: "/notifications", icon: <BellOutlined />, feature: "notifications" },
  { label: "Zalo 1 Chạm", href: "/zalo-personal", icon: <ThunderboltOutlined />, feature: "notifications" },
  { label: "Đội ngũ", href: "/team", icon: <TeamOutlined />, feature: "team_management" },
  { label: "Gói dịch vụ", href: "/subscription", icon: <CrownOutlined /> }
];

function initials(value: string): string {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }

  return (
    parts[0]![0]! + parts[parts.length - 1]![0]!
  ).toUpperCase();
}

export function AdminShell({
  title,
  eyebrow = "HABI ADMIN",
  activeNav,
  children,
  notificationCount
}: {
  title: string;
  eyebrow?: string;
  activeNav: string;
  children: ReactNode;
  notificationCount?: number | null;
}) {
  const auth = useAdminAuth();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [changePasswordSuccess, setChangePasswordSuccess] = useState<string | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessions, setSessions] = useState<AdminAuthSessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsSuccess, setSessionsSuccess] = useState<string | null>(null);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [mfaRequiredByRole, setMfaRequiredByRole] = useState<string | null>(null);
  const [mfaSetup, setMfaSetup] = useState<{
    secret: string;
    provisioningUri: string;
  } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState<string[]>([]);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([]);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyName, setPasskeyName] = useState("Thiết bị này");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpBusy, setStepUpBusy] = useState(false);
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const [stepUpPassword, setStepUpPassword] = useState("");
  const [stepUpCode, setStepUpCode] = useState("");
  const [securityAlerts, setSecurityAlerts] = useState<SecurityAlertItem[]>([]);
  const [recentAuthStatus, setRecentAuthStatus] = useState<{
    recent: boolean;
    reauthenticatedAt: string;
    expiresAt: string;
  } | null>(null);

  useEffect(() => {
    setPasskeySupported(browserSupportsPasskeys());
    return subscribeToAdminStepUpRequired(() => {
      setStepUpError(null);
      setStepUpPassword("");
      setStepUpCode("");
      setStepUpOpen(true);
    });
  }, []);

  async function completeStepUp(
    action: () => Promise<unknown>
  ) {
    setStepUpBusy(true);
    setStepUpError(null);
    try {
      await action();
      setStepUpOpen(false);
      setStepUpPassword("");
      setStepUpCode("");
      resolveAdminStepUp();
    } catch (err) {
      setStepUpError(
        err instanceof Error ? err.message : "Không thể xác thực lại phiên."
      );
    } finally {
      setStepUpBusy(false);
    }
  }

  async function completePasskeyStepUp() {
    await completeStepUp(async () => {
      const options = await adminAuthApi.stepUpPasskeyOptions();
      const response = await authenticateWithPasskey(options);
      await adminAuthApi.stepUpPasskeyVerify(response);
    });
  }

  function cancelStepUp() {
    setStepUpOpen(false);
    setStepUpPassword("");
    setStepUpCode("");
    setStepUpError(null);
    rejectAdminStepUp();
  }

  async function loadSessions() {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const result = await adminAuthApi.sessions();
      setSessions(result.sessions);
    } catch (err) {
      setSessionsError(
        err instanceof Error ? err.message : "Không thể tải danh sách phiên."
      );
    } finally {
      setSessionsLoading(false);
    }
  }

  async function openSessions() {
    setSessionsOpen(true);
    setSessionsSuccess(null);
    await loadSessions();
  }

  async function revokeSession(session: AdminAuthSessionItem) {
    const message = session.current
      ? "Thu hồi phiên hiện tại? Bạn sẽ phải đăng nhập lại."
      : "Thu hồi phiên đăng nhập này? Thiết bị đó sẽ phải đăng nhập lại.";
    if (!window.confirm(message)) return;

    setSessionsLoading(true);
    setSessionsError(null);
    setSessionsSuccess(null);
    try {
      const result = await adminAuthApi.revokeSession(session.id);
      if (result.currentSessionRevoked) {
        window.location.assign("/login");
        return;
      }
      setSessionsSuccess("Đã thu hồi phiên đăng nhập.");
      await loadSessions();
    } catch (err) {
      setSessionsError(
        err instanceof Error ? err.message : "Không thể thu hồi phiên."
      );
    } finally {
      setSessionsLoading(false);
    }
  }

  async function revokeOtherSessions() {
    if (
      !window.confirm(
        "Thu hồi tất cả phiên khác? Các thiết bị khác sẽ phải đăng nhập lại."
      )
    ) {
      return;
    }

    setSessionsLoading(true);
    setSessionsError(null);
    setSessionsSuccess(null);
    try {
      const result = await adminAuthApi.revokeOtherSessions();
      setSessionsSuccess(
        result.revokedSessions > 0
          ? "Đã thu hồi " + String(result.revokedSessions) + " phiên khác."
          : "Không có phiên khác cần thu hồi."
      );
      await loadSessions();
    } catch (err) {
      setSessionsError(
        err instanceof Error ? err.message : "Không thể thu hồi các phiên khác."
      );
    } finally {
      setSessionsLoading(false);
    }
  }

  async function openMfa() {
    setMfaOpen(true);
    setMfaLoading(true);
    setMfaError(null);
    setMfaSetup(null);
    setMfaRecoveryCodes([]);
    setMfaCode("");
    try {
      setPasskeySupported(browserSupportsPasskeys());
      const [status, passkeyResult, recentAuth, alertResult] =
        await Promise.all([
          adminAuthApi.mfaStatus(),
          adminAuthApi.passkeys(),
          adminAuthApi.stepUpStatus(),
          adminAuthApi.securityAlerts()
        ]);
      setMfaEnabled(status.enabled);
      setMfaRequiredByRole(
        status.required ? status.requiredByRole : null
      );
      setPasskeys(passkeyResult.passkeys);
      setRecentAuthStatus(recentAuth);
      setSecurityAlerts(alertResult.alerts);
    } catch (err) {
      setMfaError(
        err instanceof Error ? err.message : "Không thể tải trạng thái MFA."
      );
    } finally {
      setMfaLoading(false);
    }
  }

  async function beginMfaSetup() {
    setMfaLoading(true);
    setMfaError(null);
    setMfaRecoveryCodes([]);
    try {
      setMfaSetup(await adminAuthApi.setupMfa());
    } catch (err) {
      setMfaError(
        err instanceof Error ? err.message : "Không thể bắt đầu thiết lập MFA."
      );
    } finally {
      setMfaLoading(false);
    }
  }

  async function confirmMfaSetup() {
    if (!mfaCode.trim()) return;
    setMfaLoading(true);
    setMfaError(null);
    try {
      const result = await adminAuthApi.confirmMfa(mfaCode);
      setMfaRecoveryCodes(result.recoveryCodes);
      setMfaEnabled(true);
      setMfaSetup(null);
      setMfaCode("");
    } catch (err) {
      setMfaError(
        err instanceof Error ? err.message : "Mã xác thực không hợp lệ."
      );
    } finally {
      setMfaLoading(false);
    }
  }

  async function disableMfa() {
    if (!mfaCode.trim()) return;
    if (
      !window.confirm(
        "Tắt xác thực hai bước? Các phiên đăng nhập khác sẽ bị thu hồi."
      )
    ) {
      return;
    }

    setMfaLoading(true);
    setMfaError(null);
    try {
      await adminAuthApi.disableMfa(mfaCode);
      setMfaEnabled(false);
      setMfaCode("");
      setMfaRecoveryCodes([]);
      setMfaSetup(null);
    } catch (err) {
      setMfaError(
        err instanceof Error ? err.message : "Không thể tắt MFA."
      );
    } finally {
      setMfaLoading(false);
    }
  }

  async function registerPasskey() {
    if (!passkeySupported) {
      setMfaError("Trình duyệt hoặc thiết bị này chưa hỗ trợ passkey.");
      return;
    }

    setPasskeyBusy(true);
    setMfaError(null);
    try {
      const options = await adminAuthApi.passkeyRegistrationOptions();
      const response = await createPasskey(options);
      await adminAuthApi.verifyPasskeyRegistration({
        response,
        name: passkeyName
      });
      const result = await adminAuthApi.passkeys();
      setPasskeys(result.passkeys);
      setPasskeyName("Thiết bị này");
    } catch (err) {
      setMfaError(
        err instanceof Error ? err.message : "Không thể đăng ký passkey."
      );
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function revokePasskey(passkey: PasskeyItem) {
    if (
      !window.confirm(
        "Thu hồi passkey “" + passkey.name + "”? Thiết bị đó sẽ không dùng được passkey này nữa."
      )
    ) {
      return;
    }

    setPasskeyBusy(true);
    setMfaError(null);
    try {
      await adminAuthApi.revokePasskey(passkey.id);
      const result = await adminAuthApi.passkeys();
      setPasskeys(result.passkeys);
    } catch (err) {
      setMfaError(
        err instanceof Error ? err.message : "Không thể thu hồi passkey."
      );
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function handleChangePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setChangePasswordError(null);
    setChangePasswordSuccess(null);

    if (newPassword.length < 12) {
      setChangePasswordError("Mật khẩu mới phải có tối thiểu 12 ký tự để đảm bảo an toàn.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setChangePasswordError("Mật khẩu xác nhận không khớp với mật khẩu mới.");
      return;
    }

    if (currentPassword === newPassword) {
      setChangePasswordError("Mật khẩu mới không được trùng với mật khẩu hiện tại.");
      return;
    }

    setChangingPassword(true);
    try {
      const res = await adminAuthApi.changePassword({
        currentPassword,
        newPassword
      });
      setChangePasswordSuccess(res.message || "Đã đổi mật khẩu thành công!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        setChangePasswordOpen(false);
        setChangePasswordSuccess(null);
      }, 2000);
    } catch (err) {
      setChangePasswordError(err instanceof Error ? err.message : "Không thể đổi mật khẩu.");
    } finally {
      setChangingPassword(false);
    }
  }

  if (auth.status === "loading") {
    return (
      <main className="session-state-page" aria-live="polite">
        <div className="session-state-card">
          <HabiMark size={34} className="brand__mark brand__mark--logo" />
          <strong>Đang xác thực phiên làm việc…</strong>
          <span>Habi đang tải tài khoản và phạm vi vận hành.</span>
        </div>
      </main>
    );
  }

  if (auth.status === "error") {
    return (
      <main className="session-state-page">
        <div className="session-state-card session-state-card--error">
          <HabiMark size={34} className="brand__mark brand__mark--logo" />
          <strong>Không thể tải phiên làm việc.</strong>
          <span>{auth.error}</span>
          <button
            className="primary-button"
            type="button"
            onClick={() => void auth.refresh()}
          >
            Thử lại
          </button>
        </div>
      </main>
    );
  }

  if (
    auth.status !== "authenticated" ||
    !auth.session
  ) {
    return (
      <main className="session-state-page" aria-live="polite">
        <div className="session-state-card">
          <strong>Đang chuyển tới trang đăng nhập…</strong>
        </div>
      </main>
    );
  }

  if (!auth.selectedMembership) {
    return (
      <main className="session-state-page">
        <div className="session-state-card">
          <HabiMark size={34} className="brand__mark brand__mark--logo" />
          <strong>Tài khoản chưa có workspace hoạt động.</strong>
          <span>
            Hãy nhờ chủ hệ thống cấp membership trước khi truy cập dữ liệu vận hành.
          </span>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void auth.logout()}
          >
            Đăng xuất
          </button>
        </div>
      </main>
    );
  }

  const userLabel =
    auth.session.user.displayName || auth.session.user.email;

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <HabiBrand compact className="brand habi-brand sidebar-brand" />

        <nav className="sidebar__nav" aria-label="Điều hướng chính">
          {navItems
            .filter(
              (item) =>
                !item.feature ||
                auth.session?.features?.[item.feature] !== false
            )
            .map((item) => {
            const className =
              item.label === activeNav
                ? "nav-item nav-item--active"
                : "nav-item";
            const content = (
              <>
                <span className="nav-item__icon" aria-hidden="true">{item.icon}</span>
                {item.label}
              </>
            );

            return item.href === "#" ? (
              <a className={className} href="#" key={item.label}>
                {content}
              </a>
            ) : (
              <Link
                className={className}
                href={item.href}
                key={item.label}
                aria-current={
                  item.label === activeNav ? "page" : undefined
                }
              >
                {content}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <a className="nav-item" href="#">
            <span className="nav-item__icon" aria-hidden="true"><SettingOutlined /></span>
            Cài đặt
          </a>

          <div className="workspace-card">
            <span>Tenant hiện tại</span>
            <strong>{auth.selectedMembership.organizationName}</strong>
            <small>
              {auth.selectedMembership.role} · tài khoản gắn cố định tenant này
            </small>
          </div>

          <div className="account-card">
            <span className="account-card__avatar">
              {initials(userLabel)}
            </span>
            <div>
              <strong>{userLabel}</strong>
              <span>{auth.session.user.email}</span>
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                type="button"
                className="secondary-button secondary-button--compact"
                onClick={() => {
                  setChangePasswordOpen(true);
                  setChangePasswordError(null);
                  setChangePasswordSuccess(null);
                }}
              >
                Đổi MK
              </button>
              <button
                type="button"
                className="secondary-button secondary-button--compact"
                onClick={() => void openMfa()}
              >
                MFA
              </button>
              <button
                type="button"
                className="secondary-button secondary-button--compact"
                onClick={() => void openSessions()}
              >
                Phiên
              </button>
              <button
                type="button"
                onClick={() => void auth.logout()}
              >
                Đăng xuất
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main className="admin-main">
        <header className="topbar">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h1>{title}</h1>
          </div>
          <div className="topbar__actions">
            <Link
              href="/notifications"
              className="icon-button icon-button--notification"
              aria-label={notificationCount != null && notificationCount > 0
                ? String(notificationCount) + " thông báo cần xử lý"
                : "Xem thông báo"}
              title="Xem thông báo"
            >
              <BellOutlined aria-hidden="true" />
              {notificationCount != null && notificationCount > 0 ? (
                <span className="notification-count">
                  {notificationCount > 99 ? "99+" : notificationCount}
                </span>
              ) : null}
            </Link>
            <button
              className="avatar-button"
              type="button"
              aria-label={"Tài khoản " + userLabel}
              onClick={() => {
                setChangePasswordOpen(true);
                setChangePasswordError(null);
                setChangePasswordSuccess(null);
              }}
              title="Đổi mật khẩu tài khoản"
              style={{ cursor: "pointer", border: "none" }}
            >
              {initials(userLabel)}
            </button>
          </div>
        </header>

        <div className="dashboard-content">{children}</div>
      </main>

      {changePasswordOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="change-password-title"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px"
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setChangePasswordOpen(false);
          }}
        >
          <div
            style={{
              background: "var(--color-surface, #ffffff)",
              borderRadius: "12px",
              padding: "24px",
              maxWidth: "460px",
              width: "100%",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
              border: "1px solid var(--color-border, #e2e8f0)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 id="change-password-title" style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
                Đổi mật khẩu tài khoản
              </h3>
              <button
                type="button"
                onClick={() => setChangePasswordOpen(false)}
                aria-label="Đóng"
                style={{ cursor: "pointer", background: "none", border: "none", fontSize: "18px", color: "var(--color-muted)" }}
              >
                <CloseOutlined aria-hidden="true" />
              </button>
            </div>

            <p style={{ fontSize: "13px", color: "var(--color-muted, #64748b)", margin: "0 0 16px 0" }}>
              Tài khoản: <strong>{auth.session.user.email}</strong>. Mật khẩu mới cần tối thiểu 12 ký tự để đảm bảo an toàn.
            </p>

            {changePasswordError ? (
              <div className="admin-state admin-state--error" style={{ marginBottom: "16px" }}>
                <span>{changePasswordError}</span>
              </div>
            ) : null}

            {changePasswordSuccess ? (
              <div className="admin-state admin-state--success" style={{ marginBottom: "16px" }}>
                <span>{changePasswordSuccess}</span>
              </div>
            ) : null}

            <form onSubmit={(e) => void handleChangePassword(e)} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
                <span style={{ fontWeight: 600 }}>Mật khẩu hiện tại *</span>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Nhập mật khẩu đang sử dụng"
                  style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--color-border)" }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
                <span style={{ fontWeight: 600 }}>Mật khẩu mới (tối thiểu 12 ký tự) *</span>
                <input
                  type="password"
                  required
                  minLength={12}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Nhập mật khẩu mới an toàn"
                  style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--color-border)" }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
                <span style={{ fontWeight: 600 }}>Xác nhận mật khẩu mới *</span>
                <input
                  type="password"
                  required
                  minLength={12}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Nhập lại mật khẩu mới"
                  style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--color-border)" }}
                />
              </label>

              <div className="button-row" style={{ marginTop: "12px", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setChangePasswordOpen(false)}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                >
                  {changingPassword ? "Đang cập nhật…" : "Cập nhật mật khẩu"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {stepUpOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-step-up-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 20000,
            display: "grid",
            placeItems: "center",
            padding: 20,
            background: "rgba(15, 23, 42, 0.64)",
            backdropFilter: "blur(5px)"
          }}
        >
          <section
            style={{
              width: "min(480px, 100%)",
              borderRadius: 16,
              border: "1px solid var(--color-border, #e2e8f0)",
              background: "var(--color-surface, #ffffff)",
              padding: 22,
              display: "grid",
              gap: 14,
              boxShadow: "0 24px 70px rgba(15,23,42,.24)"
            }}
          >
            <div>
              <span className="eyebrow">RECENT AUTHENTICATION</span>
              <h3 id="admin-step-up-title" style={{ margin: "5px 0 6px" }}>
                Xác thực lại để tiếp tục
              </h3>
              <p style={{ margin: 0, color: "var(--color-muted)" }}>
                Thay đổi security cần một lần xác thực gần đây. Request hiện
                tại sẽ tự tiếp tục sau khi xác thực thành công.
              </p>
            </div>

            {stepUpError ? (
              <div className="admin-state admin-state--error" role="alert">
                <span>{stepUpError}</span>
              </div>
            ) : null}

            <label style={{ display: "grid", gap: 6 }}>
              <span>Mật khẩu hiện tại</span>
              <input
                type="password"
                autoComplete="current-password"
                value={stepUpPassword}
                disabled={stepUpBusy}
                onChange={(event) => setStepUpPassword(event.target.value)}
                placeholder="Dùng nếu tài khoản có password"
              />
            </label>
            <button
              className="secondary-button"
              type="button"
              disabled={stepUpBusy || !stepUpPassword.trim()}
              onClick={() =>
                void completeStepUp(() =>
                  adminAuthApi.stepUpPassword(stepUpPassword)
                )
              }
            >
              {stepUpBusy ? "Đang xác thực…" : "Xác thực bằng mật khẩu"}
            </button>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: 8
              }}
            >
              <input
                autoComplete="one-time-code"
                value={stepUpCode}
                disabled={stepUpBusy}
                onChange={(event) => setStepUpCode(event.target.value)}
                placeholder="TOTP hoặc recovery code"
              />
              <button
                className="secondary-button"
                type="button"
                disabled={stepUpBusy || !stepUpCode.trim()}
                onClick={() =>
                  void completeStepUp(() =>
                    adminAuthApi.stepUpCode(stepUpCode)
                  )
                }
              >
                Xác nhận mã
              </button>
            </div>

            {passkeySupported ? (
              <button
                className="primary-button"
                type="button"
                disabled={stepUpBusy}
                onClick={() => void completePasskeyStepUp()}
              >
                Dùng passkey / Windows Hello / Touch ID
              </button>
            ) : null}

            <button
              className="text-button"
              type="button"
              disabled={stepUpBusy}
              onClick={cancelStepUp}
              style={{ justifySelf: "start" }}
            >
              Hủy thao tác
            </button>
          </section>
        </div>
      ) : null}

      {mfaOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mfa-title"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px"
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setMfaOpen(false);
          }}
        >
          <div
            style={{
              background: "var(--color-surface, #ffffff)",
              borderRadius: "12px",
              padding: "24px",
              maxWidth: "560px",
              width: "100%",
              maxHeight: "82vh",
              overflowY: "auto",
              border: "1px solid var(--color-border, #e2e8f0)"
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                alignItems: "center"
              }}
            >
              <div>
                <span className="eyebrow">BẢO MẬT TÀI KHOẢN</span>
                <h3 id="mfa-title" style={{ margin: "4px 0 0" }}>
                  Xác thực hai bước
                </h3>
              </div>
              <button
                className="secondary-button secondary-button--compact"
                type="button"
                onClick={() => setMfaOpen(false)}
              >
                Đóng
              </button>
            </div>

            {recentAuthStatus ? (
              <div className="admin-state">
                <span>
                  Recent authentication:{" "}
                  {recentAuthStatus.recent
                    ? "còn hiệu lực đến " +
                      new Date(recentAuthStatus.expiresAt).toLocaleTimeString(
                        "vi-VN"
                      )
                    : "đã hết hạn — thay đổi security tiếp theo sẽ yêu cầu xác thực lại"}
                </span>
              </div>
            ) : null}

            {mfaError ? (
              <div className="admin-state admin-state--error" role="alert">
                <span>{mfaError}</span>
              </div>
            ) : null}

            {mfaLoading && mfaEnabled === null ? (
              <div className="admin-state">Đang tải trạng thái MFA…</div>
            ) : null}

            {mfaRecoveryCodes.length > 0 ? (
              <div style={{ display: "grid", gap: "12px", marginTop: "16px" }}>
                <div className="admin-state admin-state--success">
                  <span>
                    MFA đã bật. Lưu các recovery code này ở nơi an toàn. Mỗi mã
                    chỉ dùng được một lần và Habi sẽ không hiển thị lại.
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gap: "6px",
                    fontFamily: "monospace",
                    background: "var(--color-background, #f8fafc)",
                    padding: "14px",
                    borderRadius: "8px"
                  }}
                >
                  {mfaRecoveryCodes.map((code) => (
                    <code key={code}>{code}</code>
                  ))}
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      mfaRecoveryCodes.join("\n")
                    )
                  }
                >
                  Copy recovery codes
                </button>
              </div>
            ) : mfaEnabled === false ? (
              <div style={{ display: "grid", gap: "14px", marginTop: "16px" }}>
                {!mfaSetup ? (
                  <>
                    <p style={{ margin: 0 }}>
                      {mfaRequiredByRole
                        ? "Role " +
                          mfaRequiredByRole +
                          " đang bắt buộc MFA. "
                        : ""}
                      Dùng Google Authenticator, Microsoft Authenticator, 1Password
                      hoặc ứng dụng TOTP tương thích.
                    </p>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={mfaLoading}
                      onClick={() => void beginMfaSetup()}
                    >
                      {mfaLoading ? "Đang tạo secret…" : "Bắt đầu thiết lập MFA"}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="admin-state">
                      <span>
                        Thêm tài khoản bằng URI dưới đây hoặc nhập secret thủ
                        công vào ứng dụng Authenticator.
                      </span>
                    </div>
                    <div style={{ display: "grid", placeItems: "center" }}>
                      <TotpQrCode value={mfaSetup.provisioningUri} />
                    </div>
                    <p style={{ margin: 0, color: "var(--color-muted)" }}>
                      Quét QR trực tiếp trong Habi; secret không được gửi tới
                      dịch vụ QR bên thứ ba.
                    </p>
                    <details>
                      <summary>Không quét được QR?</summary>
                      <label style={{ display: "grid", gap: "6px", marginTop: 8 }}>
                        <span style={{ fontWeight: 600 }}>Secret</span>
                        <input readOnly value={mfaSetup.secret} />
                      </label>
                    </details>
                    <label style={{ display: "grid", gap: "6px" }}>
                      <span style={{ fontWeight: 600 }}>
                        Mã 6 số để xác nhận
                      </span>
                      <input
                        value={mfaCode}
                        onChange={(event) => setMfaCode(event.target.value)}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="123456"
                      />
                    </label>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={mfaLoading || mfaCode.trim().length === 0}
                      onClick={() => void confirmMfaSetup()}
                    >
                      {mfaLoading ? "Đang xác nhận…" : "Bật MFA"}
                    </button>
                  </>
                )}
              </div>
            ) : mfaEnabled === true && mfaRecoveryCodes.length === 0 ? (
              <div style={{ display: "grid", gap: "14px", marginTop: "16px" }}>
                <div className="admin-state admin-state--success">
                  <span>
                    MFA đang bật. Những lần đăng nhập mới sẽ cần mã TOTP hoặc
                    recovery code.
                    {mfaRequiredByRole
                      ? " Role " +
                        mfaRequiredByRole +
                        " đang thuộc policy bắt buộc MFA."
                      : ""}
                  </span>
                </div>
                {mfaRequiredByRole ? (
                  <div className="admin-state">
                    MFA không thể tắt khi role {mfaRequiredByRole} còn nằm
                    trong policy bảo mật.
                  </div>
                ) : (
                  <>
                    <label style={{ display: "grid", gap: "6px" }}>
                      <span style={{ fontWeight: 600 }}>
                        Mã TOTP / recovery code để tắt MFA
                      </span>
                      <input
                        value={mfaCode}
                        onChange={(event) => setMfaCode(event.target.value)}
                        autoComplete="one-time-code"
                        placeholder="123456 hoặc HABI-..."
                      />
                    </label>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={mfaLoading || mfaCode.trim().length === 0}
                      onClick={() => void disableMfa()}
                    >
                      {mfaLoading ? "Đang xử lý…" : "Tắt MFA"}
                    </button>
                  </>
                )}
              </div>
            ) : null}

            <div
              style={{
                marginTop: 22,
                paddingTop: 18,
                borderTop: "1px solid var(--color-border, #e2e8f0)",
                display: "grid",
                gap: 10
              }}
            >
              <div>
                <strong>Cảnh báo bảo mật gần đây</strong>
                <p
                  style={{
                    margin: "6px 0 0",
                    color: "var(--color-muted)",
                    fontSize: 13
                  }}
                >
                  Các thay đổi credential hoặc pattern xác thực đáng chú ý.
                </p>
              </div>
              {securityAlerts.length === 0 ? (
                <small>Chưa có cảnh báo bảo mật nào.</small>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {securityAlerts.slice(0, 6).map((alert) => (
                    <article
                      key={alert.id}
                      style={{
                        border: "1px solid var(--color-border, #e2e8f0)",
                        borderRadius: 9,
                        padding: 10,
                        display: "grid",
                        gap: 4
                      }}
                    >
                      <strong>
                        {alert.severity === "HIGH"
                          ? "Quan trọng"
                          : alert.severity === "MEDIUM"
                            ? "Cần chú ý"
                            : "Thông tin"}
                      </strong>
                      <span>{alert.summary}</span>
                      <small>
                        {new Date(alert.createdAt).toLocaleString("vi-VN")}
                        {alert.deliveryStatus === "SENT"
                          ? " · đã gửi email"
                          : ""}
                      </small>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div
              style={{
                marginTop: 22,
                paddingTop: 18,
                borderTop: "1px solid var(--color-border, #e2e8f0)",
                display: "grid",
                gap: 12
              }}
            >
              <div>
                <strong>Passkey / Windows Hello / Touch ID</strong>
                <p
                  style={{
                    margin: "6px 0 0",
                    color: "var(--color-muted)",
                    fontSize: 13
                  }}
                >
                  Passkey có thể thay mã TOTP ở bước xác thực hai lớp sau khi
                  email/mật khẩu hoặc Google đã được xác minh.
                </p>
              </div>

              {passkeySupported ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    gap: 8
                  }}
                >
                  <input
                    value={passkeyName}
                    onChange={(event) => setPasskeyName(event.target.value)}
                    placeholder="VD: Laptop Windows Hello"
                    maxLength={80}
                    disabled={passkeyBusy}
                  />
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={passkeyBusy}
                    onClick={() => void registerPasskey()}
                  >
                    {passkeyBusy ? "Đang xử lý…" : "Thêm passkey"}
                  </button>
                </div>
              ) : (
                <div className="admin-state">
                  Trình duyệt/thiết bị này chưa hỗ trợ WebAuthn passkey.
                </div>
              )}

              {passkeys.length === 0 ? (
                <small>Chưa có passkey nào được đăng ký.</small>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {passkeys.map((passkey) => (
                    <article
                      key={passkey.id}
                      style={{
                        border: "1px solid var(--color-border, #e2e8f0)",
                        borderRadius: 9,
                        padding: 12,
                        display: "grid",
                        gap: 4
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10
                        }}
                      >
                        <strong>{passkey.name}</strong>
                        <button
                          className="text-button text-button--danger"
                          type="button"
                          disabled={passkeyBusy}
                          onClick={() => void revokePasskey(passkey)}
                        >
                          Thu hồi
                        </button>
                      </div>
                      <small>
                        {passkey.deviceType === "multiDevice"
                          ? "Passkey đồng bộ"
                          : "Passkey trên thiết bị"}
                        {passkey.backedUp ? " · đã backup" : ""}
                      </small>
                      <small>
                        Tạo lúc:{" "}
                        {new Date(passkey.createdAt).toLocaleString("vi-VN")}
                      </small>
                      {passkey.lastUsedAt ? (
                        <small>
                          Dùng gần nhất:{" "}
                          {new Date(passkey.lastUsedAt).toLocaleString("vi-VN")}
                        </small>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {sessionsOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sessions-title"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px"
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSessionsOpen(false);
          }}
        >
          <div
            style={{
              background: "var(--color-surface, #ffffff)",
              borderRadius: "12px",
              padding: "24px",
              maxWidth: "620px",
              width: "100%",
              maxHeight: "80vh",
              overflowY: "auto",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
              border: "1px solid var(--color-border, #e2e8f0)"
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
                marginBottom: "12px"
              }}
            >
              <div>
                <span className="eyebrow">BẢO MẬT TÀI KHOẢN</span>
                <h3 id="sessions-title" style={{ margin: "4px 0 0" }}>
                  Phiên đăng nhập
                </h3>
              </div>
              <button
                type="button"
                className="secondary-button secondary-button--compact"
                onClick={() => setSessionsOpen(false)}
              >
                Đóng
              </button>
            </div>

            <p style={{ color: "var(--color-muted)", fontSize: "13px" }}>
              Phiên không hoạt động quá thời gian idle sẽ tự hết hạn. Nếu thấy
              phiên lạ, hãy thu hồi phiên đó và đổi mật khẩu.
            </p>

            {sessionsError ? (
              <div className="admin-state admin-state--error" role="alert">
                <span>{sessionsError}</span>
              </div>
            ) : null}

            {sessionsSuccess ? (
              <div className="admin-state admin-state--success">
                <span>{sessionsSuccess}</span>
              </div>
            ) : null}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                margin: "14px 0"
              }}
            >
              <button
                type="button"
                className="secondary-button"
                disabled={sessionsLoading || sessions.length <= 1}
                onClick={() => void revokeOtherSessions()}
              >
                Thu hồi tất cả phiên khác
              </button>
            </div>

            {sessionsLoading && sessions.length === 0 ? (
              <div className="admin-state">Đang tải phiên đăng nhập…</div>
            ) : sessions.length === 0 ? (
              <div className="admin-state">Không có phiên đăng nhập đang hoạt động.</div>
            ) : (
              <div style={{ display: "grid", gap: "10px" }}>
                {sessions.map((session) => (
                  <article
                    key={session.id}
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: "10px",
                      padding: "14px",
                      display: "grid",
                      gap: "6px"
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                        alignItems: "center"
                      }}
                    >
                      <strong>
                        {session.current
                          ? "Phiên hiện tại"
                          : session.deviceLabel ?? "Phiên đăng nhập khác"}
                      </strong>
                      <button
                        type="button"
                        className={
                          session.current
                            ? "text-button text-button--danger"
                            : "text-button"
                        }
                        disabled={sessionsLoading}
                        onClick={() => void revokeSession(session)}
                      >
                        {session.current ? "Đăng xuất phiên này" : "Thu hồi"}
                      </button>
                    </div>
                    <small>
                      Thiết bị: {session.deviceLabel ?? "Chưa xác định"}
                    </small>
                    <small title={session.userAgent ?? undefined}>
                      Hoạt động gần nhất:{" "}
                      {new Date(session.lastSeenAt).toLocaleString("vi-VN")}
                    </small>
                    <small>
                      Tạo lúc: {new Date(session.createdAt).toLocaleString("vi-VN")}
                    </small>
                    <small>
                      Hết hạn: {new Date(session.expiresAt).toLocaleString("vi-VN")}
                    </small>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
