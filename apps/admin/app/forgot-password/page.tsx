"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { adminAuthApi } from "../../lib/admin-auth-api";

export default function ForgotPasswordPage() {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const result = await adminAuthApi.forgotPassword(
        String(form.get("email") ?? "")
      );
      setMessage(result.message);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể gửi yêu cầu đặt lại mật khẩu."
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
          <span className="eyebrow">KHÔI PHỤC TÀI KHOẢN</span>
          <h1>Quên mật khẩu</h1>
          <p>Nhập email. Habi sẽ gửi liên kết đặt lại mật khẩu nếu tài khoản phù hợp.</p>
        </div>

        <form className="login-form" onSubmit={(event) => void submit(event)}>
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

          {message ? (
            <div className="login-inline-state" role="status">
              {message}
            </div>
          ) : null}
          {error ? (
            <div className="login-error" role="alert">
              {error}
            </div>
          ) : null}

          <button
            className="primary-button login-submit"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Đang gửi…" : "Gửi liên kết đặt lại"}
          </button>
        </form>

        <p className="login-footnote">
          <Link href="/login">Quay lại đăng nhập</Link>
        </p>
      </section>
    </main>
  );
}
