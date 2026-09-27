"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  cmsAuthApi,
  type CmsSessionItem
} from "../../lib/cms-auth-api";

export default function CmsSecurityPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{
    secret: string;
    provisioningUri: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [sessions, setSessions] = useState<CmsSessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [mfa, activeSessions] = await Promise.all([
        cmsAuthApi.mfaStatus(),
        cmsAuthApi.sessions()
      ]);
      setEnabled(mfa.enabled);
      setSessions(activeSessions.sessions);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể tải cấu hình bảo mật."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function beginSetup() {
    setBusy(true);
    setError(null);
    setRecoveryCodes([]);
    try {
      setSetup(await cmsAuthApi.setupMfa());
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Không thể thiết lập MFA."
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup() {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await cmsAuthApi.confirmMfa(code);
      setRecoveryCodes(result.recoveryCodes);
      setEnabled(true);
      setSetup(null);
      setCode("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Mã TOTP không hợp lệ."
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!code.trim()) return;
    if (!window.confirm("Tắt MFA cho tài khoản PLATFORM này?")) return;

    setBusy(true);
    setError(null);
    try {
      await cmsAuthApi.disableMfa(code);
      setEnabled(false);
      setSetup(null);
      setRecoveryCodes([]);
      setCode("");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Không thể tắt MFA."
      );
    } finally {
      setBusy(false);
    }
  }

  async function revokeOthers() {
    if (!window.confirm("Thu hồi toàn bộ phiên PLATFORM khác?")) return;
    setBusy(true);
    setError(null);
    try {
      await cmsAuthApi.revokeOtherSessions();
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể thu hồi các phiên khác."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 880,
        margin: "0 auto",
        padding: "80px 24px 48px",
        display: "grid",
        gap: 20
      }}
    >
      <header>
        <p style={{ margin: 0, color: "#64748b", fontWeight: 700 }}>
          HABI CONTROL PLANE
        </p>
        <h1 style={{ marginBottom: 8 }}>Bảo mật tài khoản PLATFORM</h1>
        <p style={{ color: "#64748b" }}>
          TOTP MFA, recovery codes và các phiên đăng nhập đang hoạt động.
        </p>
        <Link href="/">← Quay lại Control Plane</Link>
      </header>

      {error ? (
        <section
          role="alert"
          style={{
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#991b1b",
            padding: 14,
            borderRadius: 10
          }}
        >
          {error}
        </section>
      ) : null}

      <section
        style={{
          border: "1px solid #e2e8f0",
          background: "#fff",
          borderRadius: 14,
          padding: 20,
          display: "grid",
          gap: 14
        }}
      >
        <h2 style={{ margin: 0 }}>Xác thực hai bước</h2>

        {loading || enabled === null ? (
          <p>Đang tải trạng thái MFA…</p>
        ) : recoveryCodes.length > 0 ? (
          <>
            <p>
              MFA đã bật. Hãy lưu các recovery code này ngay; mỗi mã chỉ dùng
              được một lần và sẽ không hiển thị lại.
            </p>
            <div
              style={{
                display: "grid",
                gap: 6,
                padding: 14,
                borderRadius: 10,
                background: "#f8fafc",
                fontFamily: "monospace"
              }}
            >
              {recoveryCodes.map((item) => (
                <code key={item}>{item}</code>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(recoveryCodes.join("\n"))
              }
            >
              Copy recovery codes
            </button>
          </>
        ) : enabled ? (
          <>
            <p>
              MFA đang bật. Login PLATFORM mới phải qua TOTP hoặc recovery code.
            </p>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Mã TOTP / recovery code để tắt MFA</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="one-time-code"
                placeholder="123456 hoặc HABI-..."
              />
            </label>
            <button
              type="button"
              disabled={busy || !code.trim()}
              onClick={() => void disable()}
            >
              {busy ? "Đang xử lý…" : "Tắt MFA"}
            </button>
          </>
        ) : setup ? (
          <>
            <p>
              Thêm secret vào Google Authenticator, Microsoft Authenticator,
              1Password hoặc ứng dụng TOTP tương thích.
            </p>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Secret</span>
              <input readOnly value={setup.secret} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Provisioning URI</span>
              <textarea readOnly value={setup.provisioningUri} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Mã 6 số để xác nhận</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
              />
            </label>
            <button
              type="button"
              disabled={busy || !code.trim()}
              onClick={() => void confirmSetup()}
            >
              {busy ? "Đang xác nhận…" : "Bật MFA"}
            </button>
          </>
        ) : (
          <>
            <p>
              MFA hiện đang tắt. Nên bật cho PLATFORM_ADMIN và các operator có
              quyền billing, settings hoặc account management.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void beginSetup()}
            >
              {busy ? "Đang tạo secret…" : "Thiết lập MFA"}
            </button>
          </>
        )}
      </section>

      <section
        style={{
          border: "1px solid #e2e8f0",
          background: "#fff",
          borderRadius: 14,
          padding: 20,
          display: "grid",
          gap: 14
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center"
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>Phiên đăng nhập</h2>
            <p style={{ marginBottom: 0, color: "#64748b" }}>
              Device label được suy ra từ User-Agent; không dùng làm yếu tố xác thực.
            </p>
          </div>
          <button
            type="button"
            disabled={busy || sessions.length <= 1}
            onClick={() => void revokeOthers()}
          >
            Thu hồi các phiên khác
          </button>
        </div>

        {sessions.map((session) => (
          <article
            key={session.id}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: 14,
              display: "grid",
              gap: 4
            }}
          >
            <strong>
              {session.current
                ? "Phiên hiện tại"
                : session.deviceLabel ?? "Thiết bị chưa xác định"}
            </strong>
            <span>{session.deviceLabel ?? "Thiết bị chưa xác định"}</span>
            <small>
              Hoạt động: {new Date(session.lastSeenAt).toLocaleString("vi-VN")}
            </small>
            <small>
              Hết hạn: {new Date(session.expiresAt).toLocaleString("vi-VN")}
            </small>
          </article>
        ))}
      </section>
    </main>
  );
}
