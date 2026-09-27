"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cmsAuthApi } from "../lib/cms-auth-api";

export function CmsAuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";
  const [ready, setReady] = useState(isLogin);

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

  return children;
}
