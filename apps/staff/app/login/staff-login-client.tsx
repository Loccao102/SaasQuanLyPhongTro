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
import { useStaffAuth } from "../../components/staff-auth-provider";
import { StaffGoogleIdentityButton } from "../../components/google-identity-button";
import {
  staffAuthApi,
  type StaffAuthConfig
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

  const googleLogin = useCallback(
    async (credential: string) => {
      setSubmitting(true);
      setError(null);
      try {
        const session = await auth.google({
          credential,
          mode: "LOGIN"
        });
        if (session.memberships.length === 0) {
          setError("Tài khoản chưa có tenant hoạt động.");
          return;
        }
        router.replace(next);
        router.refresh();
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
    [auth, next, router]
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);

    try {
      const session = await auth.login({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? "")
      });

      if (session.memberships.length === 0) {
        setError(
          "Tài khoản chưa có workspace hoạt động."
        );
        return;
      }

      router.replace(next);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể đăng nhập. Vui lòng kiểm tra lại email hoặc mật khẩu."
      );
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
