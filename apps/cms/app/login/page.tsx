"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  cmsAuthApi,
  type CmsAuthenticationResult
} from "../../lib/cms-auth-api";

export default function CmsLoginPage() {
  const router = useRouter();
  const [mfaChallenge, setMfaChallenge] = useState<{
    challengeToken: string;
    expiresAt: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void cmsAuthApi.me()
      .then((session) => {
        if (session.user.accountType === "PLATFORM") {
          router.replace("/");
        }
      })
      .catch(() => undefined);
  }, [router]);

  function handleResult(result: CmsAuthenticationResult) {
    if ("mfaRequired" in result) {
      setMfaChallenge({
        challengeToken: result.challengeToken,
        expiresAt: result.expiresAt
      });
      return;
    }
    if (result.user.accountType !== "PLATFORM") {
      setError("Tài khoản này không có quyền truy cập Habi Control Plane.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      handleResult(
        await cmsAuthApi.login({
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? "")
        })
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể đăng nhập Control Plane."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaChallenge) return;

    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const session = await cmsAuthApi.verifyMfa({
        challengeToken: mfaChallenge.challengeToken,
        code: String(form.get("code") ?? "")
      });
      if (session.user.accountType !== "PLATFORM") {
        throw new Error("Phiên xác thực không thuộc tài khoản nền tảng.");
      }
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể xác thực mã hai bước."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#F7FAF9"
      }}
    >
      <section
        style={{
          width: "min(460px, 100%)",
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 18,
          padding: 28,
          boxShadow: "0 20px 45px rgba(15, 23, 42, 0.08)"
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <span
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: 42,
              height: 42,
              borderRadius: 12,
              background: "#25355C",
              color: "#fff",
              fontWeight: 800
            }}
          >
            H
          </span>
          <p
            style={{
              margin: "14px 0 4px",
              fontSize: 12,
              letterSpacing: ".12em",
              fontWeight: 700,
              color: "#64748b"
            }}
          >
            HABI CONTROL PLANE
          </p>
          <h1 style={{ margin: 0 }}>
            {mfaChallenge ? "Xác thực hai bước" : "Đăng nhập nền tảng"}
          </h1>
          <p style={{ color: "#64748b", lineHeight: 1.6 }}>
            {mfaChallenge
              ? "Nhập mã TOTP hoặc recovery code của tài khoản PLATFORM."
              : "Khu vực dành cho PLATFORM operator. Tenant account không thể đăng nhập tại đây."}
          </p>
        </div>

        {mfaChallenge ? (
          <form
            onSubmit={(event) => void verifyMfa(event)}
            style={{ display: "grid", gap: 14 }}
          >
            <label style={{ display: "grid", gap: 6 }}>
              <span>Mã xác thực</span>
              <input
                name="code"
                autoComplete="one-time-code"
                inputMode="numeric"
                placeholder="123456 hoặc HABI-..."
                required
                autoFocus
                disabled={submitting}
                style={{ padding: "11px 12px", borderRadius: 8, border: "1px solid #cbd5e1" }}
              />
            </label>
            {error ? (
              <div role="alert" style={{ color: "#b91c1c" }}>
                {error}
              </div>
            ) : null}
            <button type="submit" disabled={submitting} style={{ padding: "11px 14px" }}>
              {submitting ? "Đang xác thực…" : "Xác nhận & vào Control Plane"}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setMfaChallenge(null);
                setError(null);
              }}
            >
              Dùng tài khoản khác
            </button>
            <small style={{ color: "#64748b" }}>
              Challenge hết hạn lúc{" "}
              {new Date(mfaChallenge.expiresAt).toLocaleTimeString("vi-VN")}.
            </small>
          </form>
        ) : (
          <form
            onSubmit={(event) => void login(event)}
            style={{ display: "grid", gap: 14 }}
          >
            <label style={{ display: "grid", gap: 6 }}>
              <span>Email</span>
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                disabled={submitting}
                style={{ padding: "11px 12px", borderRadius: 8, border: "1px solid #cbd5e1" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Mật khẩu</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={submitting}
                style={{ padding: "11px 12px", borderRadius: 8, border: "1px solid #cbd5e1" }}
              />
            </label>
            {error ? (
              <div role="alert" style={{ color: "#b91c1c" }}>
                {error}
              </div>
            ) : null}
            <button type="submit" disabled={submitting} style={{ padding: "11px 14px" }}>
              {submitting ? "Đang đăng nhập…" : "Đăng nhập"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
