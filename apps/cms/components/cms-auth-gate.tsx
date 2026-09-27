"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cmsAuthApi } from "../lib/cms-auth-api";
import {
  authenticateWithPasskey,
  browserSupportsPasskeys
} from "@propops/ui/passkey";
import {
  rejectCmsStepUp,
  resolveCmsStepUp,
  subscribeToCmsStepUpRequired
} from "../lib/step-up";

export function CmsAuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";
  const [ready, setReady] = useState(isLogin);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpBusy, setStepUpBusy] = useState(false);
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const [stepUpPassword, setStepUpPassword] = useState("");
  const [stepUpCode, setStepUpCode] = useState("");
  const [passkeySupported, setPasskeySupported] = useState(false);

  useEffect(() => {
    setPasskeySupported(browserSupportsPasskeys());
    return subscribeToCmsStepUpRequired(() => {
      setStepUpError(null);
      setStepUpPassword("");
      setStepUpCode("");
      setStepUpOpen(true);
    });
  }, []);

  useEffect(() => {
    if (isLogin) {
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);
    void cmsAuthApi.me()
      .then((session) => {
        if (cancelled) return;
        if (session.user.accountType !== "PLATFORM") {
          router.replace("/login");
          return;
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) router.replace("/login");
      });

    return () => {
      cancelled = true;
    };
  }, [isLogin, router]);

  async function completeStepUp(
    action: () => Promise<unknown>
  ) {
    setStepUpBusy(true);
    setStepUpError(null);
    try {
      await action();
      setStepUpOpen(false);
      setStepUpPassword("");
      setStepUpCode("");
      resolveCmsStepUp();
    } catch (caught) {
      setStepUpError(
        caught instanceof Error
          ? caught.message
          : "Không thể xác thực lại phiên."
      );
    } finally {
      setStepUpBusy(false);
    }
  }

  function cancelStepUp() {
    setStepUpOpen(false);
    setStepUpPassword("");
    setStepUpCode("");
    setStepUpError(null);
    rejectCmsStepUp();
  }

  async function completePasskeyStepUp() {
    await completeStepUp(async () => {
      const options = await cmsAuthApi.stepUpPasskeyOptions();
      const response = await authenticateWithPasskey(options);
      await cmsAuthApi.stepUpPasskeyVerify(response);
    });
  }

  if (!ready && !isLogin) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#F7FAF9"
        }}
      >
        <div style={{ color: "#475569" }}>
          Đang xác thực Habi Control Plane…
        </div>
      </main>
    );
  }

  if (isLogin) return children;

  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 14,
          right: 18,
          zIndex: 10000,
          display: "flex",
          gap: 8
        }}
      >
        <Link
          href="/security"
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            color: "#25355C",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 700
          }}
        >
          Bảo mật
        </Link>
        <button
          type="button"
          onClick={() => {
            if (stepUpOpen) {
              rejectCmsStepUp("Phiên đã được đăng xuất.");
              setStepUpOpen(false);
            }
            void cmsAuthApi.logout().finally(() => {
              router.replace("/login");
              router.refresh();
            });
          }}
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#fff",
            cursor: "pointer"
          }}
        >
          Đăng xuất
        </button>
      </div>
      {children}

      {stepUpOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cms-step-up-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 20000,
            display: "grid",
            placeItems: "center",
            padding: 20,
            background: "rgba(15, 23, 42, 0.64)",
            backdropFilter: "blur(5px)"
          }}
        >
          <section
            style={{
              width: "min(480px, 100%)",
              borderRadius: 16,
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              padding: 22,
              display: "grid",
              gap: 14,
              boxShadow: "0 24px 70px rgba(15,23,42,.24)"
            }}
          >
            <div>
              <p
                style={{
                  margin: 0,
                  color: "#64748b",
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: ".08em"
                }}
              >
                RECENT AUTHENTICATION
              </p>
              <h2 id="cms-step-up-title" style={{ margin: "5px 0 6px" }}>
                Xác thực lại để tiếp tục
              </h2>
              <p style={{ margin: 0, color: "#64748b", lineHeight: 1.6 }}>
                Đây là thao tác nhạy cảm trong Control Plane. Xác thực lại
                phiên hiện tại; request đang thực hiện sẽ tự tiếp tục sau khi
                thành công.
              </p>
            </div>

            {stepUpError ? (
              <div
                role="alert"
                style={{
                  padding: 10,
                  borderRadius: 8,
                  color: "#991b1b",
                  background: "#fef2f2",
                  border: "1px solid #fecaca"
                }}
              >
                {stepUpError}
              </div>
            ) : null}

            <label style={{ display: "grid", gap: 6 }}>
              <span>Mật khẩu hiện tại</span>
              <input
                type="password"
                autoComplete="current-password"
                value={stepUpPassword}
                disabled={stepUpBusy}
                onChange={(event) => setStepUpPassword(event.target.value)}
                placeholder="Dùng nếu tài khoản có password"
              />
            </label>
            <button
              type="button"
              disabled={stepUpBusy || !stepUpPassword.trim()}
              onClick={() =>
                void completeStepUp(() =>
                  cmsAuthApi.stepUpPassword(stepUpPassword)
                )
              }
            >
              {stepUpBusy ? "Đang xác thực…" : "Xác thực bằng mật khẩu"}
            </button>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8
              }}
            >
              <input
                autoComplete="one-time-code"
                value={stepUpCode}
                disabled={stepUpBusy}
                onChange={(event) => setStepUpCode(event.target.value)}
                placeholder="TOTP hoặc recovery code"
              />
              <button
                type="button"
                disabled={stepUpBusy || !stepUpCode.trim()}
                onClick={() =>
                  void completeStepUp(() =>
                    cmsAuthApi.stepUpCode(stepUpCode)
                  )
                }
              >
                Xác nhận mã
              </button>
            </div>

            {passkeySupported ? (
              <button
                type="button"
                disabled={stepUpBusy}
                onClick={() => void completePasskeyStepUp()}
              >
                Dùng passkey / Windows Hello / Touch ID
              </button>
            ) : null}

            <button
              type="button"
              disabled={stepUpBusy}
              onClick={cancelStepUp}
              style={{ justifySelf: "start" }}
            >
              Hủy thao tác
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
