import {
  staffApiFetch,
  StaffNetworkError
} from "./staff-api-client";

export type StaffMembership = {
  organizationId: string;
  organizationName: string;
  role: string;
};

export type StaffSession = {
  user: {
    id: string;
    email: string;
    displayName: string;
    organizationId: string | null;
    accountType: "TENANT" | "PLATFORM";
  };
  memberships: StaffMembership[];
  features: Record<string, boolean> | null;
  expiresAt: string;
};

export class StaffAuthApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "StaffAuthApiError";
  }
}

async function message(response: Response): Promise<string> {
  const raw = await response.text();

  if (!raw) {
    return "Yêu cầu xác thực thất bại.";
  }

  try {
    const payload = JSON.parse(raw) as {
      message?: string | string[];
    };

    if (Array.isArray(payload.message)) {
      return payload.message.join(" ");
    }

    if (typeof payload.message === "string") {
      return payload.message;
    }
  } catch {
    // Keep raw response.
  }

  return raw;
}

async function json<T>(
  path: string,
  options: Parameters<typeof staffApiFetch>[1]
): Promise<T> {
  const response = await staffApiFetch(path, options);

  if (!response.ok) {
    throw new StaffAuthApiError(
      response.status,
      await message(response)
    );
  }

  return response.json() as Promise<T>;
}

export type StaffMfaChallenge = {
  mfaRequired: true;
  challengeToken: string;
  expiresAt: string;
};

export type StaffMfaEnrollment = {
  mfaEnrollmentRequired: true;
  challengeToken: string;
  expiresAt: string;
  requiredByRole: string;
};

export type StaffAuthenticationResult =
  | StaffSession
  | StaffMfaChallenge
  | StaffMfaEnrollment;

export type StaffAuthConfig = {
  registrationEnabled: boolean;
  googleEnabled: boolean;
  googleClientId: string | null;
};

export const staffAuthApi = {
  config: () =>
    json<StaffAuthConfig>("/auth/config", {
      organization: false,
      csrf: false
    }),

  googleChallenge: () =>
    json<{ nonce: string }>("/auth/google/challenge", {
      method: "POST",
      organization: false,
      csrf: false
    }),

  google: (input: { credential: string; mode: "LOGIN" }) =>
    json<StaffAuthenticationResult>("/auth/google", {
      method: "POST",
      body: input,
      organization: false,
      csrf: false
    }),


  me: () =>
    json<StaffSession>("/auth/me", {
      organization: false,
      csrf: false
    }),

  login: (input: { email: string; password: string }) =>
    json<StaffAuthenticationResult>("/auth/login", {
      method: "POST",
      body: input,
      organization: false,
      csrf: false
    }),

  setupRequiredMfa: (challengeToken: string) =>
    json<{ secret: string; provisioningUri: string; requiredByRole: string }>(
      "/auth/mfa/enrollment/setup", {
        method: "POST",
        body: { challengeToken },
        organization: false,
        csrf: false
      }
    ),

  confirmRequiredMfa: (input: { challengeToken: string; code: string }) =>
    json<StaffSession & { recoveryCodes: string[] }>(
      "/auth/mfa/enrollment/confirm", {
        method: "POST",
        body: input,
        organization: false,
        csrf: false
      }
    ),

  verifyMfa: (input: { challengeToken: string; code: string }) =>
    json<StaffSession>("/auth/mfa/verify", {
      method: "POST",
      body: input,
      organization: false,
      csrf: false
    }),

  logout: () =>
    json<{ loggedOut: boolean }>("/auth/logout", {
      method: "POST",
      organization: false
    })
};

export { StaffNetworkError };
