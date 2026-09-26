"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { useAdminAuth } from "./admin-auth-provider";
import { adminAuthApi } from "../lib/admin-auth-api";

const navItems = [
  { label: "Tổng quan", href: "/" },
  { label: "Tài sản", href: "/assets" },
  { label: "Hợp đồng", href: "/leases" },
  { label: "Chốt số", href: "/metering" },
  { label: "Hóa đơn", href: "/billing" },
  { label: "Thu tiền", href: "/payments" },
  { label: "Tín dụng", href: "/credit-balance" },
  { label: "Sổ quỹ Thu - Chi", href: "/finances" },
  { label: "Báo cáo", href: "/reports" },
  { label: "Báo hỏng & Sửa chữa", href: "/maintenance" },
  { label: "Thông báo", href: "/notifications" },
  { label: "Đội ngũ", href: "/team" }
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
  children
}: {
  title: string;
  eyebrow?: string;
  activeNav: string;
  children: ReactNode;
}) {
  const auth = useAdminAuth();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [changePasswordSuccess, setChangePasswordSuccess] = useState<string | null>(null);

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
          <span className="brand__mark">H</span>
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
          <span className="brand__mark">H</span>
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
          <span className="brand__mark">H</span>
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
        <div className="brand">
          <span className="brand__mark">H</span>
          <div>
            <strong>Habi</strong>
            <span>Nhà gọn. Việc trôi.</span>
          </div>
        </div>

        <nav className="sidebar__nav" aria-label="Điều hướng chính">
          {navItems.map((item) => {
            const className =
              item.label === activeNav
                ? "nav-item nav-item--active"
                : "nav-item";
            const content = (
              <>
                <span className="nav-item__dot" aria-hidden="true" />
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
            <span className="nav-item__dot" aria-hidden="true" />
            Cài đặt
          </a>

          <label className="workspace-card workspace-card--interactive">
            <span>Workspace hiện tại</span>
            <select
              value={auth.selectedMembership.organizationId}
              onChange={(event) =>
                auth.switchOrganization(event.target.value)
              }
              aria-label="Chọn workspace"
            >
              {auth.session.memberships.map((membership) => (
                <option
                  key={membership.organizationId}
                  value={membership.organizationId}
                >
                  {membership.organizationName}
                </option>
              ))}
            </select>
            <small>
              {auth.selectedMembership.role} · scope theo membership
            </small>
          </label>

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
            <button className="icon-button" aria-label="Thông báo">
              3
            </button>
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
                ✕
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
    </div>
  );
}
