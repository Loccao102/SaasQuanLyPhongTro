export interface ClaimedNotificationJob {
  id: string;
  organizationId: string;
  campaignId: string;
  recipientKey: string;
  recipientDisplayName: string | null;
  provider: string;
  channel: string;
  messageBody: string;
  attemptNumber: number;
  maxAttempts: number;
}

export type NotificationProviderResult =
  | {
      kind: "SENT_CONFIRMED";
      recipientVerified: boolean;
      sendVerified: boolean;
      providerReference?: string | null;
      evidence?: Readonly<Record<string, unknown>>;
    }
  | {
      kind: "TRANSIENT_FAILURE";
      errorCode: string;
      errorMessage: string;
      evidence?: Readonly<Record<string, unknown>>;
    }
  | {
      kind: "PERMANENT_FAILURE";
      errorCode: string;
      errorMessage: string;
      evidence?: Readonly<Record<string, unknown>>;
    }
  | {
      kind: "MANUAL_REVIEW" | "UNKNOWN";
      errorCode?: string | null;
      errorMessage?: string | null;
      evidence?: Readonly<Record<string, unknown>>;
    };

export interface NotificationProvider {
  readonly name: string;

  send(job: ClaimedNotificationJob): Promise<NotificationProviderResult>;
}
