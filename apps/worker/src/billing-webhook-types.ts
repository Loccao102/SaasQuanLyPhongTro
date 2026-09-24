export type ClaimedBillingWebhookEvent = {
  id: string;
  provider: string;
  providerEventId: string;
  signatureStatus: "VERIFIED" | "INVALID" | "NOT_CONFIGURED";
  processingStatus:
    | "RECEIVED"
    | "PROCESSING"
    | "PROCESSED"
    | "REVIEW_REQUIRED"
    | "IGNORED"
    | "FAILED";
  rawBodySha256: string;
  headers: unknown;
  receivedAt: string;
  processingStartedAt: string | null;
  processingAttempts: number;
  processedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  paymentId: string | null;
  rawBody: string;
};

export type NormalizedBillingWebhookPayment = {
  providerTransactionId: string;
  amountVnd: number;
  occurredAt: string;
  paymentReference?: string | null;
  destinationAccountNo?: string | null;
  payerName?: string | null;
  note?: string | null;
  providerIdentity?: {
    aliasType: string;
    aliasValue: string;
    referenceNumber: string;
    destinationAccountNo: string;
    occurredAt: string;
    direction: "IN" | "OUT";
    amountVnd: number;
  } | null;
  metadata?: unknown;
};

export type BillingWebhookAdapterResult =
  | {
      kind: "PAYMENT";
      payment: NormalizedBillingWebhookPayment;
    }
  | {
      kind: "REVIEW_REQUIRED" | "IGNORED" | "FAILED";
      errorCode?: string | null;
      errorMessage?: string | null;
    };

export interface BillingWebhookAdapter {
  readonly provider: string;
  normalize(
    event: ClaimedBillingWebhookEvent
  ): Promise<BillingWebhookAdapterResult>;
}
