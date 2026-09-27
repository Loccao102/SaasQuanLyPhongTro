"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAdminAuth } from "../../components/admin-auth-provider";
import { GoogleIdentityButton } from "../../components/google-identity-button";
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

  const finish = useCallback(
    (memberships: number) => {
      if (memberships === 0) {
        setError("Tenant đã được tạo nhưng OWNER membership chưa sẵn sàng.");
        return;
      }
      router.replace("/");
      router.refresh();
    },
    [router]
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);

    try {
      if (config?.passwordRegistrationEnabled === false) {
        throw new Error(
          "Đăng ký bằng email/mật khẩu đang tắt. Hãy dùng Google hoặc liên hệ quản trị viên."
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

  const googleRegister = useCallback(
    async (credential: string) => {
      const tenantName = organizationName.trim();
      if (!tenantName) {
        setError("Nhập tên nhà trọ/doanh nghiệp trước khi đăng ký bằng Google.");
        return;
      }

      setSubmitting(true);
      setError(null);
      try {
        const session = await auth.google({
          credential,
          mode: "REGISTER",
          organizationName: tenantName
        });
        finish(session.memberships.length);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Không thể đăng ký bằng Google."
        );
      } finally {
        setSubmitting(false);
      }
    },
    [auth, finish, organizationName]
  );

  if (config && !config.registrationEnabled) {
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="login-brand">
            <span className="brand__mark">H</span>
            <div>
              <strong>Habi</strong>
              <span>Nhà gọn. Việc trôi.</span>
            </div>
          </div>
          <div className="login-heading">
            <span className="eyebrow">ĐĂNG KÝ</span>
            <h1>Đăng ký mới đang tạm đóng</h1>
            <p>CMS đã tắt self-service registration. Tài khoản hiện có vẫn sử dụng bình thường.</p>
          </div>
          <Link className="secondary-button login-submit" href="/login">
            Quay lại đăng nhập
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <span className="brand__mark">H</span>
          <div>
            <strong>Habi</strong>
            <span>Nhà gọn. Việc trôi.</span>
          </div>
        </div>

        <div className="login-heading">
          <span className="eyebrow">DÙNG THỬ HABI</span>
          <h1>Tạo tenant của bạn</h1>
          <p>
            Tài khoản đầu tiên sẽ là OWNER và tenant được cấp STARTER trial theo cấu hình CMS.
          </p>
        </div>

        {pendingEmail ? (
          <div className="login-inline-state" role="status">
            Habi đã gửi liên kết xác minh tới <strong>{pendingEmail}</strong>.
            Mở email và xác minh để hoàn tất tạo tenant.
          </div>
        ) : null}

        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>Tên nhà trọ / doanh nghiệp</span>
            <input
              name="organizationName"
              autoComplete="organization"
              required
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              disabled={submitting}
            />
          </label>

          {config?.googleEnabled && config.googleClientId ? (
            <>
              <GoogleIdentityButton
                clientId={config.googleClientId}
                mode="REGISTER"
                disabled={submitting}
                onCredential={googleRegister}
              />
              <div className="login-inline-state" aria-hidden="true">
                hoặc tạo tài khoản bằng email
              </div>
            </>
          ) : null}

          {config?.passwordRegistrationEnabled !== false ? (
            <>
              <label>
                <span>Họ tên OWNER</span>
                <input
                  name="displayName"
                  autoComplete="name"
                  required
                  disabled={submitting}
                />
              </label>

              <label>
                <span>Email</span>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  disabled={submitting}
                />
              </label>

              <label>
                <span>Mật khẩu</span>
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                  disabled={submitting}
                />
                <small>Tối thiểu 12 ký tự.</small>
              </label>
            </>
          ) : (
            <div className="login-inline-state">
              CMS đang tắt đăng ký bằng mật khẩu. Hãy dùng Google để xác minh
              email hoặc liên hệ quản trị viên.
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
              {submitting ? "Đang tạo tenant…" : "Tạo tenant & bắt đầu dùng thử"}
            </button>
          ) : null}
        </form>

        <p className="login-footnote">
          Đã có tài khoản? <Link href="/login">Đăng nhập</Link>
        </p>
      </section>
    </main>
  );
}
