const apiBase =
  process.env.NEXT_PUBLIC_STAFF_API_BASE_URL?.trim() || "/api";
const fallbackOrganizationId =
  process.env.NEXT_PUBLIC_STAFF_ORGANIZATION_ID?.trim() ||
  process.env.NEXT_PUBLIC_ADMIN_ORGANIZATION_ID?.trim() ||
  "";
const organizationStorageKey = "habi-staff:selected-organization-id";
const authExpiredEvent = "habi-staff:auth-expired";

export class StaffNetworkError extends Error {
  constructor() {
    super("Không thể kết nối máy chủ.");
    this.name = "StaffNetworkError";
  }
}

export function getSelectedStaffOrganizationId(): string {
  if (typeof window === "undefined") {
    return fallbackOrganizationId;
  }

  return (
    window.localStorage.getItem(organizationStorageKey)?.trim() ||
    fallbackOrganizationId
  );
}

export function setSelectedStaffOrganizationId(
  organizationId: string | null
): void {
  if (typeof window === "undefined") return;

  if (!organizationId) {
    window.localStorage.removeItem(organizationStorageKey);
    return;
  }

  window.localStorage.setItem(organizationStorageKey, organizationId);
}

function csrfCookieName(): string {
  return (
    process.env.NEXT_PUBLIC_AUTH_CSRF_COOKIE_NAME?.trim() ||
    (process.env.NODE_ENV === "production"
      ? "__Host-propops_csrf"
      : "propops_csrf")
  );
}

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;

  for (const part of document.cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }

  return undefined;
}

function isUnsafeMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

export type StaffApiFetchOptions = {
  method?: string;
  body?: unknown;
  headers?: HeadersInit;
  organization?: boolean;
  csrf?: boolean;
};

export async function staffApiFetch(
  path: string,
  options: StaffApiFetchOptions = {}
): Promise<Response> {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);

  if (options.organization !== false) {
    const organizationId = getSelectedStaffOrganizationId();
    if (organizationId) {
      headers.set("x-organization-id", organizationId);
    }
  }

  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  if (options.csrf !== false && isUnsafeMethod(method)) {
    const csrf = readCookie(csrfCookieName());
    if (csrf) {
      headers.set("x-csrf-token", csrf);
    }
  }

  let response: Response;
  try {
    response = await fetch(apiBase + path, {
      credentials: "include",
      method,
      headers,
      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(options.body)
    });
  } catch {
    throw new StaffNetworkError();
  }

  if (
    response.status === 401 &&
    typeof window !== "undefined"
  ) {
    window.dispatchEvent(new Event(authExpiredEvent));
  }

  return response;
}

export function subscribeToStaffAuthExpired(
  listener: () => void
): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener(authExpiredEvent, listener);
  return () =>
    window.removeEventListener(authExpiredEvent, listener);
}
