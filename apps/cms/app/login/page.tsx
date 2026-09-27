"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { TotpQrCode } from "@propops/ui/totp-qr";
import {
  authenticateWithPasskey,
  browserSupportsPasskeys
} from "@propops/ui/passkey";
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
  const [mfaEnrollment, setMfaEnrollment] = useState<{
    challengeToken: string;
    expiresAt: string;
    requiredByRole: string;
    setup: {
      secret: string;
      provisioningUri: string;
    } | null;
  } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPasskeySupported(browserSupportsPasskeys());
  }, []);

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
      setMfaEnrollment(null);
      return;
    }
    if ("mfaEnrollmentRequired" in result) {
      setMfaEnrollment({
        challengeToken: result.challengeToken,
        expiresAt: result.expiresAt,
        requiredByRole: result.requiredByRole,
        setup: null
      });
      setMfaChallenge(null);
      setRecoveryCodes([]);
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

  async function passwordlessPasskeyLogin() {
    setSubmitting(true);
    setError(null);
    try {
      const request = await cmsAuthApi.passkeyLoginOptions();
      const response = await authenticateWithPasskey(request.options);
      const session = await cmsAuthApi.verifyPasskeyLogin({
        requestId: request.requestId,
        response
      });
      if (session.user.accountType !== "PLATFORM") {
        throw new Error("Passkey không thuộc tài khoản PLATFORM.");
      }
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể đăng nhập Control Plane bằng passkey."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function beginRequiredEnrollment() {
    if (!mfaEnrollment) return;
    setSubmitting(true);
    setError(null);
    try {
      const setup = await cmsAuthApi.setupRequiredMfa(
        mfaEnrollment.challengeToken
      );
      setMfaEnrollment((current) =>
        current
          ? {
              ...current,
              requiredByRole: setup.requiredByRole,
              setup: {
                secret: setup.secret,
                provisioningUri: setup.provisioningUri
              }
            }
          : current
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể bắt đầu thiết lập MFA."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmRequiredEnrollment(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    if (!mfaEnrollment?.setup) return;

    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const result = await cmsAuthApi.confirmRequiredMfa({
        challengeToken: mfaEnrollment.challengeToken,
        code: String(form.get("code") ?? "")
      });
      if (result.user.accountType !== "PLATFORM") {
        throw new Error("Phiên enrollment không thuộc tài khoản PLATFORM.");
      }
      setRecoveryCodes(result.recoveryCodes);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể hoàn tất thiết lập MFA."
      );
    } finally {
      setSubmitting(false);
    }
  }

  function continueAfterEnrollment() {
    setMfaEnrollment(null);
    setRecoveryCodes([]);
    router.replace("/");
    router.refresh();
  }

  async function verifyPasskeyMfa() {
    if (!mfaChallenge) return;

    setSubmitting(true);
    setError(null);
    try {
      const options = await cmsAuthApi.passkeyMfaOptions(
        mfaChallenge.challengeToken
      );
      const response = await authenticateWithPasskey(options);
      const session = await cmsAuthApi.verifyPasskeyMfa({
        challengeToken: mfaChallenge.challengeToken,
        response
      });
      if (session.user.accountType !== "PLATFORM") {
        throw new Error("Phiên passkey không thuộc tài khoản PLATFORM.");
      }
      setMfaChallenge(null);
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể xác thực bằng passkey."
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
            {mfaEnrollment
              ? "Thiết lập MFA bắt buộc"
              : mfaChallenge
                ? "Xác thực hai bước"
                : "Đăng nhập nền tảng"}
          </h1>
          <p style={{ color: "#64748b", lineHeight: 1.6 }}>
            {mfaEnrollment
              ? "Role " +
                mfaEnrollment.requiredByRole +
                " phải bật MFA trước khi Control Plane cấp session."
              : mfaChallenge
                ? "Nhập mã TOTP hoặc recovery code của tài khoản PLATFORM."
                : "Khu vực dành cho PLATFORM operator. Tenant account không thể đăng nhập tại đây."}
          </p>
        </div>

        {mfaEnrollment ? (
          recoveryCodes.length > 0 ? (
            <div style={{ display: "grid", gap: 14 }}>
              <p style={{ lineHeight: 1.6 }}>
                MFA đã bật. Lưu recovery codes ngay; mỗi mã chỉ dùng một lần
                và không hiển thị lại.
              </p>
              <div
                style={{
                  display: "grid",
                  gap: 6,
                  padding: 14,
                  borderRadius: 10,
                  background: "#f8fafc",
                  fontFamily: "monospace"
                }}
              >
                {recoveryCodes.map((code) => (
                  <code key={code}>{code}</code>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard.writeText(recoveryCodes.join("\n"))
                }
              >
                Copy recovery codes
              </button>
              <button type="button" onClick={continueAfterEnrollment}>
                Tôi đã lưu mã — vào Control Plane
              </button>
            </div>
          ) : mfaEnrollment.setup ? (
            <form
              onSubmit={(event) => void confirmRequiredEnrollment(event)}
              style={{ display: "grid", gap: 14 }}
            >
              <div style={{ display: "grid", placeItems: "center" }}>
                <TotpQrCode value={mfaEnrollment.setup.provisioningUri} />
              </div>
              <p style={{ color: "#64748b", lineHeight: 1.6 }}>
                Quét QR bằng ứng dụng Authenticator. Secret không rời khỏi
                browser Habi.
              </p>
              <details>
                <summary>Không quét được QR?</summary>
                <input readOnly value={mfaEnrollment.setup.secret} />
              </details>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Mã 6 số</span>
                <input
                  name="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  placeholder="123456"
                  required
                  autoFocus
                  disabled={submitting}
                  style={{
                    padding: "11px 12px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1"
                  }}
                />
              </label>
              {error ? (
                <div role="alert" style={{ color: "#b91c1c" }}>
                  {error}
                </div>
              ) : null}
              <button type="submit" disabled={submitting}>
                {submitting ? "Đang bật MFA…" : "Bật MFA & đăng nhập"}
              </button>
            </form>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <p style={{ lineHeight: 1.6 }}>
                Role <strong>{mfaEnrollment.requiredByRole}</strong> nằm trong
                policy bắt buộc MFA. Habi chưa cấp session Control Plane.
              </p>
              {error ? (
                <div role="alert" style={{ color: "#b91c1c" }}>
                  {error}
                </div>
              ) : null}
              <button
                type="button"
                disabled={submitting}
                onClick={() => void beginRequiredEnrollment()}
              >
                {submitting ? "Đang chuẩn bị…" : "Thiết lập MFA ngay"}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setMfaEnrollment(null);
                  setError(null);
                }}
              >
                Dùng tài khoản khác
              </button>
            </div>
          )
        ) : mfaChallenge ? (
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
            {passkeySupported ? (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void verifyPasskeyMfa()}
              >
                Dùng passkey / Windows Hello / Touch ID
              </button>
            ) : null}
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
          <div style={{ display: "grid", gap: 14 }}>
            {passkeySupported ? (
              <>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void passwordlessPasskeyLogin()}
                  style={{ padding: "11px 14px" }}
                >
                  {submitting
                    ? "Đang mở passkey…"
                    : "Đăng nhập bằng passkey"}
                </button>
                <div
                  style={{
                    textAlign: "center",
                    color: "#64748b",
                    fontSize: 13
                  }}
                >
                  hoặc dùng email và mật khẩu
                </div>
              </>
            ) : null}
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
          </div>
        )}
      </section>
    </main>
  );
}
