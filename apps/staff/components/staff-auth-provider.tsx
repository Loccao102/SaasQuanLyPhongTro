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
  staffAuthApi,
  StaffAuthApiError,
  StaffNetworkError,
  type StaffMembership,
  type StaffSession
} from "../lib/staff-auth-api";
import {
  getSelectedStaffOrganizationId,
  setSelectedStaffOrganizationId,
  subscribeToStaffAuthExpired
} from "../lib/staff-api-client";

type StaffAuthStatus =
  | "loading"
  | "authenticated"
  | "offline-authenticated"
  | "unauthenticated"
  | "error";

type CachedStaffSession = {
  session: StaffSession;
  selectedOrganizationId: string | null;
};

type StaffAuthContextValue = {
  status: StaffAuthStatus;
  online: boolean;
  session: StaffSession | null;
  selectedOrganizationId: string | null;
  selectedMembership: StaffMembership | null;
  error: string | null;
  refresh: () => Promise<StaffSession | null>;
  login: (input: { email: string; password: string }) => Promise<StaffSession>;
  logout: () => Promise<void>;
  switchOrganization: (organizationId: string) => void;
};

const StaffAuthContext =
  createContext<StaffAuthContextValue | null>(null);
const CACHE_KEY = "habi-staff:auth-session-v1";

function sessionValid(session: StaffSession): boolean {
  const expiry = Date.parse(session.expiresAt);
  return Number.isFinite(expiry) && expiry > Date.now();
}

function loadCached(): CachedStaffSession | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CachedStaffSession;
    if (!parsed.session || !sessionValid(parsed.session)) {
      window.localStorage.removeItem(CACHE_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function saveCached(value: CachedStaffSession | null): void {
  if (typeof window === "undefined") return;

  if (!value) {
    window.localStorage.removeItem(CACHE_KEY);
    return;
  }

  window.localStorage.setItem(CACHE_KEY, JSON.stringify(value));
}

function resolveOrganization(
  session: StaffSession,
  preferred?: string | null
): string | null {
  const candidate =
    preferred ||
    getSelectedStaffOrganizationId();

  if (
    candidate &&
    session.memberships.some(
      (membership) => membership.organizationId === candidate
    )
  ) {
    return candidate;
  }

  return session.memberships[0]?.organizationId ?? null;
}

function loginPath(pathname: string): string {
  const next =
    pathname.startsWith("/") && pathname !== "/login"
      ? "?next=" + encodeURIComponent(pathname)
      : "";
  return "/login" + next;
}

export function StaffAuthProvider({
  children
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] =
    useState<StaffAuthStatus>("loading");
  const [online, setOnline] = useState(true);
  const [session, setSession] =
    useState<StaffSession | null>(null);
  const [
    selectedOrganizationId,
    setSelectedOrganizationState
  ] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applySession = useCallback(
    (
      nextSession: StaffSession,
      mode: "authenticated" | "offline-authenticated",
      preferred?: string | null
    ) => {
      const organizationId = resolveOrganization(
        nextSession,
        preferred
      );

      setSession(nextSession);
      setSelectedOrganizationState(organizationId);
      setSelectedStaffOrganizationId(organizationId);
      saveCached({
        session: nextSession,
        selectedOrganizationId: organizationId
      });
      setStatus(mode);
      setError(null);
      return nextSession;
    },
    []
  );

  const clearSession = useCallback(() => {
    saveCached(null);
    setSession(null);
    setSelectedOrganizationState(null);
    setStatus("unauthenticated");
    setError(null);
  }, []);

  const useOfflineCache = useCallback(() => {
    const cached = loadCached();
    if (!cached) return null;

    return applySession(
      cached.session,
      "offline-authenticated",
      cached.selectedOrganizationId
    );
  }, [applySession]);

  const refresh = useCallback(async () => {
    const browserOnline =
      typeof navigator === "undefined" || navigator.onLine;
    setOnline(browserOnline);

    if (!browserOnline) {
      const cached = useOfflineCache();
      if (cached) return cached;
      clearSession();
      return null;
    }

    try {
      return applySession(
        await staffAuthApi.me(),
        "authenticated"
      );
    } catch (caught) {
      if (
        caught instanceof StaffAuthApiError &&
        caught.status === 401
      ) {
        clearSession();
        return null;
      }

      if (caught instanceof StaffNetworkError) {
        const cached = useOfflineCache();
        if (cached) return cached;
      }

      setStatus("error");
      setError(
        caught instanceof Error
          ? caught.message
          : "Không thể xác thực phiên Staff."
      );
      return null;
    }
  }, [applySession, clearSession, useOfflineCache]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleOffline = () => {
      setOnline(false);
      if (session && sessionValid(session)) {
        setStatus("offline-authenticated");
      }
    };

    const handleOnline = () => {
      setOnline(true);
      void refresh();
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [refresh, session]);

  useEffect(
    () =>
      subscribeToStaffAuthExpired(() => {
        clearSession();
      }),
    [clearSession]
  );

  useEffect(() => {
    if (
      status === "unauthenticated" &&
      pathname !== "/login"
    ) {
      router.replace(loginPath(pathname));
    }
  }, [pathname, router, status]);

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      if (
        typeof navigator !== "undefined" &&
        !navigator.onLine
      ) {
        throw new StaffNetworkError();
      }

      return applySession(
        await staffAuthApi.login(input),
        "authenticated"
      );
    },
    [applySession]
  );

  const logout = useCallback(async () => {
    if (
      typeof navigator !== "undefined" &&
      !navigator.onLine
    ) {
      throw new Error(
        "Cần có mạng để thu hồi phiên đăng nhập. Dữ liệu chưa sync vẫn được giữ trên máy."
      );
    }

    await staffAuthApi.logout();
    clearSession();
    setSelectedStaffOrganizationId(null);
    router.replace("/login");
    router.refresh();
  }, [clearSession, router]);

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

      setSelectedStaffOrganizationId(organizationId);
      setSelectedOrganizationState(organizationId);
      saveCached({
        session,
        selectedOrganizationId: organizationId
      });

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

  const value = useMemo<StaffAuthContextValue>(
    () => ({
      status,
      online,
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
      online,
      refresh,
      selectedMembership,
      selectedOrganizationId,
      session,
      status,
      switchOrganization
    ]
  );

  return (
    <StaffAuthContext.Provider value={value}>
      {children}
    </StaffAuthContext.Provider>
  );
}

export function useStaffAuth(): StaffAuthContextValue {
  const context = useContext(StaffAuthContext);
  if (!context) {
    throw new Error(
      "useStaffAuth must be used inside StaffAuthProvider."
    );
  }
  return context;
}
