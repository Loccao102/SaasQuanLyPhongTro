"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAdminAuth } from "./admin-auth-provider";

const navItems = [
  { label: "Tổng quan", href: "/" },
  { label: "Tài sản", href: "/assets" },
  { label: "Hợp đồng", href: "/leases" },
  { label: "Chốt số", href: "/metering" },
  { label: "Hóa đơn", href: "/billing" },
  { label: "Thu tiền", href: "#" },
  { label: "Thông báo", href: "/notifications" },
  { label: "Đội ngũ", href: "/team" },
  { label: "Báo cáo", href: "#" }
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
            <button
              type="button"
              onClick={() => void auth.logout()}
            >
              Đăng xuất
            </button>
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
            <span
              className="avatar-button"
              aria-label={"Tài khoản " + userLabel}
            >
              {initials(userLabel)}
            </span>
          </div>
        </header>

        <div className="dashboard-content">{children}</div>
      </main>
    </div>
  );
}
