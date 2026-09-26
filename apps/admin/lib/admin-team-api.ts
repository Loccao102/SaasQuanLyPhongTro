import { adminApiRequest } from "./admin-api-client";

export type TeamRole =
  | "OWNER"
  | "ADMIN"
  | "MANAGER"
  | "STAFF"
  | "ACCOUNTANT"
  | "VIEWER";

export type TeamScope =
  | { type: "ORGANIZATION"; label: string }
  | { type: "OPERATIONAL_GROUP"; operationalGroupId: string; label: string }
  | { type: "PROPERTY"; propertyId: string; label: string };

export type TeamOverview = {
  organization: { id: string; name: string };
  currentMembershipId: string;
  currentRole: TeamRole;
  members: Array<{
    id: string;
    userId: string;
    email: string;
    displayName: string;
    role: TeamRole;
    status: "INVITED" | "ACTIVE" | "SUSPENDED";
    scopes: TeamScope[];
    invitation: {
      state: "PENDING" | "EXPIRED" | "REVOKED" | "ACCEPTED";
      expiresAt: string;
      createdAt: string;
    } | null;
    createdAt: string;
    updatedAt: string;
  }>;
  groups: Array<{
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    propertyIds: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  properties: Array<{
    id: string;
    code: string;
    name: string;
    isActive: boolean;
  }>;
};

export type InvitationMutationResult = {
  membershipId: string;
  status: "INVITED";
  invitation: {
    token: string;
    expiresAt: string;
  };
};

export type TeamScopeInput =
  | { type: "ORGANIZATION" }
  | { type: "OPERATIONAL_GROUP"; operationalGroupId: string }
  | { type: "PROPERTY"; propertyId: string };


async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  return adminApiRequest<T>("/admin/team" + path, init);
}

export const adminTeamApi = {
  overview: () => request<TeamOverview>(""),
  invite: (input: {
    email: string;
    displayName: string;
    role: TeamRole;
    scopes: TeamScopeInput[];
  }) =>
    request<InvitationMutationResult>("/members", {
      method: "POST",
      body: input
    }),
  resendInvitation: (membershipId: string) =>
    request<InvitationMutationResult>(
      "/members/" +
        encodeURIComponent(membershipId) +
        "/invitation/resend",
      { method: "POST" }
    ),
  revokeInvitation: (membershipId: string) =>
    request(
      "/members/" +
        encodeURIComponent(membershipId) +
        "/invitation/revoke",
      { method: "POST" }
    ),
  updateMember: (
    membershipId: string,
    input: { role: TeamRole; scopes: TeamScopeInput[] }
  ) =>
    request("/members/" + encodeURIComponent(membershipId), {
      method: "PATCH",
      body: input
    }),
  activate: (membershipId: string) =>
    request("/members/" + encodeURIComponent(membershipId) + "/activate", {
      method: "POST"
    }),
  suspend: (membershipId: string) =>
    request("/members/" + encodeURIComponent(membershipId) + "/suspend", {
      method: "POST"
    }),
  createGroup: (input: {
    code: string;
    name: string;
    propertyIds: string[];
  }) => request("/groups", { method: "POST", body: input }),
  updateGroup: (
    groupId: string,
    input: { code: string; name: string; propertyIds: string[] }
  ) =>
    request("/groups/" + encodeURIComponent(groupId), {
      method: "PATCH",
      body: input
    }),
  deactivateGroup: (groupId: string) =>
    request("/groups/" + encodeURIComponent(groupId) + "/deactivate", {
      method: "POST"
    })
};
