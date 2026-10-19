"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CameraOutlined,
  DisconnectOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LockOutlined,
  LoginOutlined,
  MailOutlined,
  SyncOutlined,
  ThunderboltOutlined,
  WarningOutlined
} from "@ant-design/icons";
import { HabiMark } from "@propops/ui/habi-brand";
import { TotpQrCode } from "@propops/ui/totp-qr";
import { useStaffAuth } from "../../components/staff-auth-provider";
import { StaffGoogleIdentityButton } from "../../components/google-identity-button";
import {
  staffAuthApi,
  type StaffAuthConfig,
  type StaffAuthenticationResult
} from "../../lib/staff-auth-api";

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export function StaffLoginClient() {
  const auth = useStaffAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = useMemo(
    () => safeNext(searchParams.get("next")),
    [searchParams]
  );
  const [config, setConfig] = useState<StaffAuthConfig | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<{
    challengeToken: string;
    expiresAt: string;
  } | null>(null);
  const [mfaEnrollment, setMfaEnrollment] = useState<{
    challengeToken: string;
    expiresAt: string;
    requiredByRole: string;
    setup: { secret: string; provisioningUri: string } | null;
  } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [enrolledMemberships, setEnrolledMemberships] = useState(0);

  useEffect(() => {
    if (auth.online) {
      void staffAuthApi.config().then(setConfig).catch(() => setConfig(null));
    }
  }, [auth.online]);

  useEffect(() => {
    if (
      (auth.status === "authenticated" ||
        auth.status === "offline-authenticated") &&
      auth.selectedMembership
    ) {
      router.replace(next);
    }
  }, [
    auth.selectedMembership,
    auth.status,
    next,
    router
  ]);

  const finish = useCallback(
    (memberships: number) => {
      if (memberships === 0) {
        setError("Tài khoản chưa có workspace hoạt động.");
        return;
      }
      router.replace(next);
      router.refresh();
    },
    [next, router]
  );

  const handleAuthenticationResult = useCallback(
    (result: StaffAuthenticationResult) => {
      if ("mfaRequired" in result) {
        setMfaChallenge({
          challengeToken: result.challengeToken,
          expiresAt: result.expiresAt
        });
        setMfaEnrollment(null);
        return;
      }
      if ("mfaEnrollmentRequired" in result) {
        setMfaEnrollment({
          challengeToken: result.challengeToken,
          expiresAt: result.expiresAt,
          requiredByRole: result.requiredByRole,
          setup: null
        });
        setMfaChallenge(null);
        setRecoveryCodes([]);
        return;
      }
      finish(result.memberships.length);
    },
    [finish]
  );

  const googleLogin = useCallback(
    async (credential: string) => {
      setSubmitting(true);
      setError(null);
      try {
        handleAuthenticationResult(
          await auth.google({ credential, mode: "LOGIN" })
        );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Không thể đăng nhập bằng Google."
        );
      } finally {
        setSubmitting(false);
      }
    },
    [auth, handleAuthenticationResult]
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      handleAuthenticationResult(await auth.login({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? "")
      }));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể đăng nhập. Vui lòng kiểm tra email hoặc mật khẩu."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaChallenge) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const session = await auth.verifyMfa({
        challengeToken: mfaChallenge.challengeToken,
        code: String(form.get("code") ?? "").trim()
      });
      setMfaChallenge(null);
      finish(session.memberships.length);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể xác thực MFA.");
    } finally {
      setSubmitting(false);
    }
  }

  async function beginRequiredEnrollment() {
    if (!mfaEnrollment) return;
    setSubmitting(true);
    setError(null);
    try {
      const setup = await staffAuthApi.setupRequiredMfa(mfaEnrollment.challengeToken);
      setMfaEnrollment((current) =>
        current ? {
          ...current,
          requiredByRole: setup.requiredByRole,
          setup: { secret: setup.secret, provisioningUri: setup.provisioningUri }
        } : current
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể thiết lập MFA.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRequiredEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaEnrollment?.setup) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const result = await staffAuthApi.confirmRequiredMfa({
        challengeToken: mfaEnrollment.challengeToken,
        code: String(form.get("code") ?? "").trim()
      });
      setRecoveryCodes(result.recoveryCodes);
      setEnrolledMemberships(result.memberships.length);
      // Keep recovery codes visible until the user explicitly confirms saving them.
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể hoàn tất MFA.");
    } finally {
      setSubmitting(false);
    }
  }

  async function continueAfterEnrollment() {
    setSubmitting(true);
    setError(null);
    try {
      const session = await auth.refresh();
      if (!session) {
        setError("Chưa xác thực được phiên mới. Hãy kiểm tra kết nối và thử lại.");
        return;
      }
      setMfaEnrollment(null);
      setRecoveryCodes([]);
      finish(enrolledMemberships);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể mở ca trực.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="staff-login-page">
      <section className="staff-login-card">
        <header className="staff-login-header">
          <div className="staff-login-icon-badge">
            <HabiMark size={36} />
          </div>
          <div className="staff-login-brand-meta">
            <span className="staff-login-brand-title">Habi Staff</span>
            <span className="staff-login-pill">Field Ops</span>
          </div>
          <div className="staff-login-heading">
            <h1>Đăng nhập nhân viên</h1>
            <p>
              Ghi chỉ số điện nước & xử lý bảo trì phòng trọ tiện lợi, hỗ trợ hoạt động offline.
            </p>
          </div>
        </header>

        {!auth.online ? (
          <div
            className="staff-state staff-state--warning"
            style={{ flexDirection: "row", alignItems: "center", gap: "10px" }}
          >
            <DisconnectOutlined style={{ fontSize: "20px", color: "var(--staff-warning)" }} />
            <div>
              <strong>Thiết bị đang ngoại tuyến.</strong>
              <div style={{ fontSize: "12px", marginTop: "2px" }}>
                Cần có mạng một lần đầu để xác thực phiên đăng nhập vào máy.
              </div>
            </div>
          </div>
        ) : null}

        {mfaEnrollment ? (
          recoveryCodes.length > 0 ? (
            <div className="staff-login-form">
              <div className="staff-state staff-state--warning">
                MFA đã được bật. Hãy lưu mã dự phòng này ở nơi an toàn.
                Habi sẽ không hiển thị lại các mã này.
              </div>
              <div style={{ display: "grid", gap: "8px", padding: "16px", borderRadius: "12px", background: "var(--staff-surface)", overflowWrap: "anywhere" }}>
                {recoveryCodes.map((code) => <code key={code}>{code}</code>)}
              </div>
              <button className="staff-primary-button" type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(recoveryCodes.join("\n")).catch(
                    () => setError("Không thể sao chép. Hãy lưu mã thủ công.")
                  );
                }}>
                Sao chép mã dự phòng
              </button>
              {error ? <div role="alert" className="staff-state staff-state--error">{error}</div> : null}
              <button className="staff-primary-button" type="button" disabled={submitting}
                onClick={() => void continueAfterEnrollment()}>
                {submitting ? "Đang mở ca trực…" : "Tôi đã lưu mã — tiếp tục"}
              </button>
            </div>
          ) : mfaEnrollment.setup ? (
            <form className="staff-login-form" onSubmit={(event) => void submitRequiredEnrollment(event)}>
              <div className="staff-state">
                Vai trò {mfaEnrollment.requiredByRole} bắt buộc bật xác thực hai bước.
                Quét QR bằng Google/Microsoft Authenticator hoặc ứng dụng TOTP tương thích.
              </div>
              <div style={{ display: "grid", placeItems: "center" }}>
                <TotpQrCode value={mfaEnrollment.setup.provisioningUri} />
              </div>
              <details>
                <summary>Không quét được QR? Xem mã thiết lập thủ công</summary>
                <code style={{ overflowWrap: "anywhere" }}>{mfaEnrollment.setup.secret}</code>
              </details>
              <div className="staff-form-group">
                <label className="staff-form-label" htmlFor="staff-enrollment-code">Mã 6 chữ số</label>
                <input className="staff-input" id="staff-enrollment-code" name="code"
                  autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}"
                  placeholder="123456" required disabled={submitting} autoFocus />
              </div>
              {error ? <div role="alert" className="staff-state staff-state--error">{error}</div> : null}
              <button className="staff-primary-button" type="submit" disabled={submitting}>
                {submitting ? "Đang xác nhận…" : "Bật MFA và đăng nhập"}
              </button>
            </form>
          ) : (
            <div className="staff-login-form">
              <div className="staff-state staff-state--warning">
                Vai trò {mfaEnrollment.requiredByRole} cần bật MFA trước khi đăng nhập.
              </div>
              {error ? <div role="alert" className="staff-state staff-state--error">{error}</div> : null}
              <button className="staff-primary-button" type="button" disabled={submitting}
                onClick={() => void beginRequiredEnrollment()}>
                {submitting ? "Đang chuẩn bị…" : "Thiết lập MFA"}
              </button>
              <button className="staff-primary-button" type="button" disabled={submitting}
                onClick={() => { setMfaEnrollment(null); setError(null); }}>
                Dùng tài khoản khác
              </button>
            </div>
          )
        ) : mfaChallenge ? (
          <form className="staff-login-form" onSubmit={(event) => void submitMfa(event)}>
            <div className="staff-state">
              Nhập mã từ ứng dụng Authenticator hoặc mã dự phòng để hoàn tất đăng nhập.
            </div>
            <div className="staff-form-group">
              <label className="staff-form-label" htmlFor="staff-mfa-code">Mã xác thực</label>
              <input className="staff-input" id="staff-mfa-code" name="code"
                autoComplete="one-time-code" placeholder="Mã 6 số hoặc mã dự phòng"
                required disabled={submitting} autoFocus />
            </div>
            {error ? <div role="alert" className="staff-state staff-state--error">{error}</div> : null}
            <button className="staff-primary-button" type="submit" disabled={submitting}>
              {submitting ? "Đang xác thực…" : "Xác nhận và vào ca trực"}
            </button>
            <button className="staff-primary-button" type="button" disabled={submitting}
              onClick={() => { setMfaChallenge(null); setError(null); }}>
              Dùng tài khoản khác
            </button>
          </form>
        ) : (
          <>
        {config?.googleEnabled && config.googleClientId && auth.online ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <StaffGoogleIdentityButton
              clientId={config.googleClientId}
              disabled={submitting}
              onCredential={googleLogin}
            />
            <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "4px 0" }}>
              <div style={{ flex: 1, height: "1px", background: "var(--staff-border)" }} />
              <span style={{ fontSize: "11px", color: "var(--staff-text-muted)", fontWeight: 600 }}>
                HOẶC ĐĂNG NHẬP EMAIL
              </span>
              <div style={{ flex: 1, height: "1px", background: "var(--staff-border)" }} />
            </div>
          </div>
        ) : null}

        <form
          className="staff-login-form"
          onSubmit={(event) => void submit(event)}
          noValidate={false}
        >
          <div className="staff-form-group">
            <label className="staff-form-label" htmlFor="staff-email">
              <span>Email tài khoản</span>
            </label>
            <div className="staff-input-wrapper">
              <MailOutlined className="staff-input-icon" />
              <input
                id="staff-email"
                className="staff-input"
                name="email"
                type="email"
                placeholder="nhanvien@domain.vn"
                autoComplete="username"
                inputMode="email"
                required
                disabled={submitting || !auth.online}
              />
            </div>
          </div>

          <div className="staff-form-group">
            <label className="staff-form-label" htmlFor="staff-password">
              <span>Mật khẩu</span>
            </label>
            <div className="staff-input-wrapper">
              <LockOutlined className="staff-input-icon" />
              <input
                id="staff-password"
                className="staff-input"
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                disabled={submitting || !auth.online}
                style={{ paddingRight: "44px" }}
              />
              <button
                type="button"
                className="staff-password-toggle"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              >
                {showPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              </button>
            </div>
          </div>

          {error ? (
            <div
              className="staff-state staff-state--error"
              role="alert"
              style={{ flexDirection: "row", alignItems: "center", gap: "10px" }}
            >
              <WarningOutlined style={{ fontSize: "18px", flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          ) : null}

          <button
            className="staff-primary-button"
            type="submit"
            disabled={
              submitting ||
              !auth.online ||
              auth.status === "loading"
            }
          >
            <LoginOutlined />
            <span>{submitting ? "Đang xác thực phiên…" : "Đăng nhập vào ca trực"}</span>
          </button>
        </form>

          </>
        )}

        <footer className="staff-login-features">
          <span className="staff-feature-badge">
            <ThunderboltOutlined style={{ color: "#d97706" }} /> Chốt số offline
          </span>
          <span className="staff-feature-badge">
            <SyncOutlined style={{ color: "#0d9488" }} /> Tự động sync
          </span>
          <span className="staff-feature-badge">
            <CameraOutlined style={{ color: "#0284c7" }} /> Chụp ảnh công tơ
          </span>
        </footer>
      </section>
    </main>
  );
}
