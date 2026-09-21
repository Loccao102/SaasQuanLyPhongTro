export interface NotificationProviderRequest {
  jobId: string;
  organizationId: string;
  channel: string;
  recipientKey: string;
  recipientDisplayName: string | null;
  messageBody: string;
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

  send(
    request: NotificationProviderRequest
  ): Promise<NotificationProviderResult>;
}
