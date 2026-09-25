"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AdminApiError,
  getSelectedOrganizationId,
  setSelectedOrganizationId,
  subscribeToAuthExpired
} from "../lib/admin-api-client";
import {
  adminAuthApi,
  type AdminMembership,
  type AdminSession
} from "../lib/admin-auth-api";

type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "error";

type AdminAuthContextValue = {
  status: AuthStatus;
  session: AdminSession | null;
  selectedOrganizationId: string | null;
  selectedMembership: AdminMembership | null;
  error: string | null;
  refresh: () => Promise<AdminSession | null>;
  login: (input: { email: string; password: string }) => Promise<AdminSession>;
  logout: () => Promise<void>;
  switchOrganization: (organizationId: string) => void;
};

const AdminAuthContext =
  createContext<AdminAuthContextValue | null>(null);

function resolveOrganization(
  session: AdminSession
): string | null {
  const selected = getSelectedOrganizationId();

  if (
    selected &&
    session.memberships.some(
      (membership) => membership.organizationId === selected
    )
  ) {
    return selected;
  }

  return session.memberships[0]?.organizationId ?? null;
}

function isPublicAuthPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/invitations/");
}

function loginPath(pathname: string): string {
  const next =
    pathname.startsWith("/") && pathname !== "/login"
      ? "?next=" + encodeURIComponent(pathname)
      : "";

  return "/login" + next;
}

export function AdminAuthProvider({
  children
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<AdminSession | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationState] =
    useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applySession = useCallback((nextSession: AdminSession) => {
    const organizationId = resolveOrganization(nextSession);

    setSession(nextSession);
    setSelectedOrganizationState(organizationId);
    setSelectedOrganizationId(organizationId);
    setError(null);
    setStatus("authenticated");

    return nextSession;
  }, []);

  const refresh = useCallback(async () => {
    setStatus((current) =>
      current === "authenticated" ? current : "loading"
    );

    try {
      return applySession(await adminAuthApi.me());
    } catch (caught) {
      if (
        caught instanceof AdminApiError &&
        caught.status === 401
      ) {
        setSession(null);
        setSelectedOrganizationState(null);
        setStatus("unauthenticated");
        setError(null);
        return null;
      }

      setStatus("error");
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể kiểm tra phiên đăng nhập."
      );
      return null;
    }
  }, [applySession]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () =>
      subscribeToAuthExpired(() => {
        setSession(null);
        setSelectedOrganizationState(null);
        setStatus("unauthenticated");
      }),
    []
  );

  useEffect(() => {
    if (
      status === "unauthenticated" &&
      !isPublicAuthPath(pathname)
    ) {
      router.replace(loginPath(pathname));
    }
  }, [pathname, router, status]);

  const login = useCallback(
    async (input: { email: string; password: string }) =>
      applySession(await adminAuthApi.login(input)),
    [applySession]
  );

  const logout = useCallback(async () => {
    try {
      await adminAuthApi.logout();
    } finally {
      setSelectedOrganizationId(null);
      setSelectedOrganizationState(null);
      setSession(null);
      setStatus("unauthenticated");
      router.replace("/login");
      router.refresh();
    }
  }, [router]);

  const switchOrganization = useCallback(
    (organizationId: string) => {
      if (
        !session?.memberships.some(
          (membership) =>
            membership.organizationId === organizationId
        )
      ) {
        return;
      }

      setSelectedOrganizationId(organizationId);
      setSelectedOrganizationState(organizationId);

      if (typeof window !== "undefined") {
        window.location.assign(pathname || "/");
      }
    },
    [pathname, session]
  );

  const selectedMembership = useMemo(
    () =>
      session?.memberships.find(
        (membership) =>
          membership.organizationId === selectedOrganizationId
      ) ?? null,
    [selectedOrganizationId, session]
  );

  const value = useMemo<AdminAuthContextValue>(
    () => ({
      status,
      session,
      selectedOrganizationId,
      selectedMembership,
      error,
      refresh,
      login,
      logout,
      switchOrganization
    }),
    [
      error,
      login,
      logout,
      refresh,
      selectedMembership,
      selectedOrganizationId,
      session,
      status,
      switchOrganization
    ]
  );

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  const context = useContext(AdminAuthContext);

  if (!context) {
    throw new Error(
      "useAdminAuth must be used inside AdminAuthProvider."
    );
  }

  return context;
}
