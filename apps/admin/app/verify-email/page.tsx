import { Suspense } from "react";
import { VerifyEmailClient } from "./verify-email-client";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<main className="login-page"><section className="login-card"><div className="login-inline-state">Đang xác minh email…</div></section></main>}>
      <VerifyEmailClient />
    </Suspense>
  );
}
