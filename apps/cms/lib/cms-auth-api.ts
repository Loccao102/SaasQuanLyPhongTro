import type {
  PasskeyAuthenticationOptionsJSON,
  PasskeyRegistrationOptionsJSON
} from "@propops/ui/passkey";
export type CmsAuthSession = {
  user: {
    id: string;
    email: string;
    displayName: string;
    organizationId: string | null;
    accountType: "TENANT" | "PLATFORM";
  };
  memberships: Array<{
    organizationId: string;
    organizationName: string;
    role: string;
  }>;
  features: Record<string, boolean> | null;
  expiresAt: string;
};

export type CmsMfaRequired = {
  mfaRequired: true;
  challengeToken: string;
  expiresAt: string;
};

export type CmsMfaEnrollmentRequired = {
  mfaEnrollmentRequired: true;
  challengeToken: string;
  expiresAt: string;
  requiredByRole: string;
};

export type CmsAuthenticationResult =
  | CmsAuthSession
  | CmsMfaRequired
  | CmsMfaEnrollmentRequired;

export type CmsPasskeyItem = {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

export type CmsSessionItem = {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  deviceLabel: string | null;
};

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";

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

async function request<T>(
  path: string,
  init?: RequestInit,
  csrf = false
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (csrf) {
    const token = readCookie(csrfCookieName());
    if (token) headers.set("x-csrf-token", token);
  }

  const response = await fetch(apiBase + path, {
    ...init,
    headers,
    credentials: "include"
  });
  if (!response.ok) {
    let message = "Yêu cầu xác thực thất bại.";
    try {
      const payload = (await response.json()) as {
        message?: string | string[];
      };
      message = Array.isArray(payload.message)
        ? payload.message.join(" ")
        : payload.message ?? message;
    } catch {
      const text = await response.text().catch(() => "");
      if (text) message = text;
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const cmsAuthApi = {
  login: (input: { email: string; password: string }) =>
    request<CmsAuthenticationResult>("/auth/platform/login", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  setupRequiredMfa: (challengeToken: string) =>
    request<{
      secret: string;
      provisioningUri: string;
      requiredByRole: string;
    }>("/auth/mfa/enrollment/setup", {
      method: "POST",
      body: JSON.stringify({ challengeToken })
    }),

  confirmRequiredMfa: (input: { challengeToken: string; code: string }) =>
    request<CmsAuthSession & { recoveryCodes: string[] }>(
      "/auth/mfa/enrollment/confirm",
      {
        method: "POST",
        body: JSON.stringify(input)
      }
    ),

  passkeyMfaOptions: (challengeToken: string) =>
    request<PasskeyAuthenticationOptionsJSON>(
      "/auth/mfa/passkey/options",
      {
        method: "POST",
        body: JSON.stringify({ challengeToken })
      }
    ),

  verifyPasskeyMfa: (input: {
    challengeToken: string;
    response: unknown;
  }) =>
    request<CmsAuthSession>("/auth/mfa/passkey/verify", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  verifyMfa: (input: { challengeToken: string; code: string }) =>
    request<CmsAuthSession>("/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  me: () => request<CmsAuthSession>("/auth/me"),

  logout: () =>
    request<{ loggedOut: true }>(
      "/auth/logout",
      { method: "POST", body: JSON.stringify({}) },
      true
    ),

  stepUpStatus: () =>
    request<{
      recent: boolean;
      reauthenticatedAt: string;
      expiresAt: string;
    }>("/auth/step-up/status"),

  stepUpPassword: (password: string) =>
    request<{
      recent: boolean;
      reauthenticatedAt: string;
      expiresAt: string;
    }>(
      "/auth/step-up/password",
      { method: "POST", body: JSON.stringify({ password }) },
      true
    ),

  stepUpCode: (code: string) =>
    request<{
      recent: boolean;
      reauthenticatedAt: string;
      expiresAt: string;
    }>(
      "/auth/step-up/code",
      { method: "POST", body: JSON.stringify({ code }) },
      true
    ),

  stepUpPasskeyOptions: () =>
    request<PasskeyAuthenticationOptionsJSON>(
      "/auth/step-up/passkey/options",
      { method: "POST", body: JSON.stringify({}) },
      true
    ),

  stepUpPasskeyVerify: (response: unknown) =>
    request<{
      recent: boolean;
      reauthenticatedAt: string;
      expiresAt: string;
    }>(
      "/auth/step-up/passkey/verify",
      { method: "POST", body: JSON.stringify({ response }) },
      true
    ),

  passkeys: () =>
    request<{ passkeys: CmsPasskeyItem[] }>("/auth/passkeys"),

  passkeyRegistrationOptions: () =>
    request<PasskeyRegistrationOptionsJSON>(
      "/auth/passkeys/registration/options",
      {
        method: "POST",
        body: JSON.stringify({})
      },
      true
    ),

  verifyPasskeyRegistration: (input: {
    response: unknown;
    name?: string;
  }) =>
    request<CmsPasskeyItem>(
      "/auth/passkeys/registration/verify",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      true
    ),

  revokePasskey: (passkeyId: string) =>
    request<{ revoked: boolean }>(
      "/auth/passkeys/" + encodeURIComponent(passkeyId) + "/revoke",
      {
        method: "POST",
        body: JSON.stringify({})
      },
      true
    ),

  mfaStatus: () =>
    request<{
      enabled: boolean;
      required: boolean;
      requiredByRole: string | null;
    }>("/auth/mfa"),

  setupMfa: () =>
    request<{ secret: string; provisioningUri: string }>(
      "/auth/mfa/setup",
      { method: "POST", body: JSON.stringify({}) },
      true
    ),

  confirmMfa: (code: string) =>
    request<{ recoveryCodes: string[] }>(
      "/auth/mfa/confirm",
      { method: "POST", body: JSON.stringify({ code }) },
      true
    ),

  disableMfa: (code: string) =>
    request<{ disabled: true }>(
      "/auth/mfa/disable",
      { method: "POST", body: JSON.stringify({ code }) },
      true
    ),

  sessions: () =>
    request<{ sessions: CmsSessionItem[] }>("/auth/sessions"),

  revokeOtherSessions: () =>
    request<{ revokedSessions: number }>(
      "/auth/sessions/revoke-others",
      { method: "POST", body: JSON.stringify({}) },
      true
    )
};
