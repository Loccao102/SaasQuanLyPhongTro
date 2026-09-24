"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStaffAuth } from "../../components/staff-auth-provider";

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          : "Không thể đăng nhập."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="staff-login-page">
      <section className="staff-login-card">
        <div className="staff-login-brand">
          <span className="staff-login-mark">H</span>
          <div>
            <strong>Habi Staff</strong>
            <span>Chốt số nhanh, kể cả khi mất mạng.</span>
          </div>
        </div>

        <div className="staff-login-heading">
          <span className="staff-kicker">FIELD OPERATIONS</span>
          <h1>Đăng nhập nhân viên</h1>
          <p>
            Đăng nhập khi có mạng một lần. Sau đó checklist và số chưa sync
            vẫn dùng được offline đến khi phiên hết hạn.
          </p>
        </div>

        {!auth.online ? (
          <div className="staff-state staff-state--warning">
            <strong>Thiết bị đang offline.</strong>
            <span>
              Không thể tạo phiên đăng nhập mới khi mất mạng.
            </span>
          </div>
        ) : null}

        <form
          className="staff-login-form"
          onSubmit={(event) => void submit(event)}
        >
          <label>
            <span>Email</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              required
              disabled={submitting || !auth.online}
            />
          </label>

          <label>
            <span>Mật khẩu</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={submitting || !auth.online}
            />
          </label>

          {error ? (
            <div
              className="staff-state staff-state--error"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          <button
            className="primary-action"
            type="submit"
            disabled={
              submitting ||
              !auth.online ||
              auth.status === "loading"
            }
          >
            {submitting ? "Đang đăng nhập…" : "Đăng nhập"}
          </button>
        </form>
      </section>
    </main>
  );
}
