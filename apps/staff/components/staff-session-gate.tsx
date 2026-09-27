"use client";

import type { ReactNode } from "react";
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
        <div className="staff-phone">
          <div className="staff-state">
            Đang kiểm tra phiên Staff…
          </div>
        </div>
      </main>
    );
  }

  if (auth.status === "error") {
    return (
      <main className="staff-page">
        <div className="staff-phone">
          <div className="staff-state staff-state--error">
            <strong>Không thể xác thực phiên.</strong>
            <span>{auth.error}</span>
            <button
              className="secondary-action"
              type="button"
              onClick={() => void auth.refresh()}
            >
              Thử lại
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
        <div className="staff-phone">
          <div className="staff-state">
            Đang chuyển tới đăng nhập…
          </div>
        </div>
      </main>
    );
  }

  if (!auth.selectedMembership) {
    return (
      <main className="staff-page">
        <div className="staff-phone">
          <div className="staff-state staff-state--warning">
            <strong>Chưa có tenant hoạt động.</strong>
            <span>
              Liên hệ OWNER/Admin để được cấp tài khoản trước khi chốt số.
            </span>
          </div>
        </div>
      </main>
    );
  }

  if (auth.session.features?.metering === false) {
    return (
      <main className="staff-page">
        <div className="staff-phone">
          <div className="staff-state staff-state--warning">
            <strong>Chức năng chốt số đang bị tắt.</strong>
            <span>
              Gói hoặc cấu hình CMS của tenant hiện không cho phép sử dụng Metering.
            </span>
            {auth.online ? (
              <button
                className="secondary-action"
                type="button"
                onClick={() => void auth.refresh()}
              >
                Kiểm tra lại quyền
              </button>
            ) : (
              <span>
                Thiết bị đang offline. Kết nối mạng để tải quyền mới nhất.
              </span>
            )}
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
