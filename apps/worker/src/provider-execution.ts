import type {
  ClaimedNotificationJob,
  NotificationProvider,
  NotificationProviderResult
} from "./notification-types.js";

export async function executeProviderSafely(
  provider: NotificationProvider,
  job: ClaimedNotificationJob
): Promise<NotificationProviderResult> {
  try {
    return await provider.send(job);
  } catch (error) {
    return {
      kind: "UNKNOWN",
      errorCode: "PROVIDER_EXCEPTION",
      errorMessage:
        error instanceof Error ? error.message : "Unknown provider exception",
      evidence: {
        provider: provider.name,
        attemptNumber: job.attemptNumber
      }
    };
  }
}
