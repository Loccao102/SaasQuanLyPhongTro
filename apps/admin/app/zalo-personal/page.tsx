"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AdminShell } from "../../components/admin-shell";
import { adminZaloPersonalApi, type ZaloPersonalStatus } from "../../lib/admin-zalo-personal-api";

export default function ZaloPersonalPage() {
  const [connection, setConnection] = useState<ZaloPersonalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setConnection(await adminZaloPersonalApi.status());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được kết nối Zalo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      await adminZaloPersonalApi.connect();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể bắt đầu kết nối.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Ngắt liên kết và thu hồi phiên Zalo của tổ chức này? Các tin chưa gửi sẽ tạm dừng.")) return;
    setBusy(true);
    try {
      await adminZaloPersonalApi.disconnect();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể ngắt kết nối.");
    } finally {
      setBusy(false);
    }
  }

  const connected = connection?.status === "CONNECTED";
  const connecting = connection?.status === "CONNECTING";
  const login = connection?.login;

  return (
    <AdminShell title="Zalo 1 Chạm" eyebrow="KẾT NỐI TÀI KHOẢN RIÊNG" activeNav="Zalo 1 Chạm">
      <section className="asset-context">
        <div>
          <span className="eyebrow">ZALO PERSONAL · MULTI-TENANT</span>
          <h2>Liên kết tài khoản Zalo của bạn</h2>
          <p>
            Mỗi tổ chức quản lý một phiên đăng nhập riêng. Tin nhắn được gửi bởi
            server Habi và không cần mở Zalo trên máy tính của bạn.
          </p>
        </div>
        <Link href="/notifications" className="secondary-button">Chiến dịch tin nhắn</Link>
      </section>

      {error && (
        <section className="admin-state admin-state--error" role="alert">{error}</section>
      )}

      <section className="panel" style={{ maxWidth: 760, margin: "0 auto" }}>
        <div className="asset-section-heading">
          <div>
            <span className="eyebrow">TÀI KHOẢN CỦA TỔ CHỨC</span>
            <h2>
              {loading ? "Đang kiểm tra..." :
                connected ? "Đã kết nối" :
                  connecting ? "Đang chờ quét mã" : "Chưa kết nối"}
            </h2>
          </div>
          <div className="button-row">
            {!connecting && (
              <button type="button" className="primary-button" disabled={busy || loading}
                onClick={() => void connect()}>
                {connected ? "Liên kết lại" : "Kết nối Zalo"}
              </button>
            )}
            {(connected || connecting) && (
              <button type="button" className="danger-button" disabled={busy}
                onClick={() => void disconnect()}>
                Ngắt kết nối
              </button>
            )}
          </div>
        </div>

        {connected && (
          <div className="admin-state admin-state--success" role="status">
            Phiên Zalo đã được mã hóa và lưu riêng cho tổ chức này.
            Bạn có thể quay lại mục Thông báo để gửi tin.
          </div>
        )}

        {connecting && (
          <div style={{ display: "grid", justifyItems: "center", gap: 14, padding: 18 }}>
            {login?.qrImage ? (
              <img src={login.qrImage} alt="Ảnh màn hình đăng nhập Zalo để quét QR bằng điện thoại"
                style={{ width: "100%", maxWidth: 480, borderRadius: 12, border: "1px solid #ddd" }} />
            ) : (
              <div className="admin-state">Server đang khởi tạo phiên Zalo, chuẩn bị mã QR...</div>
            )}
            <p style={{ maxWidth: 500, textAlign: "center" }}>
              Mở Zalo trên điện thoại, chọn quét mã QR đăng nhập và xác nhận trên
              điện thoại của bạn. Trạng thái sẽ tự cập nhật khi đăng nhập thành công.
            </p>
            <small>
              Hạn kết nối: {login?.expiresAt
                ? new Date(login.expiresAt).toLocaleTimeString("vi-VN") : "đang tạo..."}
            </small>
          </div>
        )}

        {!connecting && !connected && login &&
          (login.status === "FAILED" || login.status === "EXPIRED") && (
            <div className="admin-state admin-state--error">
              {login.errorMessage || "Phiên đăng nhập đã kết thúc. Bấm Kết nối Zalo để thử lại."}
            </div>
          )}

        <p style={{ marginTop: 18, fontSize: 13, opacity: 0.82 }}>
          Đây là tích hợp Zalo cá nhân qua giao diện web, không phải API chính thức.
          Zalo có thể yêu cầu xác minh hoặc thay đổi giao diện khiến gửi tin bị gián đoạn.
          Chỉ dùng để liên hệ với người thuê đã đồng ý nhận thông báo.
        </p>
      </section>
    </AdminShell>
  );
}
