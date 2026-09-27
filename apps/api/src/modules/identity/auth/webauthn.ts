import type { AuthenticatorTransport } from "@simplewebauthn/server";

const ALLOWED_TRANSPORTS = new Set<AuthenticatorTransport>([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb"
]);

export function webAuthnConfig(): {
  rpName: string;
  rpID: string;
  origins: string[];
  challengeTtlMinutes: number;
} {
  const rpName = process.env.AUTH_WEBAUTHN_RP_NAME?.trim() || "Habi";
  const rpID = process.env.AUTH_WEBAUTHN_RP_ID?.trim() || "localhost";
  const configuredOrigins = process.env.AUTH_WEBAUTHN_ORIGINS
    ?.split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);

  const origins =
    configuredOrigins && configuredOrigins.length > 0
      ? configuredOrigins
      : process.env.NODE_ENV === "production"
        ? []
        : ["http://localhost:3000", "http://localhost:3003"];

  if (process.env.NODE_ENV === "production" && origins.length === 0) {
    throw new Error(
      "AUTH_WEBAUTHN_ORIGINS is required before passkeys can be used in production."
    );
  }

  const challengeTtlMinutes = Number(
    process.env.AUTH_WEBAUTHN_CHALLENGE_TTL_MINUTES ?? "5"
  );
  if (
    !Number.isInteger(challengeTtlMinutes) ||
    challengeTtlMinutes < 1 ||
    challengeTtlMinutes > 15
  ) {
    throw new Error(
      "AUTH_WEBAUTHN_CHALLENGE_TTL_MINUTES must be between 1 and 15."
    );
  }

  return {
    rpName,
    rpID,
    origins,
    challengeTtlMinutes
  };
}

export function uuidToWebAuthnUserId(userId: string): Uint8Array {
  const hex = userId.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw new Error("WebAuthn user ID must originate from a UUID.");
  }
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function normalizePasskeyName(value: string | undefined): string {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  if (!normalized) return "Passkey";
  return normalized.slice(0, 80);
}

export function normalizePasskeyTransports(
  values: readonly string[] | undefined
): AuthenticatorTransport[] {
  if (!values) return [];
  return values.filter(
    (value): value is AuthenticatorTransport =>
      ALLOWED_TRANSPORTS.has(value as AuthenticatorTransport)
  );
}
