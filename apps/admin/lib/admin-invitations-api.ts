import { adminApiRequest } from "./admin-api-client";

export type InvitationPreview = {
  organizationName: string;
  email: string;
  displayName: string;
  role: string;
  expiresAt: string;
  requiresPassword: boolean;
};

export type InvitationAcceptance = {
  organizationId: string;
  organizationName: string;
  membershipId: string;
  role: string;
  status: "ACTIVE";
  email: string;
};

export const adminInvitationApi = {
  inspect: (token: string) =>
    adminApiRequest<InvitationPreview>(
      "/auth/invitations/" + encodeURIComponent(token),
      { organization: false, csrf: false }
    ),
  accept: (token: string, password?: string) =>
    adminApiRequest<InvitationAcceptance>(
      "/auth/invitations/" +
        encodeURIComponent(token) +
        "/accept",
      {
        method: "POST",
        body: password ? { password } : {},
        organization: false,
        csrf: false
      }
    )
};
