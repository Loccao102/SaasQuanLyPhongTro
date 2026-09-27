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
};

export type AuthConfig = {
  registrationEnabled: boolean;
  passwordRegistrationEnabled: boolean;
  passwordRecoveryEnabled: boolean;
  googleEnabled: boolean;
  googleClientId: string | null;
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
    adminApiRequest<AdminSession>("/auth/verify-email", {
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
    adminApiRequest<AdminSession>("/auth/google", {
      method: "POST",
      body: input,
      organization: false,
      csrf: false
    }),


  login: (input: { email: string; password: string }) =>
    adminApiRequest<AdminSession>("/auth/login", {
      method: "POST",
      body: input,
      organization: false,
      csrf: false
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
