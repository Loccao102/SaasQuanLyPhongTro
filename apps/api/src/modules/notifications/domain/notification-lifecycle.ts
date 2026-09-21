import type { NotificationProviderResult } from "./notification-provider.js";

export type NotificationJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "RETRY_WAIT"
  | "SENT"
  | "FAILED"
  | "MANUAL_REVIEW"
  | "CANCELLED";

export type NotificationVerificationState =
  | "NOT_ATTEMPTED"
  | "VERIFIED"
  | "AMBIGUOUS"
  | "UNKNOWN";

export interface NotificationCompletionDecision {
  jobStatus: NotificationJobStatus;
  attemptOutcome:
    | "SENT"
    | "TRANSIENT_FAILURE"
    | "PERMANENT_FAILURE"
    | "MANUAL_REVIEW"
    | "UNKNOWN";
  verificationState: NotificationVerificationState;
  retryDelaySeconds: number | null;
  sent: boolean;
}

export function decideNotificationCompletion(input: {
  result: NotificationProviderResult;
  attemptCount: number;
  maxAttempts: number;
}): NotificationCompletionDecision {
  if (input.result.kind === "SENT_CONFIRMED") {
    if (
      input.result.recipientVerified === true &&
      input.result.sendVerified === true
    ) {
      return {
        jobStatus: "SENT",
        attemptOutcome: "SENT",
        verificationState: "VERIFIED",
        retryDelaySeconds: null,
        sent: true
      };
    }

    return {
      jobStatus: "MANUAL_REVIEW",
      attemptOutcome: "MANUAL_REVIEW",
      verificationState: "AMBIGUOUS",
      retryDelaySeconds: null,
      sent: false
    };
  }

  if (input.result.kind === "TRANSIENT_FAILURE") {
    if (input.attemptCount < input.maxAttempts) {
      return {
        jobStatus: "RETRY_WAIT",
        attemptOutcome: "TRANSIENT_FAILURE",
        verificationState: "UNKNOWN",
        retryDelaySeconds: Math.min(
          30 * 60,
          60 * 2 ** Math.max(0, input.attemptCount - 1)
        ),
        sent: false
      };
    }

    return {
      jobStatus: "FAILED",
      attemptOutcome: "TRANSIENT_FAILURE",
      verificationState: "UNKNOWN",
      retryDelaySeconds: null,
      sent: false
    };
  }

  if (input.result.kind === "PERMANENT_FAILURE") {
    return {
      jobStatus: "FAILED",
      attemptOutcome: "PERMANENT_FAILURE",
      verificationState: "UNKNOWN",
      retryDelaySeconds: null,
      sent: false
    };
  }

  if (input.result.kind === "MANUAL_REVIEW") {
    return {
      jobStatus: "MANUAL_REVIEW",
      attemptOutcome: "MANUAL_REVIEW",
      verificationState: "AMBIGUOUS",
      retryDelaySeconds: null,
      sent: false
    };
  }

  return {
    jobStatus: "MANUAL_REVIEW",
    attemptOutcome: "UNKNOWN",
    verificationState: "UNKNOWN",
    retryDelaySeconds: null,
    sent: false
  };
}
