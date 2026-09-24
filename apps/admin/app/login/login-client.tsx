"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAdminAuth } from "../../components/admin-auth-provider";

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (
      auth.status === "authenticated" &&
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
          "Đăng nhập thành công nhưng tài khoản chưa có workspace hoạt động."
        );
        return;
      }

      router.replace(next);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể đăng nhập."
      );
    } finally {
      setSubmitting(false);
    }
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
          <span className="eyebrow">ADMIN WORKSPACE</span>
          <h1>Đăng nhập vận hành</h1>
          <p>
            Dùng tài khoản được cấp quyền để quản lý tài sản, hợp đồng,
            hóa đơn và dòng tiền.
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

        <p className="login-footnote">
          Habi không có luồng đăng ký công khai ở giai đoạn này. Tài khoản
          phải được chủ hệ thống hoặc quản trị viên cấp quyền.
        </p>
      </section>
    </main>
  );
}
