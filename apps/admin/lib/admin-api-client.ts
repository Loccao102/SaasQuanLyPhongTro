const apiBase =
  process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL?.trim() || "/api";
const fallbackOrganizationId =
  process.env.NEXT_PUBLIC_ADMIN_ORGANIZATION_ID?.trim() || "";
const organizationStorageKey = "habi:selected-organization-id";
const authExpiredEvent = "habi:auth-expired";

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export class AdminOrganizationRequiredError extends Error {
  constructor() {
    super("Chưa chọn workspace để thực hiện yêu cầu.");
    this.name = "AdminOrganizationRequiredError";
  }
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function getSelectedOrganizationId(): string {
  return (
    browserStorage()?.getItem(organizationStorageKey)?.trim() ||
    fallbackOrganizationId
  );
}

export function setSelectedOrganizationId(
  organizationId: string | null
): void {
  const storage = browserStorage();
  if (!storage) return;

  if (!organizationId) {
    storage.removeItem(organizationStorageKey);
    return;
  }

  storage.setItem(organizationStorageKey, organizationId);
}

function csrfCookieName(): string {
  return (
    process.env.NEXT_PUBLIC_AUTH_CSRF_COOKIE_NAME?.trim() ||
    (process.env.NODE_ENV === "production"
      ? "__Host-propops_csrf"
      : "propops_csrf")
  );
}

function readBrowserCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;

  for (const part of document.cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;

    const cookieName = part.slice(0, separator).trim();
    if (cookieName === name) {
      return part.slice(separator + 1).trim();
    }
  }

  return undefined;
}

function isUnsafeMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

async function responseErrorMessage(response: Response): Promise<string> {
  const fallback =
    "Yêu cầu thất bại với mã " + String(response.status) + ".";

  try {
    const payload = (await response.json()) as {
      message?: string | string[];
      error?: string;
    };

    if (Array.isArray(payload.message)) {
      return payload.message.join(" ");
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // Fall through to text fallback for non-JSON responses.
  }

  try {
    const text = await response.text();
    return text.trim() || fallback;
  } catch {
    return fallback;
  }
}

export type AdminApiRequestOptions = {
  method?: string;
  body?: unknown;
  headers?: HeadersInit;
  organization?: boolean;
  csrf?: boolean;
};

export async function adminApiRequest<T>(
  path: string,
  options: AdminApiRequestOptions = {}
): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);

  if (options.organization !== false) {
    const organizationId = getSelectedOrganizationId();

    if (!organizationId) {
      throw new AdminOrganizationRequiredError();
    }

    headers.set("x-organization-id", organizationId);
  }

  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  if (
    options.csrf !== false &&
    isUnsafeMethod(method)
  ) {
    const csrf = readBrowserCookie(csrfCookieName());
    if (csrf) {
      headers.set("x-csrf-token", csrf);
    }
  }

  const response = await fetch(apiBase + path, {
    credentials: "include",
    method,
    headers,
    body:
      options.body === undefined
        ? undefined
        : JSON.stringify(options.body)
  });

  if (!response.ok) {
    const message = await responseErrorMessage(response);

    if (
      response.status === 401 &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(new Event(authExpiredEvent));
    }

    throw new AdminApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function subscribeToAuthExpired(
  listener: () => void
): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener(authExpiredEvent, listener);
  return () => window.removeEventListener(authExpiredEvent, listener);
}
