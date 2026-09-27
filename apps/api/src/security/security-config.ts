import { allowedBrowserOrigins } from "../modules/identity/auth/auth-http.js";

const PLACEHOLDER_VALUES = new Set([
  "replace-with-a-long-random-worker-token",
  "replace-with-a-separate-long-random-metrics-token"
]);

function requiredSecret(name: string, minLength = 32): void {
  const value = process.env[name]?.trim() ?? "";
  if (
    value.length < minLength ||
    PLACEHOLDER_VALUES.has(value)
  ) {
    throw new Error(
      name + " must be configured with at least " + String(minLength) +
        " non-placeholder characters in production."
    );
  }
}

function assertHttpsOrigin(origin: string): void {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("Invalid CORS origin: " + origin);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      "Production CORS origin must use HTTPS: " + origin
    );
  }

  if (parsed.username || parsed.password || parsed.pathname !== "/" ||
      parsed.search || parsed.hash) {
    throw new Error(
      "CORS_ORIGINS entries must be bare origins without credentials, path, query or fragment."
    );
  }
}

export function assertSecurityConfiguration(): void {
  const origins = allowedBrowserOrigins();

  if (origins.some((origin) => origin === "*" || origin.includes("*"))) {
    throw new Error("Wildcard CORS origins are forbidden when credentials are enabled.");
  }

  if (process.env.NODE_ENV !== "production") {
    return;
  }

  for (const origin of origins) {
    assertHttpsOrigin(origin);
  }

  requiredSecret("AUTH_SECURITY_HMAC_KEY");
  requiredSecret("INTERNAL_WORKER_TOKEN");
  requiredSecret("OBSERVABILITY_METRICS_TOKEN");

  for (const name of [
    "AUTH_SESSION_COOKIE_NAME",
    "AUTH_CSRF_COOKIE_NAME",
    "AUTH_GOOGLE_NONCE_COOKIE_NAME"
  ]) {
    const value = process.env[name]?.trim();
    if (value && !value.startsWith("__Host-")) {
      throw new Error(
        name + " must use the __Host- prefix in production or be left empty."
      );
    }
  }

  for (const name of [
    "ADMIN_DEV_USER_ID",
    "ADMIN_DEV_ORGANIZATION_ID",
    "CMS_DEV_USER_ID",
    "NEXT_PUBLIC_ADMIN_ORGANIZATION_ID",
    "NEXT_PUBLIC_STAFF_ORGANIZATION_ID"
  ]) {
    if (process.env[name]?.trim()) {
      throw new Error(name + " must be empty in production.");
    }
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (
    googleClientId &&
    !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(googleClientId)
  ) {
    throw new Error("GOOGLE_CLIENT_ID does not look like a Google Web client ID.");
  }
}

export function configuredTrustProxyHops(): number {
  const raw = process.env.TRUST_PROXY_HOPS?.trim();
  if (!raw) return 0;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 10) {
    throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 10.");
  }
  return value;
}
