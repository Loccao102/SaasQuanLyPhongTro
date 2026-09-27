import { Suspense } from "react";
import { ResetPasswordClient } from "./reset-password-client";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main className="login-page"><section className="login-card"><div className="login-inline-state">Đang chuẩn bị đặt lại mật khẩu…</div></section></main>}>
      <ResetPasswordClient />
    </Suspense>
  );
}
