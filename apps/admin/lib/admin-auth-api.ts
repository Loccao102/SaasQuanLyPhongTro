import type {
  PasskeyAuthenticationOptionsJSON,
  PasskeyRegistrationOptionsJSON
} from "@propops/ui/passkey";
import { adminApiRequest } from "./admin-api-client";

export type AdminMembership = {
  organizationId: string;
  organizationName: string;
  role: string;
};

export type AdminTenantFeatureKey =
  | "properties"
  | "leases"
  | "metering"
  | "pricing"
  | "billing"
  | "payments"
  | "credit_balance"
  | "finances"
  | "maintenance"
  | "notifications"
  | "reports"
  | "team_management"
  | "advanced_reports"
  | "audit_log";

export type MfaRequiredResult = {
  mfaRequired: true;
  challengeToken: string;
  expiresAt: string;
};

export type MfaEnrollmentRequiredResult = {
  mfaEnrollmentRequired: true;
  challengeToken: string;
  expiresAt: string;
  requiredByRole: string;
};

export type AdminAuthenticationResult =
  | AdminSession
  | MfaRequiredResult
  | MfaEnrollmentRequiredResult;

export type AdminSession = {
  user: {
    id: string;
    email: string;
    displayName: string;
    organizationId: string | null;
    accountType: "TENANT" | "PLATFORM";
  };
  memberships: AdminMembership[];
  features: Record<AdminTenantFeatureKey, boolean> | null;
  expiresAt: string;
  mfaEnabled?: boolean;
};

export type PendingRegistration = {
  pendingVerification: true;
  email: string;
};

export type AdminAuthSessionItem = {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  deviceLabel: string | null;
};

export type SecurityAlertItem = {
  id: string;
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  summary: string;
  metadata: Record<string, unknown>;
  deliveryStatus: string;
  createdAt: string;
};

export type PasskeyItem = {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

export type AuthConfig = {
  registrationEnabled: boolean;
  passwordRegistrationEnabled: boolean;
  passwordRecoveryEnabled: boolean;
  googleEnabled: boolean;
  googleClientId: string | null;
  passkeyPasswordlessEnabled: boolean;
};

export const adminAuthApi = {
  config: () =>
    adminApiRequest<AuthConfig>("/auth/config", {
      organization: false,
      csrf: false
    }),

  googleChallenge: () =>
    adminApiRequest<{ nonce: string }>("/auth/google/challenge", {
      method: "POST",
      organization: false,
      csrf: false
    }),

  register: (input: {
    email: string;
    password: string;
    displayName: string;
    organizationName: string;
  }) =>
    adminApiRequest<PendingRegistration>("/auth/register", {
      method: "POST",
      body: input,
      organization: false,
      csrf: false
    }),

  verifyEmail: (token: string) =>
    adminApiRequest<AdminAuthenticationResult>("/auth/verify-email", {
      method: "POST",
      body: { token },
      organization: false,
      csrf: false
    }),

  forgotPassword: (email: string) =>
    adminApiRequest<{ accepted: true; message: string }>("/auth/forgot-password", {
      method: "POST",
      body: { email },
      organization: false,
      csrf: false
    }),

  resetPassword: (input: { token: string; newPassword: string }) =>
    adminApiRequest<{ success: true; message: string }>("/auth/reset-password", {
      method: "POST",
      body: input,
      organization: false,
      csrf: false
    }),

  google: (input: {
    credential: string;
    mode: "LOGIN" | "REGISTER";
    organizationName?: string;
  }) =>
    adminApiRequest<AdminAuthenticationResult>("/auth/google", {
      method: "POST",
      body: input,
      organization: false,
      csrf: false
    }),


  passkeyLoginOptions: () =>
    adminApiRequest<{
      requestId: string;
      options: PasskeyAuthenticationOptionsJSON;
    }>("/auth/passkey/login/options", {
      method: "POST",
      body: {},
      organization: false,
      csrf: false
    }),

  verifyPasskeyLogin: (input: {
    requestId: string;
    response: unknown;
  }) =>
    adminApiRequest<AdminSession>("/auth/passkey/login/verify", {
      method: "POST",
      body: input,
      organization: false,
      csrf: false
    }),

  login: (input: { email: string; password: string }) =>
    adminApiRequest<AdminAuthenticationResult>("/auth/login", {
      method: "POST",
      body: input,
      organization: false,
      csrf: false
    }),

  setupRequiredMfa: (challengeToken: string) =>
    adminApiRequest<{
      secret: string;
      provisioningUri: string;
      requiredByRole: string;
    }>("/auth/mfa/enrollment/setup", {
      method: "POST",
      body: { challengeToken },
      organization: false,
      csrf: false
    }),

  confirmRequiredMfa: (input: {
    challengeToken: string;
    code: string;
  }) =>
    adminApiRequest<AdminSession & { recoveryCodes: string[] }>(
      "/auth/mfa/enrollment/confirm",
      {
        method: "POST",
        body: input,
        organization: false,
        csrf: false
      }
    ),

  passkeyMfaOptions: (challengeToken: string) =>
    adminApiRequest<PasskeyAuthenticationOptionsJSON>(
      "/auth/mfa/passkey/options",
      {
        method: "POST",
        body: { challengeToken },
        organization: false,
        csrf: false
      }
    ),

  verifyPasskeyMfa: (input: {
    challengeToken: string;
    response: unknown;
  }) =>
    adminApiRequest<AdminSession>("/auth/mfa/passkey/verify", {
      method: "POST",
      body: input,
      organization: false,
      csrf: false
    }),

  verifyMfa: (input: { challengeToken: string; code: string }) =>
    adminApiRequest<AdminSession>("/auth/mfa/verify", {
      method: "POST",
      body: input,
      organization: false,
      csrf: false
    }),

  securityAlerts: () =>
    adminApiRequest<{ alerts: SecurityAlertItem[] }>(
      "/auth/security/alerts",
      {
        organization: false,
        csrf: false
      }
    ),

  stepUpStatus: () =>
    adminApiRequest<{
      recent: boolean;
      reauthenticatedAt: string;
      expiresAt: string;
    }>("/auth/step-up/status", {
      organization: false,
      csrf: false
    }),

  stepUpPassword: (password: string) =>
    adminApiRequest<{
      recent: boolean;
      reauthenticatedAt: string;
      expiresAt: string;
    }>("/auth/step-up/password", {
      method: "POST",
      body: { password },
      organization: false
    }),

  stepUpCode: (code: string) =>
    adminApiRequest<{
      recent: boolean;
      reauthenticatedAt: string;
      expiresAt: string;
    }>("/auth/step-up/code", {
      method: "POST",
      body: { code },
      organization: false
    }),

  stepUpPasskeyOptions: () =>
    adminApiRequest<PasskeyAuthenticationOptionsJSON>(
      "/auth/step-up/passkey/options",
      {
        method: "POST",
        body: {},
        organization: false
      }
    ),

  stepUpPasskeyVerify: (response: unknown) =>
    adminApiRequest<{
      recent: boolean;
      reauthenticatedAt: string;
      expiresAt: string;
    }>("/auth/step-up/passkey/verify", {
      method: "POST",
      body: { response },
      organization: false
    }),

  passkeys: () =>
    adminApiRequest<{ passkeys: PasskeyItem[] }>("/auth/passkeys", {
      organization: false,
      csrf: false
    }),

  passkeyRegistrationOptions: () =>
    adminApiRequest<PasskeyRegistrationOptionsJSON>(
      "/auth/passkeys/registration/options",
      {
        method: "POST",
        body: {},
        organization: false
      }
    ),

  verifyPasskeyRegistration: (input: {
    response: unknown;
    name?: string;
  }) =>
    adminApiRequest<PasskeyItem>("/auth/passkeys/registration/verify", {
      method: "POST",
      body: input,
      organization: false
    }),

  revokePasskey: (passkeyId: string) =>
    adminApiRequest<{ revoked: boolean }>(
      "/auth/passkeys/" + encodeURIComponent(passkeyId) + "/revoke",
      {
        method: "POST",
        body: {},
        organization: false
      }
    ),

  mfaStatus: () =>
    adminApiRequest<{
      enabled: boolean;
      required: boolean;
      requiredByRole: string | null;
    }>("/auth/mfa", {
      organization: false
    }),

  setupMfa: () =>
    adminApiRequest<{ secret: string; provisioningUri: string }>("/auth/mfa/setup", {
      method: "POST",
      body: {},
      organization: false
    }),

  confirmMfa: (code: string) =>
    adminApiRequest<{ recoveryCodes: string[] }>("/auth/mfa/confirm", {
      method: "POST",
      body: { code },
      organization: false
    }),

  disableMfa: (code: string) =>
    adminApiRequest<{ disabled: true }>("/auth/mfa/disable", {
      method: "POST",
      body: { code },
      organization: false
    }),

  me: () =>
    adminApiRequest<AdminSession>("/auth/me", {
      organization: false,
      csrf: false
    }),

  sessions: () =>
    adminApiRequest<{ sessions: AdminAuthSessionItem[] }>("/auth/sessions", {
      organization: false
    }),

  revokeSession: (sessionId: string) =>
    adminApiRequest<{ revoked: boolean; currentSessionRevoked: boolean }>(
      "/auth/sessions/" + encodeURIComponent(sessionId) + "/revoke",
      {
        method: "POST",
        organization: false
      }
    ),

  revokeOtherSessions: () =>
    adminApiRequest<{ revokedSessions: number }>("/auth/sessions/revoke-others", {
      method: "POST",
      organization: false
    }),

  logout: () =>
    adminApiRequest<{ loggedOut: boolean }>("/auth/logout", {
      method: "POST",
      organization: false
    }),

  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    adminApiRequest<{ success: boolean; message: string }>("/auth/change-password", {
      method: "POST",
      body: input,
      organization: false
    })
};
