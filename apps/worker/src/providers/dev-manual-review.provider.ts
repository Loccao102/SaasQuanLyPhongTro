import type {
  ClaimedNotificationJob,
  NotificationProvider,
  NotificationProviderResult
} from "../notification-types.js";

export class DevManualReviewProvider implements NotificationProvider {
  readonly name = "DEV_MANUAL_REVIEW";

  async send(
    job: ClaimedNotificationJob
  ): Promise<NotificationProviderResult> {
    return {
      kind: "MANUAL_REVIEW",
      errorCode: "DEV_PROVIDER_NO_SEND",
      errorMessage:
        "Development provider intentionally performs no external send.",
      evidence: {
        recipientKey: job.recipientKey,
        messageLength: job.messageBody.length
      }
    };
  }
}
