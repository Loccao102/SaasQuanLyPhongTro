import { adminApiRequest } from "./admin-api-client";

export type AdminMembership = {
  organizationId: string;
  organizationName: string;
  role: string;
};

export type AdminSession = {
  user: {
    id: string;
    email: string;
    displayName: string;
  };
  memberships: AdminMembership[];
  expiresAt: string;
};

export const adminAuthApi = {
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
    })
};
