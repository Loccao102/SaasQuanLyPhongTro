"use client";

import type { ReactNode } from "react";
import { HabiMark } from "@propops/ui/habi-brand";
import {
  DisconnectOutlined,
  LoadingOutlined,
  LockOutlined,
  ReloadOutlined,
  WarningOutlined
} from "@ant-design/icons";
import { useStaffAuth } from "./staff-auth-provider";

export function StaffSessionGate({
  children
}: {
  children: ReactNode;
}) {
  const auth = useStaffAuth();

  if (auth.status === "loading") {
    return (
      <main className="staff-page">
        <div className="staff-phone" style={{ minHeight: "60vh", justifyContent: "center", alignItems: "center" }}>
          <div
            className="staff-header-card"
            style={{
              width: "100%",
              maxWidth: "380px",
              padding: "36px 24px",
              textAlign: "center",
              alignItems: "center",
              gap: "16px"
            }}
          >
            <div className="staff-login-icon-badge" style={{ animation: "pulseDot 1.5s infinite" }}>
              <HabiMark size={32} />
            </div>
            <div>
              <strong style={{ fontSize: "16px", color: "var(--staff-text-main)", display: "block" }}>
                Đang khởi tạo ca trực Staff…
              </strong>
              <span style={{ fontSize: "12px", color: "var(--staff-text-muted)", marginTop: "4px", display: "block" }}>
                Kiểm tra phiên đăng nhập và dữ liệu offline
              </span>
            </div>
            <LoadingOutlined style={{ fontSize: "20px", color: "var(--staff-teal)" }} />
          </div>
        </div>
      </main>
    );
  }

  if (auth.status === "error") {
    return (
      <main className="staff-page">
        <div className="staff-phone" style={{ minHeight: "60vh", justifyContent: "center", alignItems: "center" }}>
          <div
            className="staff-header-card"
            style={{
              width: "100%",
              maxWidth: "400px",
              padding: "32px 24px",
              textAlign: "center",
              alignItems: "center",
              gap: "16px"
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "14px",
                background: "var(--staff-danger-soft)",
                color: "var(--staff-danger)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "22px"
              }}
            >
              <WarningOutlined />
            </div>
            <div>
              <strong style={{ fontSize: "16px", color: "var(--staff-text-main)", display: "block" }}>
                Không thể xác thực phiên làm việc
              </strong>
              <p style={{ margin: "6px 0 0", fontSize: "13px", color: "var(--staff-text-secondary)" }}>
                {auth.error || "Đã xảy ra lỗi khi kiểm tra phiên đăng nhập trên thiết bị."}
              </p>
            </div>
            <button
              className="staff-primary-button"
              type="button"
              onClick={() => void auth.refresh()}
              style={{ height: "44px" }}
            >
              <ReloadOutlined />
              <span>Thử lại ngay</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (
    auth.status === "unauthenticated" ||
    !auth.session
  ) {
    return (
      <main className="staff-page">
        <div className="staff-phone" style={{ minHeight: "60vh", justifyContent: "center", alignItems: "center" }}>
          <div
            className="staff-header-card"
            style={{
              width: "100%",
              maxWidth: "360px",
              padding: "32px 24px",
              textAlign: "center",
              alignItems: "center",
              gap: "14px"
            }}
          >
            <LoadingOutlined style={{ fontSize: "28px", color: "var(--staff-navy)" }} />
            <strong style={{ fontSize: "15px", color: "var(--staff-text-main)" }}>
              Đang chuyển hướng tới đăng nhập…
            </strong>
          </div>
        </div>
      </main>
    );
  }

  if (!auth.selectedMembership) {
    return (
      <main className="staff-page">
        <div className="staff-phone" style={{ minHeight: "60vh", justifyContent: "center", alignItems: "center" }}>
          <div
            className="staff-header-card"
            style={{
              width: "100%",
              maxWidth: "400px",
              padding: "32px 24px",
              textAlign: "center",
              alignItems: "center",
              gap: "16px"
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "14px",
                background: "var(--staff-warning-soft)",
                color: "var(--staff-warning)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "22px"
              }}
            >
              <LockOutlined />
            </div>
            <div>
              <strong style={{ fontSize: "16px", color: "var(--staff-text-main)", display: "block" }}>
                Chưa có Workspace hoạt động
              </strong>
              <p style={{ margin: "6px 0 0", fontSize: "13px", color: "var(--staff-text-secondary)" }}>
                Tài khoản chưa được gán vào tổ chức hoặc cơ sở nào. Vui lòng liên hệ Quản lý / Admin để được cấp quyền.
              </p>
            </div>
            <button
              className="secondary-action"
              type="button"
              onClick={() => void auth.logout()}
            >
              Đăng xuất tài khoản
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (auth.session.features?.metering === false) {
    return (
      <main className="staff-page">
        <div className="staff-phone" style={{ minHeight: "60vh", justifyContent: "center", alignItems: "center" }}>
          <div
            className="staff-header-card"
            style={{
              width: "100%",
              maxWidth: "400px",
              padding: "32px 24px",
              textAlign: "center",
              alignItems: "center",
              gap: "16px"
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "14px",
                background: "var(--staff-warning-soft)",
                color: "var(--staff-warning)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "22px"
              }}
            >
              <WarningOutlined />
            </div>
            <div>
              <strong style={{ fontSize: "16px", color: "var(--staff-text-main)", display: "block" }}>
                Chức năng chốt số chưa được kích hoạt
              </strong>
              <p style={{ margin: "6px 0 0", fontSize: "13px", color: "var(--staff-text-secondary)" }}>
                Gói hoặc cấu hình quyền của tổ chức hiện không cho phép sử dụng module Chốt chỉ số (Metering).
              </p>
            </div>
            {auth.online ? (
              <button
                className="staff-primary-button"
                type="button"
                onClick={() => void auth.refresh()}
                style={{ height: "44px" }}
              >
                <ReloadOutlined />
                <span>Kiểm tra lại quyền</span>
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--staff-warning)" }}>
                <DisconnectOutlined />
                <span>Thiết bị đang ngoại tuyến. Hãy kết nối mạng để tải lại quyền mới.</span>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
