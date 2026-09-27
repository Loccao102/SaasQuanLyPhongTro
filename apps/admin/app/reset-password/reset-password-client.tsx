"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { adminAuthApi } from "../../lib/admin-auth-api";

export function ResetPasswordClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : "Liên kết đặt lại mật khẩu không hợp lệ."
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    if (password !== confirmPassword) {
      setError("Hai mật khẩu chưa khớp.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await adminAuthApi.resetPassword({
        token,
        newPassword: password
      });
      setSuccess(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể đặt lại mật khẩu."
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
          <span className="eyebrow">BẢO MẬT TÀI KHOẢN</span>
          <h1>Đặt lại mật khẩu</h1>
          <p>Mật khẩu mới sẽ làm toàn bộ phiên đăng nhập cũ hết hiệu lực.</p>
        </div>

        {success ? (
          <>
            <div className="login-inline-state" role="status">
              Mật khẩu đã được đặt lại thành công.
            </div>
            <Link className="primary-button login-submit" href="/login">
              Đăng nhập lại
            </Link>
          </>
        ) : (
          <form className="login-form" onSubmit={(event) => void submit(event)}>
            <label>
              <span>Mật khẩu mới</span>
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                disabled={submitting || !token}
              />
              <small>Tối thiểu 12 ký tự.</small>
            </label>

            <label>
              <span>Nhập lại mật khẩu mới</span>
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                disabled={submitting || !token}
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
              disabled={submitting || !token}
            >
              {submitting ? "Đang cập nhật…" : "Đặt lại mật khẩu"}
            </button>
          </form>
        )}

        <p className="login-footnote">
          <Link href="/login">Quay lại đăng nhập</Link>
        </p>
      </section>
    </main>
  );
}
