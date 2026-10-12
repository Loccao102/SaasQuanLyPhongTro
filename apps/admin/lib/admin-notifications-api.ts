export type NotificationTemplateCategory =
  | "RENT" | "PAYMENT" | "UTILITY" | "MAINTENANCE" | "GENERAL";

export type NotificationMessageTemplate = {
  id: string;
  name: string;
  category: NotificationTemplateCategory;
  body: string;
  source: "CUSTOM" | "PRESET";
  createdAt: string | null;
  updatedAt: string | null;
};

export type NotificationTemplateInput = Pick<
  NotificationMessageTemplate, "name" | "category" | "body"
>;

export type NotificationTemplateList = {
  fields: string[];
  templates: NotificationMessageTemplate[];
};

import { adminApiRequest } from "./admin-api-client";

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

export type ZaloMonitorState = {
  watching: boolean;
  frame: {
    stage: string;
    errorCode: string | null;
    image: string | null;
    capturedAt: string;
    attemptNumber: number;
  } | null;
  provider: { status: string; reason: string | null };
  diagnostics: {
    pageHost: string | null;
    inputHints: Array<Record<string, string>>;
  };
  job: {
    status: string;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
  };
};

export type EligibleNotificationResident = {
  residentId: string;
  fullName: string;
  phone: string;
  propertyId: string;
  propertyName: string;
  roomCode: string;
  leaseCode: string;
};

export type EligibleNotificationRecipients = {
  truncated: boolean;
  residents: EligibleNotificationResident[];
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


async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  return adminApiRequest<T>("/admin/notifications" + path, init);
}

export const adminNotificationsApi = {
  list: () => request<NotificationCampaignList>(""),
  eligibleResidents: () => request<EligibleNotificationRecipients>("/eligible-residents"),
  templates: () => request<NotificationTemplateList>("/templates"),
  createTemplate: (input: NotificationTemplateInput) =>
    request<NotificationMessageTemplate>("/templates", { method: "POST", body: input }),
  updateTemplate: (id: string, input: NotificationTemplateInput) =>
    request<NotificationMessageTemplate>("/templates/" + encodeURIComponent(id),
      { method: "PATCH", body: input }),
  deleteTemplate: (id: string) =>
    request<{ deleted: true }>("/templates/" + encodeURIComponent(id), { method: "DELETE" }),
  monitor: (campaignId: string, jobId: string) =>
    request<ZaloMonitorState>(
      "/" + encodeURIComponent(campaignId) + "/jobs/" + encodeURIComponent(jobId) + "/monitor"
    ),
  watchMonitor: (campaignId: string, jobId: string, enabled: boolean) =>
    request<{ watching: boolean }>(
      "/" + encodeURIComponent(campaignId) + "/jobs/" + encodeURIComponent(jobId) + "/monitor",
      { method: "POST", body: { enabled } }
    ),
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
