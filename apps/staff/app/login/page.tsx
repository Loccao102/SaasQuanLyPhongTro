import { Suspense } from "react";
import { StaffLoginClient } from "./staff-login-client";

function LoginFallback() {
  return (
    <main className="staff-login-page">
      <section className="staff-login-card">
        <div className="staff-state">
          Đang chuẩn bị phiên đăng nhập…
        </div>
      </section>
    </main>
  );
}

export default function StaffLoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <StaffLoginClient />
    </Suspense>
  );
}
