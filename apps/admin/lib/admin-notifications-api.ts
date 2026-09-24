export type NotificationCampaignSummary = {
  id: string;
  channel: string;
  provider: string;
  messageBody: string;
  status: string;
  totalRecipients: number;
  queued: number;
  running: number;
  retryWaiting: number;
  sent: number;
  failed: number;
  manualReview: number;
  cancelled: number;
  createdAt: string;
  updatedAt: string;
};

export type NotificationCampaignList = {
  organization: { id: string; name: string };
  campaigns: NotificationCampaignSummary[];
};

export type NotificationCampaignDetail = {
  campaign: NotificationCampaignSummary;
  permissions: { send: boolean };
  jobs: Array<{
    id: string;
    recipientKey: string;
    recipientDisplayName: string | null;
    status: string;
    attemptCount: number;
    maxAttempts: number;
    verificationState: string;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    updatedAt: string;
  }>;
};

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";
const configuredOrganizationId =
  process.env.NEXT_PUBLIC_ADMIN_ORGANIZATION_ID?.trim() ?? "";

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const headers = new Headers();
  if (configuredOrganizationId) {
    headers.set("x-organization-id", configuredOrganizationId);
  }
  if (init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(apiBase + "/admin/notifications" + path, {
    credentials: "include",
    method: init?.method ?? "GET",
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body)
  });
  if (!response.ok) {
    throw new Error((await response.text()) || "Notification request failed.");
  }
  return response.json() as Promise<T>;
}

export const adminNotificationsApi = {
  list: () => request<NotificationCampaignList>(""),
  detail: (campaignId: string) =>
    request<NotificationCampaignDetail>("/" + encodeURIComponent(campaignId)),
  create: (input: {
    idempotencyKey: string;
    messageBody: string;
    recipients: Array<{
      recipientKey: string;
      recipientDisplayName?: string | null;
    }>;
  }) => request<NotificationCampaignSummary>("", { method: "POST", body: input }),
  pause: (campaignId: string, reason: string) =>
    request<NotificationCampaignSummary>(
      "/" + encodeURIComponent(campaignId) + "/pause",
      { method: "POST", body: { reason } }
    ),
  resume: (campaignId: string) =>
    request<NotificationCampaignSummary>(
      "/" + encodeURIComponent(campaignId) + "/resume",
      { method: "POST" }
    ),
  cancel: (campaignId: string, reason: string) =>
    request<NotificationCampaignSummary>(
      "/" + encodeURIComponent(campaignId) + "/cancel",
      { method: "POST", body: { reason } }
    ),
  retry: (campaignId: string) =>
    request<NotificationCampaignSummary>(
      "/" + encodeURIComponent(campaignId) + "/retry",
      { method: "POST" }
    )
};
