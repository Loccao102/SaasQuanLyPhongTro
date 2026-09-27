"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAdminAuth } from "../../components/admin-auth-provider";
import { adminAuthApi } from "../../lib/admin-auth-api";

export function VerifyEmailClient() {
  const { refresh } = useAdminAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<
    "loading" | "success" | "mfa-required" | "error"
  >("loading");
  const [message, setMessage] = useState("Đang xác minh email…");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setState("error");
      setMessage("Liên kết xác minh không hợp lệ.");
      return;
    }

    let cancelled = false;
    void adminAuthApi.verifyEmail(token)
      .then(async (result) => {
        if (cancelled) return;

        if ("mfaEnrollmentRequired" in result) {
          setState("mfa-required");
          setMessage(
            "Email đã được xác minh và tenant đã được tạo. Role " +
              result.requiredByRole +
              " bắt buộc bật MFA trước khi đăng nhập."
          );
          return;
        }

        if ("mfaRequired" in result) {
          setState("mfa-required");
          setMessage(
            "Email đã được xác minh. Tài khoản đã bật MFA; hãy đăng nhập để xác thực hai bước."
          );
          return;
        }

        await refresh();
        if (cancelled) return;
        setState("success");
        setMessage("Email đã được xác minh. Tenant của bạn đã sẵn sàng.");
        router.replace("/");
        router.refresh();
      })
      .catch((caught) => {
        if (cancelled) return;
        setState("error");
        setMessage(
          caught instanceof Error
            ? caught.message
            : "Không thể xác minh email."
        );
      });

    return () => {
      cancelled = true;
    };
  }, [refresh, router, searchParams]);

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
          <span className="eyebrow">XÁC MINH EMAIL</span>
          <h1>{state === "success" ? "Xác minh thành công" : "Xác minh tài khoản"}</h1>
          <p>{message}</p>
        </div>

        {state === "mfa-required" ? (
          <Link className="primary-button login-submit" href="/login">
            Đăng nhập để thiết lập MFA
          </Link>
        ) : state === "error" ? (
          <Link className="secondary-button login-submit" href="/register">
            Đăng ký lại
          </Link>
        ) : null}
      </section>
    </main>
  );
}
