import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { label: "Tổng quan", href: "/" },
  { label: "Tài sản", href: "#" },
  { label: "Hợp đồng", href: "/leases" },
  { label: "Chốt số", href: "#" },
  { label: "Hóa đơn", href: "#" },
  { label: "Thu tiền", href: "#" },
  { label: "Thông báo", href: "#" },
  { label: "Báo cáo", href: "#" }
];

export function AdminShell({
  title,
  eyebrow = "PROP-OPS ADMIN",
  activeNav,
  children
}: {
  title: string;
  eyebrow?: string;
  activeNav: string;
  children: ReactNode;
}) {
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark">P</span>
          <div><strong>PropOps</strong><span>Rental operations</span></div>
        </div>

        <nav className="sidebar__nav" aria-label="Điều hướng chính">
          {navItems.map((item) => {
            const className = item.label === activeNav ? "nav-item nav-item--active" : "nav-item";
            const content = <><span className="nav-item__dot" aria-hidden="true" />{item.label}</>;

            return item.href === "#" ? (
              <a className={className} href="#" key={item.label}>{content}</a>
            ) : (
              <Link
                className={className}
                href={item.href}
                key={item.label}
                aria-current={item.label === activeNav ? "page" : undefined}
              >
                {content}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <a className="nav-item" href="#"><span className="nav-item__dot" aria-hidden="true" />Cài đặt</a>
          <div className="workspace-card">
            <span>Tổ chức hiện tại</span>
            <strong>Chuỗi nhà trọ Demo</strong>
            <small>OWNER · Toàn hệ thống</small>
          </div>
        </div>
      </aside>

      <main className="admin-main">
        <header className="topbar">
          <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>
          <div className="topbar__actions">
            <button className="icon-button" aria-label="Thông báo">3</button>
            <button className="avatar-button" aria-label="Tài khoản Nguyễn A">NA</button>
          </div>
        </header>

        <div className="dashboard-content">{children}</div>
      </main>
    </div>
  );
}
