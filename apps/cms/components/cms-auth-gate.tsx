"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
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
    </>
  );
}
