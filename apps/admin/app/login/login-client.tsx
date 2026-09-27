"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAdminAuth } from "../../components/admin-auth-provider";
import { GoogleIdentityButton } from "../../components/google-identity-button";
import {
  adminAuthApi,
  type AuthConfig
} from "../../lib/admin-auth-api";

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export function LoginClient() {
  const auth = useAdminAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = useMemo(
    () => safeNext(searchParams.get("next")),
    [searchParams]
  );
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void adminAuthApi.config()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    if (
      auth.status === "authenticated" &&
      auth.selectedMembership
    ) {
      router.replace(next);
    }
  }, [auth.selectedMembership, auth.status, next, router]);

  const finish = useCallback(
    (memberships: number) => {
      if (memberships === 0) {
        setError("Tài khoản chưa có tenant hoạt động.");
        return;
      }
      router.replace(next);
      router.refresh();
    },
    [next, router]
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
      finish(session.memberships.length);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Không thể đăng nhập."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const googleLogin = useCallback(
    async (credential: string) => {
      setSubmitting(true);
      setError(null);
      try {
        const session = await auth.google({
          credential,
          mode: "LOGIN"
        });
        finish(session.memberships.length);
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
    [auth, finish]
  );

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
          <span className="eyebrow">HABI WORKSPACE</span>
          <h1>Đăng nhập</h1>
          <p>
            Tiếp tục quản lý cơ sở, hợp đồng, hóa đơn và dòng tiền của tenant.
          </p>
        </div>

        {auth.status === "loading" ? (
          <div className="login-inline-state">
            Đang kiểm tra phiên đăng nhập hiện tại…
          </div>
        ) : null}

        {auth.status === "error" ? (
          <div className="login-error" role="alert">
            <strong>Không thể kiểm tra phiên.</strong>
            <span>{auth.error}</span>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void auth.refresh()}
            >
              Thử lại
            </button>
          </div>
        ) : null}

        {config?.googleEnabled && config.googleClientId ? (
          <>
            <GoogleIdentityButton
              clientId={config.googleClientId}
              mode="LOGIN"
              disabled={submitting}
              onCredential={googleLogin}
            />
            <div className="login-inline-state" aria-hidden="true">
              hoặc đăng nhập bằng email
            </div>
          </>
        ) : null}

        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>Email</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
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
              autoComplete="current-password"
              required
              disabled={submitting}
            />
          </label>

          {error ? (
            <div className="login-error" role="alert">
              {error}
            </div>
          ) : null}

          <div className="login-footnote">
            <Link href="/forgot-password">Quên mật khẩu?</Link>
          </div>

          <button
            className="primary-button login-submit"
            type="submit"
            disabled={
              submitting ||
              auth.status === "loading" ||
              auth.status === "authenticated"
            }
          >
            {submitting ? "Đang đăng nhập…" : "Đăng nhập"}
          </button>
        </form>

        {config?.registrationEnabled ? (
          <p className="login-footnote">
            Chưa có Habi?{" "}
            <Link href="/register">
              Tạo tenant và dùng thử ngay
            </Link>
          </p>
        ) : (
          <p className="login-footnote">
            Đăng ký mới đang tạm đóng. Tài khoản hiện có vẫn đăng nhập bình thường.
          </p>
        )}
      </section>
    </main>
  );
}
