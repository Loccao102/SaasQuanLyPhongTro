import { Suspense } from "react";
import { LoginClient } from "./login-client";

function LoginFallback() {
  return (
    <main className="login-page" aria-live="polite">
      <section className="login-card">
        <div className="login-brand">
          <span className="brand__mark">H</span>
          <div>
            <strong>Habi</strong>
            <span>Nhà gọn. Việc trôi.</span>
          </div>
        </div>
        <div className="login-inline-state">
          Đang chuẩn bị phiên đăng nhập…
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginClient />
    </Suspense>
  );
}
