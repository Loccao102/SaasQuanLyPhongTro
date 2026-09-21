import type {
  ClaimedNotificationJob,
  NotificationProviderResult
} from "./notification-types.js";

export class InternalWorkerApiClient {
  private readonly apiBase: string;
  private readonly token: string;

  constructor(input?: { apiBase?: string; token?: string }) {
    this.apiBase = (
      input?.apiBase ??
      process.env.INTERNAL_API_BASE_URL ??
      "http://localhost:4000/api"
    ).replace(/\/$/, "");
    this.token = input?.token ?? process.env.INTERNAL_WORKER_TOKEN ?? "";

    if (this.token.trim().length < 16) {
      throw new Error(
        "INTERNAL_WORKER_TOKEN must be configured with at least 16 characters."
      );
    }
  }

  heartbeat(input: {
    workerId: string;
    provider: string;
    status: "STARTING" | "HEALTHY" | "DEGRADED" | "STOPPING";
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    metadata?: unknown;
    pauseProviderReason?: string | null;
  }): Promise<{ ok: true }> {
    return this.request("/internal/notifications/heartbeat", input);
  }

  claim(provider: string): Promise<ClaimedNotificationJob | null> {
    return this.request<ClaimedNotificationJob | null>(
      "/internal/notifications/claim",
      {
        provider
      }
    );
  }

  complete(
    job: ClaimedNotificationJob,
    result: NotificationProviderResult
  ): Promise<{
    jobId: string;
    status: string;
    verificationState: string;
  }> {
    return this.request(
      "/internal/notifications/" + encodeURIComponent(job.id) + "/complete",
      {
        organizationId: job.organizationId,
        attemptNumber: job.attemptNumber,
        result
      }
    );
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(this.apiBase + path, {
      method: "POST",
      headers: {
        authorization: "Bearer " + this.token,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        "Internal API request failed (" +
          String(response.status) +
          "): " +
          detail
      );
    }

    return response.json() as Promise<T>;
  }
}
