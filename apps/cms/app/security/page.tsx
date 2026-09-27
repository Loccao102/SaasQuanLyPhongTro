"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TotpQrCode } from "@propops/ui/totp-qr";
import {
  browserSupportsPasskeys,
  createPasskey
} from "@propops/ui/passkey";
import {
  cmsAuthApi,
  type CmsPasskeyItem,
  type CmsSecurityAlertItem,
  type CmsSessionItem
} from "../../lib/cms-auth-api";

export default function CmsSecurityPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [requiredByRole, setRequiredByRole] = useState<string | null>(null);
  const [setup, setSetup] = useState<{
    secret: string;
    provisioningUri: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [sessions, setSessions] = useState<CmsSessionItem[]>([]);
  const [passkeys, setPasskeys] = useState<CmsPasskeyItem[]>([]);
  const [securityAlerts, setSecurityAlerts] =
    useState<CmsSecurityAlertItem[]>([]);
  const [stepUp, setStepUp] = useState<{
    recent: boolean;
    reauthenticatedAt: string;
    expiresAt: string;
  } | null>(null);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyName, setPasskeyName] = useState("Thiết bị này");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setPasskeySupported(browserSupportsPasskeys());
      const [mfa, activeSessions, passkeyResult, recentAuth, alertResult] =
        await Promise.all([
          cmsAuthApi.mfaStatus(),
          cmsAuthApi.sessions(),
          cmsAuthApi.passkeys(),
          cmsAuthApi.stepUpStatus(),
          cmsAuthApi.securityAlerts()
        ]);
      setEnabled(mfa.enabled);
      setRequiredByRole(mfa.required ? mfa.requiredByRole : null);
      setSessions(activeSessions.sessions);
      setPasskeys(passkeyResult.passkeys);
      setStepUp(recentAuth);
      setSecurityAlerts(alertResult.alerts);
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

  async function registerPasskey() {
    if (!passkeySupported) {
      setError("Trình duyệt hoặc thiết bị này chưa hỗ trợ passkey.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const options = await cmsAuthApi.passkeyRegistrationOptions();
      const response = await createPasskey(options);
      await cmsAuthApi.verifyPasskeyRegistration({
        response,
        name: passkeyName
      });
      setPasskeyName("Thiết bị này");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể đăng ký passkey."
      );
    } finally {
      setBusy(false);
    }
  }

  async function revokePasskey(passkey: CmsPasskeyItem) {
    if (
      !window.confirm(
        "Thu hồi passkey “" + passkey.name + "”? Thiết bị đó sẽ không dùng được passkey này nữa."
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await cmsAuthApi.revokePasskey(passkey.id);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể thu hồi passkey."
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

      {stepUp ? (
        <section
          style={{
            border: "1px solid #e2e8f0",
            background: "#fff",
            borderRadius: 14,
            padding: 18,
            display: "grid",
            gap: 6
          }}
        >
          <strong>
            Recent authentication: {stepUp.recent ? "còn hiệu lực" : "đã hết hạn"}
          </strong>
          <small style={{ color: "#64748b" }}>
            Xác thực gần nhất:{" "}
            {new Date(stepUp.reauthenticatedAt).toLocaleString("vi-VN")}
          </small>
          <small style={{ color: "#64748b" }}>
            {stepUp.recent
              ? "Các write nhạy cảm được phép đến " +
                new Date(stepUp.expiresAt).toLocaleTimeString("vi-VN") +
                "."
              : "Write Control Plane tiếp theo sẽ yêu cầu password, TOTP/recovery code hoặc passkey."}
          </small>
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
              {requiredByRole
                ? " Role " + requiredByRole + " đang thuộc policy bắt buộc MFA."
                : ""}
            </p>
            {requiredByRole ? (
              <p
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: "#f8fafc",
                  color: "#475569"
                }}
              >
                MFA không thể tắt khi role {requiredByRole} còn nằm trong
                policy bảo mật.
              </p>
            ) : (
              <>
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
            )}
          </>
        ) : setup ? (
          <>
            <p>
              {requiredByRole
                ? "Role " + requiredByRole + " đang bắt buộc MFA. "
                : ""}
              Quét QR bằng Google Authenticator, Microsoft Authenticator,
              1Password hoặc ứng dụng TOTP tương thích.
            </p>
            <div style={{ display: "grid", placeItems: "center" }}>
              <TotpQrCode value={setup.provisioningUri} />
            </div>
            <p style={{ color: "#64748b", margin: 0 }}>
              QR được dựng ngay trong Habi; provisioning secret không rời
              browser.
            </p>
            <details>
              <summary>Không quét được QR?</summary>
              <label style={{ display: "grid", gap: 6, marginTop: 8 }}>
                <span>Secret</span>
                <input readOnly value={setup.secret} />
              </label>
            </details>
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
              {requiredByRole
                ? "Role " +
                  requiredByRole +
                  " đang thuộc policy bắt buộc MFA. "
                : ""}
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
          gap: 12
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Cảnh báo bảo mật gần đây</h2>
          <p style={{ color: "#64748b", marginBottom: 0 }}>
            Các thay đổi credential và pattern xác thực đáng chú ý của tài
            khoản PLATFORM này.
          </p>
        </div>
        {securityAlerts.length === 0 ? (
          <small>Chưa có cảnh báo bảo mật nào.</small>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {securityAlerts.slice(0, 10).map((alert) => (
              <article
                key={alert.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: 12,
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
                <small style={{ color: "#64748b" }}>
                  {new Date(alert.createdAt).toLocaleString("vi-VN")}
                  {alert.deliveryStatus === "SENT" ? " · đã gửi email" : ""}
                </small>
              </article>
            ))}
          </div>
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
        <div>
          <h2 style={{ margin: 0 }}>Passkey</h2>
          <p style={{ color: "#64748b", marginBottom: 0 }}>
            Dùng Windows Hello, Touch ID, Face ID, khóa bảo mật hoặc passkey
            đồng bộ làm second factor sau primary login.
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
              placeholder="VD: MacBook Touch ID"
              maxLength={80}
              disabled={busy}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void registerPasskey()}
            >
              {busy ? "Đang xử lý…" : "Thêm passkey"}
            </button>
          </div>
        ) : (
          <p>Trình duyệt/thiết bị này chưa hỗ trợ WebAuthn passkey.</p>
        )}

        {passkeys.length === 0 ? (
          <small>Chưa có passkey nào được đăng ký.</small>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {passkeys.map((passkey) => (
              <article
                key={passkey.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: 14,
                  display: "grid",
                  gap: 4
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12
                  }}
                >
                  <strong>{passkey.name}</strong>
                  <button
                    type="button"
                    disabled={busy}
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
                  Tạo lúc: {new Date(passkey.createdAt).toLocaleString("vi-VN")}
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
