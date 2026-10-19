"use client";

import Link from "next/link";
import { TotpQrCode } from "@propops/ui/totp-qr";
import { HabiBrand, HabiMark } from "@propops/ui/habi-brand";
import {
  AccountBookOutlined,
  ApartmentOutlined,
  BarChartOutlined,
  BellOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  CheckOutlined,
  CloseCircleFilled,
  CloseOutlined,
  CopyOutlined,
  CrownOutlined,
  DashboardOutlined,
  DesktopOutlined,
  DollarOutlined,
  ExclamationCircleFilled,
  EyeInvisibleOutlined,
  EyeOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  InfoCircleFilled,
  KeyOutlined,
  LaptopOutlined,
  LogoutOutlined,
  MobileOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  SafetyCertificateFilled,
  SafetyCertificateOutlined,
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
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [changePasswordSuccess, setChangePasswordSuccess] = useState<string | null>(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
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
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);
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

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await auth.logout();
    } finally {
      setLoggingOut(false);
      setLogoutConfirmOpen(false);
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
            <div className="account-card__header">
              <span className="account-card__avatar">
                {initials(userLabel)}
              </span>
              <div className="account-card__info">
                <strong className="account-card__name" title={userLabel}>
                  {userLabel}
                </strong>
                <span className="account-card__email" title={auth.session.user.email}>
                  {auth.session.user.email}
                </span>
                <span className="account-card__role">
                  {auth.selectedMembership.role === "OWNER"
                    ? "Chủ hệ thống"
                    : auth.selectedMembership.role === "ADMIN"
                      ? "Quản trị viên"
                      : auth.selectedMembership.role}
                </span>
              </div>
            </div>

            <div className="account-card__actions">
              <button
                type="button"
                className="account-action-btn"
                onClick={() => {
                  setChangePasswordOpen(true);
                  setChangePasswordError(null);
                  setChangePasswordSuccess(null);
                }}
                title="Đổi mật khẩu tài khoản"
              >
                <KeyOutlined aria-hidden="true" />
                <span>Đổi MK</span>
              </button>

              <button
                type="button"
                className="account-action-btn"
                onClick={() => void openMfa()}
                title="Bảo mật hai lớp & Passkey"
              >
                <SafetyCertificateOutlined aria-hidden="true" />
                <span>MFA</span>
                {auth.session.mfaEnabled || mfaEnabled ? (
                  <span className="account-action-btn__indicator" title="MFA đang bật" />
                ) : null}
              </button>

              <button
                type="button"
                className="account-action-btn"
                onClick={() => void openSessions()}
                title="Quản lý các thiết bị đăng nhập"
              >
                <LaptopOutlined aria-hidden="true" />
                <span>Phiên</span>
              </button>

              <button
                type="button"
                className="account-action-btn account-action-btn--danger"
                onClick={() => setLogoutConfirmOpen(true)}
                title="Đăng xuất khỏi tài khoản"
              >
                <LogoutOutlined aria-hidden="true" />
                <span>Đăng xuất</span>
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
          className="habi-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setChangePasswordOpen(false);
          }}
        >
          <div className="habi-modal-card">
            <div className="habi-modal-header">
              <div>
                <span className="eyebrow">TÀI KHOẢN & BẢO MẬT</span>
                <h3 id="change-password-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <KeyOutlined style={{ color: "var(--color-primary, #0284c7)" }} />
                  Đổi mật khẩu tài khoản
                </h3>
                <p>Tài khoản: <strong>{auth.session.user.email}</strong></p>
              </div>
              <button
                type="button"
                className="habi-modal-close-btn"
                onClick={() => setChangePasswordOpen(false)}
                aria-label="Đóng"
              >
                <CloseOutlined aria-hidden="true" />
              </button>
            </div>

            {changePasswordError ? (
              <div className="habi-alert habi-alert--error" role="alert">
                <CloseCircleFilled style={{ marginTop: "2px", flexShrink: 0 }} />
                <span>{changePasswordError}</span>
              </div>
            ) : null}

            {changePasswordSuccess ? (
              <div className="habi-alert habi-alert--success" role="status">
                <CheckCircleFilled style={{ marginTop: "2px", flexShrink: 0 }} />
                <span>{changePasswordSuccess}</span>
              </div>
            ) : null}

            <form onSubmit={(e) => void handleChangePassword(e)} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "13px" }}>
                <span style={{ fontWeight: 600 }}>Mật khẩu hiện tại *</span>
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <input
                    type={showCurrentPassword ? "text" : "password"}
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Nhập mật khẩu đang sử dụng"
                    style={{ width: "100%", padding: "9px 36px 9px 12px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "13px" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    style={{ position: "absolute", right: "10px", background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
                    aria-label={showCurrentPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  >
                    {showCurrentPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                  </button>
                </div>
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "13px" }}>
                <span style={{ fontWeight: 600 }}>Mật khẩu mới (tối thiểu 12 ký tự) *</span>
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <input
                    type={showNewPassword ? "text" : "password"}
                    required
                    minLength={12}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Nhập mật khẩu mới an toàn"
                    style={{ width: "100%", padding: "9px 36px 9px 12px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "13px" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    style={{ position: "absolute", right: "10px", background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
                    aria-label={showNewPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  >
                    {showNewPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                  </button>
                </div>
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "13px" }}>
                <span style={{ fontWeight: 600 }}>Xác nhận mật khẩu mới *</span>
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    minLength={12}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Nhập lại mật khẩu mới"
                    style={{ width: "100%", padding: "9px 36px 9px 12px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "13px" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    style={{ position: "absolute", right: "10px", background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
                    aria-label={showConfirmPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  >
                    {showConfirmPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                  </button>
                </div>
              </label>

              {/* Password strength checklist */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "10px 12px", background: "#f8fafc", borderRadius: "8px", fontSize: "12px", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", color: newPassword.length >= 12 ? "#16a34a" : "#64748b" }}>
                  {newPassword.length >= 12 ? <CheckCircleFilled /> : <CheckCircleOutlined />}
                  <span>Độ dài tối thiểu 12 ký tự</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", color: newPassword && currentPassword && newPassword !== currentPassword ? "#16a34a" : "#64748b" }}>
                  {newPassword && currentPassword && newPassword !== currentPassword ? <CheckCircleFilled /> : <CheckCircleOutlined />}
                  <span>Khác mật khẩu đang sử dụng</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", color: confirmPassword && newPassword === confirmPassword ? "#16a34a" : "#64748b" }}>
                  {confirmPassword && newPassword === confirmPassword ? <CheckCircleFilled /> : <CheckCircleOutlined />}
                  <span>Mật khẩu xác nhận trùng khớp</span>
                </div>
              </div>

              <div className="button-row" style={{ marginTop: "8px", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setChangePasswordOpen(false)}
                  disabled={changingPassword}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={changingPassword || !currentPassword || newPassword.length < 12 || newPassword !== confirmPassword || currentPassword === newPassword}
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
          className="habi-modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setMfaOpen(false);
          }}
        >
          <div className="habi-modal-card habi-modal-card--wide" style={{ maxHeight: "88vh" }}>
            <div className="habi-modal-header">
              <div>
                <span className="eyebrow">BẢO MẬT TÀI KHOẢN</span>
                <h3 id="mfa-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <SafetyCertificateFilled style={{ color: "var(--color-primary, #2563eb)" }} />
                  Xác thực hai bước & Passkey
                </h3>
                <p>Bảo vệ tài khoản bằng ứng dụng Authenticator (TOTP), khóa Passkey và mã dự phòng.</p>
              </div>
              <button
                className="habi-modal-close-btn"
                type="button"
                onClick={() => setMfaOpen(false)}
                title="Đóng"
              >
                <CloseOutlined />
              </button>
            </div>

            {/* Step-up / Recent auth status badge */}
            {recentAuthStatus ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 12,
                  background: recentAuthStatus.recent ? "#f0fdf4" : "#fefce8",
                  border: recentAuthStatus.recent ? "1px solid #bbf7d0" : "1px solid #fef08a",
                  color: recentAuthStatus.recent ? "#166534" : "#854d0e"
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {recentAuthStatus.recent ? <CheckCircleFilled /> : <InfoCircleFilled />}
                  {recentAuthStatus.recent
                    ? `Phiên bảo mật: Hiệu lực đến ${new Date(recentAuthStatus.expiresAt).toLocaleTimeString("vi-VN")}`
                    : "Phiên bảo mật đã hết hạn — thao tác nhạy cảm tiếp theo sẽ yêu cầu xác thực lại."}
                </span>
                {recentAuthStatus.recent ? (
                  <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.8 }}>Đã xác minh</span>
                ) : null}
              </div>
            ) : null}

            {/* Error alert */}
            {mfaError ? (
              <div className="habi-alert habi-alert--error" role="alert">
                <CloseCircleFilled style={{ marginTop: 2, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>{mfaError}</div>
              </div>
            ) : null}

            {/* Loading state */}
            {mfaLoading && mfaEnabled === null ? (
              <div style={{ padding: "32px 0", textAlign: "center", color: "var(--color-text-muted)" }}>
                <ReloadOutlined spin style={{ fontSize: 24, marginBottom: 8 }} />
                <div>Đang tải thông tin xác thực hai bước…</div>
              </div>
            ) : null}

            {/* RECOVERY CODES DISPLAY (shown when generated/confirmed) */}
            {mfaRecoveryCodes.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  padding: 16,
                  borderRadius: 12,
                  background: "#f0fdf4",
                  border: "1.5px solid #86efac"
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <CheckCircleFilled style={{ color: "#16a34a", fontSize: 20, marginTop: 2 }} />
                  <div>
                    <strong style={{ color: "#166534", fontSize: 14 }}>
                      MFA đã được kích hoạt thành công!
                    </strong>
                    <p style={{ margin: "4px 0 0", color: "#15803d", fontSize: 12, lineHeight: 1.5 }}>
                      Hãy lưu lại 10 mã khôi phục dự phòng dưới đây ở nơi an toàn. Mỗi mã chỉ sử dụng được 1 lần để đăng nhập nếu bạn bị mất thiết bị Authenticator. Habi sẽ không hiển thị lại danh sách mã này.
                    </p>
                  </div>
                </div>

                <div className="habi-recovery-grid">
                  {mfaRecoveryCodes.map((code) => (
                    <div key={code} className="habi-recovery-code">
                      {code}
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(mfaRecoveryCodes.join("\n"));
                      setCopiedCodes(true);
                      setTimeout(() => setCopiedCodes(false), 2500);
                    }}
                  >
                    {copiedCodes ? <CheckOutlined /> : <CopyOutlined />}
                    <span>{copiedCodes ? "Đã sao chép 10 mã!" : "Sao chép tất cả mã"}</span>
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => setMfaRecoveryCodes([])}
                  >
                    Tôi đã lưu mã an toàn
                  </button>
                </div>
              </div>
            ) : null}

            {/* SECTION 1: TOTP AUTHENTICATOR APP */}
            <div className="habi-section-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: mfaEnabled ? "#dcfce7" : "#f1f5f9",
                      color: mfaEnabled ? "#15803d" : "#475569",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 18,
                      flexShrink: 0
                    }}
                  >
                    <QrcodeOutlined />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: 14 }}>Ứng dụng xác thực (TOTP)</strong>
                      {mfaEnabled ? (
                        <span className="habi-badge habi-badge--success">
                          <CheckCircleFilled /> Đang bật
                        </span>
                      ) : (
                        <span className="habi-badge habi-badge--warning">Chưa bật</span>
                      )}
                    </div>
                    <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--color-text-muted)" }}>
                      Google Authenticator, Microsoft Authenticator, 1Password, Authy...
                    </p>
                  </div>
                </div>

                {/* Status action or re-enroll button */}
                {mfaEnabled && !mfaSetup ? (
                  <button
                    className="secondary-button secondary-button--compact"
                    type="button"
                    disabled={mfaLoading}
                    onClick={() => void beginMfaSetup()}
                    title="Quét lại mã QR trên điện thoại mới"
                  >
                    <ReloadOutlined />
                    <span>Quét lại QR</span>
                  </button>
                ) : null}
              </div>

              {/* Policy note if required by role */}
              {mfaRequiredByRole ? (
                <div
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    fontSize: 12,
                    color: "#1e40af",
                    display: "flex",
                    alignItems: "center",
                    gap: 6
                  }}
                >
                  <CrownOutlined />
                  <span>
                    Vai trò <strong>{mfaRequiredByRole}</strong> thuộc chính sách bắt buộc bật MFA. Không thể tắt MFA khi còn giữ vai trò này.
                  </span>
                </div>
              ) : null}

              {/* If not enabled and not in setup, show Begin button */}
              {!mfaEnabled && !mfaSetup ? (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={mfaLoading}
                    onClick={() => void beginMfaSetup()}
                  >
                    <QrcodeOutlined />
                    <span>{mfaLoading ? "Đang tạo mã…" : "Bắt đầu thiết lập Authenticator"}</span>
                  </button>
                </div>
              ) : null}

              {/* If setting up (either first time or re-enrolling) */}
              {mfaSetup ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                    padding: 16,
                    borderRadius: 10,
                    background: "white",
                    border: "1px solid var(--color-border)"
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>
                    Bước 1: Quét mã QR trong ứng dụng Authenticator
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 8,
                      padding: 14,
                      background: "#f8fafc",
                      borderRadius: 10,
                      border: "1px dashed #cbd5e1"
                    }}
                  >
                    <div style={{ background: "white", padding: 10, borderRadius: 8, boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
                      <TotpQrCode value={mfaSetup.provisioningUri} />
                    </div>
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                      Mã QR được tạo cục bộ trên trình duyệt, an toàn tuyệt đối.
                    </span>
                  </div>

                  <details style={{ fontSize: 12 }}>
                    <summary style={{ cursor: "pointer", color: "var(--color-primary, #2563eb)", fontWeight: 600 }}>
                      Không quét được mã QR? Nhập Secret thủ công
                    </summary>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                      <input
                        readOnly
                        value={mfaSetup.secret}
                        style={{ fontFamily: "monospace", fontSize: 12, background: "#f8fafc", flex: 1 }}
                      />
                      <button
                        type="button"
                        className="secondary-button secondary-button--compact"
                        onClick={() => {
                          void navigator.clipboard.writeText(mfaSetup.secret);
                          setCopiedSecret(true);
                          setTimeout(() => setCopiedSecret(false), 2000);
                        }}
                      >
                        {copiedSecret ? <CheckOutlined /> : <CopyOutlined />}
                        <span>{copiedSecret ? "Đã chép" : "Chép Secret"}</span>
                      </button>
                    </div>
                  </details>

                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", marginTop: 4 }}>
                    Bước 2: Nhập mã 6 chữ số từ app Authenticator để kích hoạt
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      value={mfaCode}
                      onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="VD: 123456"
                      style={{
                        maxWidth: 160,
                        fontFamily: "monospace",
                        fontSize: 18,
                        letterSpacing: "0.2em",
                        textAlign: "center",
                        fontWeight: 700
                      }}
                      maxLength={6}
                    />
                    <button
                      className="primary-button"
                      type="button"
                      disabled={mfaLoading || mfaCode.trim().length < 6}
                      onClick={() => void confirmMfaSetup()}
                    >
                      <CheckOutlined />
                      <span>{mfaLoading ? "Đang xác minh…" : "Kích hoạt & Lưu mã"}</span>
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        setMfaSetup(null);
                        setMfaCode("");
                      }}
                    >
                      Hủy
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Disable MFA form (only if enabled and not required by role) */}
              {mfaEnabled && !mfaRequiredByRole && !mfaSetup ? (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ fontSize: 12, color: "#dc2626", cursor: "pointer", fontWeight: 600 }}>
                    Tắt xác thực hai bước (Không khuyến nghị)
                  </summary>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      marginTop: 8,
                      padding: 12,
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: 8
                    }}
                  >
                    <span style={{ fontSize: 12, color: "#991b1b" }}>
                      Để tắt MFA, nhập mã OTP 6 số từ app Authenticator hoặc mã dự phòng (HABI-...).
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value)}
                        placeholder="Mã OTP 6 số hoặc HABI-..."
                        style={{ flex: 1 }}
                      />
                      <button
                        className="secondary-button secondary-button--danger"
                        type="button"
                        disabled={mfaLoading || !mfaCode.trim()}
                        onClick={() => void disableMfa()}
                      >
                        Xác nhận tắt
                      </button>
                    </div>
                  </div>
                </details>
              ) : null}
            </div>

            {/* SECTION 2: PASSKEY / WINDOWS HELLO / TOUCH ID */}
            <div className="habi-section-card">
              <div style={{ display: "flex", gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: passkeys.length > 0 ? "#dcfce7" : "#f1f5f9",
                    color: passkeys.length > 0 ? "#15803d" : "#475569",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 18,
                    flexShrink: 0
                  }}
                >
                  <KeyOutlined />
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ fontSize: 14 }}>Passkey (Vân tay / Windows Hello / Touch ID)</strong>
                    {passkeys.length > 0 ? (
                      <span className="habi-badge habi-badge--success">
                        {passkeys.length} thiết bị
                      </span>
                    ) : (
                      <span className="habi-badge habi-badge--neutral">Tùy chọn</span>
                    )}
                  </div>
                  <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.45 }}>
                    Sử dụng cảm biến vân tay, nhận diện khuôn mặt hoặc mã PIN phần cứng trên máy tính/điện thoại để đăng nhập siêu tốc mà không cần nhập mã OTP 6 số.
                  </p>
                </div>
              </div>

              {passkeySupported ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    padding: 12,
                    borderRadius: 8,
                    background: "white",
                    border: "1px solid var(--color-border)"
                  }}
                >
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>
                      Tên nhận diện thiết bị mới
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        value={passkeyName}
                        onChange={(event) => setPasskeyName(event.target.value)}
                        placeholder="VD: Laptop ThinkPad - Windows Hello, MacBook Touch ID..."
                        maxLength={80}
                        disabled={passkeyBusy}
                        style={{ flex: 1 }}
                      />
                      <button
                        className="primary-button"
                        type="button"
                        disabled={passkeyBusy || !passkeyName.trim()}
                        onClick={() => void registerPasskey()}
                      >
                        <KeyOutlined />
                        <span>{passkeyBusy ? "Đang xử lý…" : "Thêm Passkey thiết bị này"}</span>
                      </button>
                    </div>
                  </label>
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                    💡 Khi bấm &quot;Thêm Passkey&quot;, trình duyệt sẽ kích hoạt hộp thoại Windows Hello / Touch ID để xác thực phần cứng.
                  </span>
                </div>
              ) : (
                <div className="habi-alert habi-alert--warning" style={{ fontSize: 12 }}>
                  <InfoCircleFilled />
                  <span>Trình duyệt hoặc hệ điều hành hiện tại chưa hỗ trợ WebAuthn Passkey.</span>
                </div>
              )}

              {/* Passkey list */}
              {passkeys.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--color-text-muted)", fontStyle: "italic", textAlign: "center", padding: "8px 0" }}>
                  Chưa có passkey nào được liên kết với tài khoản này.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {passkeys.map((passkey) => (
                    <div
                      key={passkey.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        borderRadius: 8,
                        border: "1px solid var(--color-border)",
                        background: "white"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <LaptopOutlined style={{ fontSize: 18, color: "#475569" }} />
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <strong style={{ fontSize: 13, color: "#0f172a" }}>{passkey.name}</strong>
                            <span className="habi-badge habi-badge--neutral">
                              {passkey.deviceType === "multiDevice" ? "Đồng bộ iCloud/Google" : "Phần cứng thiết bị"}
                            </span>
                          </div>
                          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                            Tạo: {new Date(passkey.createdAt).toLocaleDateString("vi-VN")}
                            {passkey.lastUsedAt ? ` · Dùng gần nhất: ${new Date(passkey.lastUsedAt).toLocaleDateString("vi-VN")}` : ""}
                          </span>
                        </div>
                      </div>
                      <button
                        className="text-button text-button--danger"
                        type="button"
                        disabled={passkeyBusy}
                        onClick={() => void revokePasskey(passkey)}
                        style={{ fontSize: 12 }}
                      >
                        Thu hồi
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* SECTION 3: RECENT SECURITY ALERTS */}
            <div className="habi-section-card">
              <div>
                <strong style={{ fontSize: 14 }}>Nhật ký bảo mật gần đây</strong>
                <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--color-text-muted)" }}>
                  Ghi nhận sự kiện đăng nhập mới, thay đổi mật khẩu hoặc xác thực 2 bước.
                </p>
              </div>

              {securityAlerts.length === 0 ? (
                <span style={{ fontSize: 12, color: "var(--color-text-muted)", fontStyle: "italic" }}>
                  Chưa ghi nhận sự kiện cảnh báo bảo mật bất thường nào.
                </span>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {securityAlerts.slice(0, 5).map((alert) => (
                    <div
                      key={alert.id}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--color-border)",
                        background: "white",
                        display: "flex",
                        flexDirection: "column",
                        gap: 3
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span
                          className={`habi-badge ${
                            alert.severity === "HIGH"
                              ? "habi-alert--error"
                              : alert.severity === "MEDIUM"
                                ? "habi-badge--warning"
                                : "habi-badge--neutral"
                          }`}
                          style={{ padding: "1px 6px" }}
                        >
                          {alert.severity === "HIGH"
                            ? "Quan trọng"
                            : alert.severity === "MEDIUM"
                              ? "Cần chú ý"
                              : "Thông tin"}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                          {new Date(alert.createdAt).toLocaleString("vi-VN")}
                          {alert.deliveryStatus === "SENT" ? " · Đã gửi email" : ""}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: "#1e293b", marginTop: 2 }}>{alert.summary}</div>
                    </div>
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
          className="habi-modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSessionsOpen(false);
          }}
        >
          <div className="habi-modal-card habi-modal-card--wide" style={{ maxHeight: "85vh" }}>
            <div className="habi-modal-header">
              <div>
                <span className="eyebrow">BẢO MẬT TÀI KHOẢN</span>
                <h3 id="sessions-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <LaptopOutlined style={{ color: "var(--color-primary, #2563eb)" }} />
                  Quản lý phiên đăng nhập
                </h3>
                <p>Danh sách các thiết bị và trình duyệt đang truy cập tài khoản Habi của bạn.</p>
              </div>
              <button
                type="button"
                className="habi-modal-close-btn"
                onClick={() => setSessionsOpen(false)}
                title="Đóng"
              >
                <CloseOutlined />
              </button>
            </div>

            {sessionsError ? (
              <div className="habi-alert habi-alert--error" role="alert">
                <CloseCircleFilled style={{ marginTop: 2, flexShrink: 0 }} />
                <span>{sessionsError}</span>
              </div>
            ) : null}

            {sessionsSuccess ? (
              <div className="habi-alert habi-alert--success">
                <CheckCircleFilled style={{ marginTop: 2, flexShrink: 0 }} />
                <span>{sessionsSuccess}</span>
              </div>
            ) : null}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 12px",
                background: "#f8fafc",
                borderRadius: 8,
                border: "1px solid var(--color-border)"
              }}
            >
              <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                Tổng cộng <strong>{sessions.length}</strong> phiên đang hoạt động.
              </span>
              <button
                type="button"
                className="secondary-button secondary-button--compact"
                disabled={sessionsLoading || sessions.length <= 1}
                onClick={() => void revokeOtherSessions()}
                title="Đăng xuất khỏi tất cả máy tính và điện thoại khác"
              >
                <span>Thu hồi tất cả phiên khác</span>
              </button>
            </div>

            {sessionsLoading && sessions.length === 0 ? (
              <div style={{ padding: "32px 0", textAlign: "center", color: "var(--color-text-muted)" }}>
                <ReloadOutlined spin style={{ fontSize: 24, marginBottom: 8 }} />
                <div>Đang tải danh sách phiên…</div>
              </div>
            ) : sessions.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0", color: "var(--color-text-muted)" }}>
                Không có phiên đăng nhập nào khác.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {sessions.map((session) => {
                  const isMobile =
                    session.deviceLabel?.toLowerCase().includes("mobile") ||
                    session.deviceLabel?.toLowerCase().includes("iphone") ||
                    session.deviceLabel?.toLowerCase().includes("android");

                  return (
                    <article
                      key={session.id}
                      style={{
                        border: session.current ? "1.5px solid #86efac" : "1px solid var(--color-border)",
                        background: session.current ? "#f0fdf4" : "white",
                        borderRadius: 12,
                        padding: "14px 16px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 14
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            background: session.current ? "#dcfce7" : "#f1f5f9",
                            color: session.current ? "#15803d" : "#475569",
                            display: "grid",
                            placeItems: "center",
                            fontSize: 18,
                            flexShrink: 0
                          }}
                        >
                          {isMobile ? <MobileOutlined /> : <DesktopOutlined />}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <strong style={{ fontSize: 13, color: "#0f172a" }}>
                              {session.deviceLabel ?? "Trình duyệt Web"}
                            </strong>
                            {session.current ? (
                              <span className="habi-badge habi-badge--success">
                                <CheckCircleFilled /> Phiên này (Thiết bị hiện tại)
                              </span>
                            ) : null}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--color-text-muted)", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                            <span>
                              Hoạt động: {new Date(session.lastSeenAt).toLocaleString("vi-VN")}
                            </span>
                            <span>·</span>
                            <span>Tạo: {new Date(session.createdAt).toLocaleDateString("vi-VN")}</span>
                            <span>·</span>
                            <span>Hết hạn: {new Date(session.expiresAt).toLocaleDateString("vi-VN")}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        className={
                          session.current
                            ? "secondary-button secondary-button--compact secondary-button--danger"
                            : "secondary-button secondary-button--compact"
                        }
                        disabled={sessionsLoading}
                        onClick={() => {
                          if (session.current) {
                            setLogoutConfirmOpen(true);
                          } else {
                            void revokeSession(session);
                          }
                        }}
                        style={{ flexShrink: 0 }}
                      >
                        {session.current ? "Đăng xuất" : "Thu hồi"}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {logoutConfirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-title"
          className="habi-modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && !loggingOut) setLogoutConfirmOpen(false);
          }}
        >
          <div className="habi-modal-card" style={{ maxWidth: 420 }}>
            <div className="habi-modal-header">
              <div>
                <span className="eyebrow" style={{ color: "#dc2626" }}>XÁC NHẬN</span>
                <h3 id="logout-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <LogoutOutlined style={{ color: "#dc2626" }} />
                  Đăng xuất tài khoản
                </h3>
              </div>
              <button
                type="button"
                className="habi-modal-close-btn"
                disabled={loggingOut}
                onClick={() => setLogoutConfirmOpen(false)}
                title="Đóng"
              >
                <CloseOutlined />
              </button>
            </div>

            <p style={{ margin: 0, fontSize: 13, color: "#334155", lineHeight: 1.5 }}>
              Bạn có chắc chắn muốn đăng xuất khỏi tài khoản <strong>{auth.session.user.email}</strong> trên thiết bị này không?
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
              <button
                type="button"
                className="secondary-button"
                disabled={loggingOut}
                onClick={() => setLogoutConfirmOpen(false)}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                className="primary-button primary-button--danger"
                disabled={loggingOut}
                onClick={() => void handleLogout()}
                style={{
                  background: "#dc2626",
                  borderColor: "#dc2626",
                  color: "white"
                }}
              >
                <LogoutOutlined />
                <span>{loggingOut ? "Đang đăng xuất…" : "Đăng xuất"}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
