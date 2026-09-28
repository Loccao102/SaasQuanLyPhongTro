"use client";

import {
  useEffect,
  useState,
  type FormEvent
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAdminAuth } from "../../components/admin-auth-provider";
import { AuthShell } from "../../components/auth-shell";
import {
  BankOutlined,
  LockOutlined,
  LoginOutlined,
  MailOutlined,
  RocketOutlined,
  UserOutlined
} from "@ant-design/icons";
import {
  adminAuthApi,
  type AuthConfig
} from "../../lib/admin-auth-api";

export function RegisterClient() {
  const auth = useAdminAuth();
  const router = useRouter();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void adminAuthApi.config()
      .then(setConfig)
      .catch((caught) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "Không thể tải cấu hình đăng ký."
        );
      });
  }, []);

  useEffect(() => {
    if (auth.status === "authenticated" && auth.selectedMembership) {
      router.replace("/");
      router.refresh();
    }
  }, [auth.selectedMembership, auth.status, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);

    try {
      if (config?.passwordRegistrationEnabled === false) {
        throw new Error(
          "Đăng ký bằng email/mật khẩu đang tạm tắt. Hãy liên hệ quản trị viên."
        );
      }

      const pending = await auth.register({
        displayName: String(form.get("displayName") ?? ""),
        organizationName: String(form.get("organizationName") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? "")
      });
      setPendingEmail(pending.email);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể tạo tài khoản Habi."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (config && !config.registrationEnabled) {
    return (
      <AuthShell
        eyebrow="DÙNG THỬ HABI"
        title="Đăng ký đang tạm đóng"
        description="Self-service registration đang được tắt từ Control Plane. Tài khoản hiện có vẫn sử dụng bình thường."
      >
        <Link className="secondary-button login-submit auth-primary-action" href="/login">
          <LoginOutlined aria-hidden="true" />
          Quay lại đăng nhập
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="DÙNG THỬ HABI"
      title="Tạo workspace của bạn"
      description="Tạo tài khoản OWNER đầu tiên. Habi sẽ khởi tạo tenant và gói dùng thử theo cấu hình hiện tại."
    >

        {pendingEmail ? (
          <div className="login-inline-state" role="status">
            Habi đã gửi liên kết xác minh tới <strong>{pendingEmail}</strong>.
            Mở email và xác minh để hoàn tất tạo tenant.
          </div>
        ) : null}

        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>Tên nhà trọ / doanh nghiệp</span>
            <div className="auth-field">
              <BankOutlined aria-hidden="true" />
              <input
                name="organizationName"
                autoComplete="organization"
                placeholder="Ví dụ: Nhà trọ An Bình"
                required
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                disabled={submitting}
              />
            </div>
          </label>

          {config?.passwordRegistrationEnabled !== false ? (
            <>
              <label>
                <span>Họ tên OWNER</span>
                <div className="auth-field">
                  <UserOutlined aria-hidden="true" />
                  <input
                    name="displayName"
                    autoComplete="name"
                    placeholder="Nguyễn Văn A"
                    required
                    disabled={submitting}
                  />
                </div>
              </label>

              <label>
                <span>Email</span>
                <div className="auth-field">
                  <MailOutlined aria-hidden="true" />
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="ban@example.com"
                    required
                    disabled={submitting}
                  />
                </div>
              </label>

              <label>
                <span>Mật khẩu</span>
                <div className="auth-field">
                  <LockOutlined aria-hidden="true" />
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Tối thiểu 12 ký tự"
                    minLength={12}
                    required
                    disabled={submitting}
                  />
                </div>
                <small>Tối thiểu 12 ký tự.</small>
              </label>
            </>
          ) : (
            <div className="login-inline-state">
              Đăng ký bằng email/mật khẩu đang tạm tắt. Hãy liên hệ quản trị viên.
            </div>
          )}

          {error ? (
            <div className="login-error" role="alert">
              {error}
            </div>
          ) : null}

          {config?.passwordRegistrationEnabled !== false ? (
            <button
              className="primary-button login-submit"
              type="submit"
              disabled={submitting || auth.status === "loading"}
            >
              <RocketOutlined aria-hidden="true" />
              {submitting ? "Đang tạo workspace…" : "Tạo workspace & bắt đầu dùng thử"}
            </button>
          ) : null}
        </form>

        <p className="login-footnote">
          Đã có tài khoản?{" "}
          <Link className="auth-inline-link" href="/login">
            <LoginOutlined aria-hidden="true" /> Đăng nhập
          </Link>
        </p>
    </AuthShell>
  );
}
