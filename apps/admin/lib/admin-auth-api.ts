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

export type AuthConfig = {
  registrationEnabled: boolean;
  googleEnabled: boolean;
  googleClientId: string | null;
};

export const adminAuthApi = {
  config: () =>
    adminApiRequest<AuthConfig>("/auth/config", {
      organization: false,
      csrf: false
    }),

  register: (input: {
    email: string;
    password: string;
    displayName: string;
    organizationName: string;
  }) =>
    adminApiRequest<AdminSession>("/auth/register", {
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
