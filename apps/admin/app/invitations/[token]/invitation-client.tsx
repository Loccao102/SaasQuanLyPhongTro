"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  adminInvitationApi,
  type InvitationPreview
} from "../../../lib/admin-invitations-api";

export function InvitationClient({ token }: { token: string }) {
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void adminInvitationApi
      .inspect(token)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((caught) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Không thể đọc lời mời."
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    if (preview?.requiresPassword && password !== confirmPassword) {
      setError("Mật khẩu xác nhận chưa khớp.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await adminInvitationApi.accept(
        token,
        preview?.requiresPassword ? password : undefined
      );
      setAccepted(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể chấp nhận lời mời."
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
          <span className="eyebrow">TEAM INVITATION</span>
          <h1>Tham gia đội ngũ</h1>
          {preview ? (
            <p>
              {preview.displayName} · {preview.email}
              <br />
              {preview.organizationName} · {preview.role}
            </p>
          ) : null}
        </div>

        {loading ? (
          <div className="login-inline-state">Đang kiểm tra lời mời…</div>
        ) : null}

        {error ? (
          <div className="login-error" role="alert">
            {error}
          </div>
        ) : null}

        {accepted ? (
          <div className="login-inline-state">
            <strong>Lời mời đã được chấp nhận.</strong>
            <p>Bạn có thể đăng nhập bằng tài khoản vừa kích hoạt.</p>
            <Link className="primary-button" href="/login">
              Đi tới đăng nhập
            </Link>
          </div>
        ) : preview && !loading ? (
          <form className="login-form" onSubmit={(event) => void accept(event)}>
            {preview.requiresPassword ? (
              <>
                <label>
                  <span>Tạo mật khẩu</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    required
                    disabled={submitting}
                  />
                </label>
                <label>
                  <span>Xác nhận mật khẩu</span>
                  <input
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    required
                    disabled={submitting}
                  />
                </label>
              </>
            ) : (
              <div className="login-inline-state">
                Tài khoản đã có mật khẩu. Chấp nhận lời mời sẽ chỉ kích hoạt
                quyền truy cập workspace mới.
              </div>
            )}
            <button
              className="primary-button login-submit"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Đang kích hoạt…" : "Chấp nhận lời mời"}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
