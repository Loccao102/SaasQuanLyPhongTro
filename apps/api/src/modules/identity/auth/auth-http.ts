import { ForbiddenException } from "@nestjs/common";

export interface HeaderCarrier {
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
}

export function allowedBrowserOrigins(): string[] {
  const configured = process.env.CORS_ORIGINS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured && configured.length > 0) {
    return configured;
  }

  return [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003"
  ];
}

export function assertTrustedBrowserOrigin(request: HeaderCarrier): void {
  const value = request.headers?.origin;
  const origin = Array.isArray(value) ? value[0] : value;

  if (origin && !allowedBrowserOrigins().includes(origin)) {
    throw new ForbiddenException("Request origin is not allowed.");
  }
}

export function authCookieNames() {
  return {
    session:
      process.env.AUTH_SESSION_COOKIE_NAME?.trim() ||
      (process.env.NODE_ENV === "production"
        ? "__Host-propops_session"
        : "propops_session"),
    csrf:
      process.env.AUTH_CSRF_COOKIE_NAME?.trim() ||
      (process.env.NODE_ENV === "production"
        ? "__Host-propops_csrf"
        : "propops_csrf")
  };
}

export function authCookieSecure(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.AUTH_COOKIE_SECURE === "true"
  );
}

export function parseCookies(
  header: string | string[] | undefined
): Record<string, string> {
  const raw = Array.isArray(header) ? header.join(";") : header;
  if (!raw) return {};

  const cookies: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

export function readSessionToken(request: HeaderCarrier): string | undefined {
  const names = authCookieNames();
  return parseCookies(request.headers?.cookie)[names.session];
}

export function readCsrfHeader(request: HeaderCarrier): string | undefined {
  const value = request.headers?.["x-csrf-token"];
  return Array.isArray(value) ? value[0] : value;
}

export function isUnsafeHttpMethod(method: string | undefined): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(
    (method ?? "GET").toUpperCase()
  );
}

export function serializeAuthCookie(
  name: string,
  value: string,
  input: { httpOnly: boolean; maxAgeSeconds: number }
): string {
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(input.maxAgeSeconds))}`,
    "SameSite=Lax"
  ];

  if (input.httpOnly) attributes.push("HttpOnly");
  if (authCookieSecure()) attributes.push("Secure");
  return attributes.join("; ");
}
