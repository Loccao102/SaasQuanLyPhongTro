"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";
import Link from "next/link";
import { TotpQrCode } from "@propops/ui/totp-qr";
import {
  authenticateWithPasskey,
  browserSupportsPasskeys
} from "@propops/ui/passkey";
import { useRouter, useSearchParams } from "next/navigation";
import { useAdminAuth } from "../../components/admin-auth-provider";
import { GoogleIdentityButton } from "../../components/google-identity-button";
import {
  adminAuthApi,
  type AdminAuthenticationResult,
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
  const [enrolledMemberships, setEnrolledMemberships] = useState(0);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPasskeySupported(browserSupportsPasskeys());
  }, []);

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

  const handleAuthenticationResult = useCallback(
    (result: AdminAuthenticationResult) => {
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
      finish(result.memberships.length);
    },
    [finish]
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);

    try {
      const result = await auth.login({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? "")
      });
      handleAuthenticationResult(result);
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
        const result = await auth.google({
          credential,
          mode: "LOGIN"
        });
        handleAuthenticationResult(result);
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
    [auth, handleAuthenticationResult]
  );

  async function passwordlessPasskeyLogin() {
    setSubmitting(true);
    setError(null);
    try {
      const request = await adminAuthApi.passkeyLoginOptions();
      const response = await authenticateWithPasskey(request.options);
      const session = await adminAuthApi.verifyPasskeyLogin({
        requestId: request.requestId,
        response
      });
      await auth.refresh();
      finish(session.memberships.length);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể đăng nhập bằng passkey."
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
      const setup = await adminAuthApi.setupRequiredMfa(
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

  async function submitRequiredEnrollment(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    if (!mfaEnrollment?.setup) return;

    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const result = await adminAuthApi.confirmRequiredMfa({
        challengeToken: mfaEnrollment.challengeToken,
        code: String(form.get("code") ?? "")
      });
      setRecoveryCodes(result.recoveryCodes);
      setEnrolledMemberships(result.memberships.length);
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

  async function continueAfterEnrollment() {
    setSubmitting(true);
    setError(null);
    try {
      await auth.refresh();
      setMfaEnrollment(null);
      setRecoveryCodes([]);
      finish(enrolledMemberships);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPasskeyMfa() {
    if (!mfaChallenge) return;

    setSubmitting(true);
    setError(null);
    try {
      const options = await adminAuthApi.passkeyMfaOptions(
        mfaChallenge.challengeToken
      );
      const response = await authenticateWithPasskey(options);
      const session = await adminAuthApi.verifyPasskeyMfa({
        challengeToken: mfaChallenge.challengeToken,
        response
      });
      setMfaChallenge(null);
      await auth.refresh();
      finish(session.memberships.length);
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

  async function submitMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaChallenge) return;

    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const session = await auth.verifyMfa({
        challengeToken: mfaChallenge.challengeToken,
        code: String(form.get("code") ?? "")
      });
      setMfaChallenge(null);
      finish(session.memberships.length);
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

        {mfaEnrollment ? (
          recoveryCodes.length > 0 ? (
            <div className="login-form">
              <div className="login-inline-state">
                MFA đã được bật cho role <strong>{mfaEnrollment.requiredByRole}</strong>.
                Hãy lưu recovery codes trước khi tiếp tục. Mỗi mã chỉ dùng được
                một lần và Habi sẽ không hiển thị lại.
              </div>
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
                className="secondary-button login-submit"
                type="button"
                onClick={() =>
                  void navigator.clipboard.writeText(recoveryCodes.join("\n"))
                }
              >
                Copy recovery codes
              </button>
              <button
                className="primary-button login-submit"
                type="button"
                disabled={submitting}
                onClick={() => void continueAfterEnrollment()}
              >
                {submitting ? "Đang mở workspace…" : "Tôi đã lưu mã — tiếp tục"}
              </button>
            </div>
          ) : mfaEnrollment.setup ? (
            <form
              className="login-form"
              onSubmit={(event) => void submitRequiredEnrollment(event)}
            >
              <div className="login-inline-state">
                Role <strong>{mfaEnrollment.requiredByRole}</strong> bắt buộc
                xác thực hai bước. Quét QR bằng Google Authenticator,
                Microsoft Authenticator, 1Password hoặc ứng dụng TOTP tương thích.
              </div>

              <div style={{ display: "grid", placeItems: "center" }}>
                <TotpQrCode value={mfaEnrollment.setup.provisioningUri} />
              </div>

              <details>
                <summary>Không quét được QR?</summary>
                <label>
                  <span>Secret</span>
                  <input readOnly value={mfaEnrollment.setup.secret} />
                </label>
              </details>

              <label>
                <span>Mã 6 số</span>
                <input
                  name="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  placeholder="123456"
                  pattern="[0-9]{6}"
                  required
                  disabled={submitting}
                  autoFocus
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
                disabled={submitting}
              >
                {submitting ? "Đang bật MFA…" : "Bật MFA & đăng nhập"}
              </button>
              <small>
                Enrollment challenge hết hạn lúc{" "}
                {new Date(mfaEnrollment.expiresAt).toLocaleTimeString("vi-VN")}.
              </small>
            </form>
          ) : (
            <div className="login-form">
              <div className="login-inline-state">
                Role <strong>{mfaEnrollment.requiredByRole}</strong> bắt buộc
                bật MFA trước khi được cấp session Habi.
              </div>
              {error ? (
                <div className="login-error" role="alert">
                  {error}
                </div>
              ) : null}
              <button
                className="primary-button login-submit"
                type="button"
                disabled={submitting}
                onClick={() => void beginRequiredEnrollment()}
              >
                {submitting ? "Đang chuẩn bị…" : "Thiết lập MFA ngay"}
              </button>
              <button
                className="secondary-button login-submit"
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
            className="login-form"
            onSubmit={(event) => void submitMfa(event)}
          >
            <div className="login-inline-state">
              Tài khoản này đã bật xác thực hai bước. Nhập mã 6 số từ ứng
              dụng Authenticator hoặc một recovery code.
            </div>

            <label>
              <span>Mã xác thực</span>
              <input
                name="code"
                autoComplete="one-time-code"
                inputMode="numeric"
                placeholder="123456 hoặc HABI-XXXX-XXXX-XXXX-XXXX"
                required
                disabled={submitting}
                autoFocus
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
              disabled={submitting}
            >
              {submitting ? "Đang xác thực…" : "Xác nhận & đăng nhập"}
            </button>
            {passkeySupported ? (
              <button
                className="secondary-button login-submit"
                type="button"
                disabled={submitting}
                onClick={() => void submitPasskeyMfa()}
              >
                Dùng passkey / Windows Hello / Touch ID
              </button>
            ) : null}
            <button
              className="secondary-button login-submit"
              type="button"
              disabled={submitting}
              onClick={() => {
                setMfaChallenge(null);
                setError(null);
              }}
            >
              Dùng tài khoản khác
            </button>
            <small>
              Challenge hết hạn lúc{" "}
              {new Date(mfaChallenge.expiresAt).toLocaleTimeString("vi-VN")}.
            </small>
          </form>
        ) : (
          <>
            {passkeySupported ? (
              <>
                <button
                  className="primary-button login-submit"
                  type="button"
                  disabled={
                    submitting ||
                    auth.status === "loading" ||
                    auth.status === "authenticated"
                  }
                  onClick={() => void passwordlessPasskeyLogin()}
                >
                  {submitting
                    ? "Đang mở passkey…"
                    : "Đăng nhập bằng passkey"}
                </button>
                <div className="login-inline-state" aria-hidden="true">
                  hoặc dùng Google / email
                </div>
              </>
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

              {config?.passwordRecoveryEnabled ? (
                <div className="login-footnote">
                  <Link href="/forgot-password">Quên mật khẩu?</Link>
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
          </>
        )}

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
