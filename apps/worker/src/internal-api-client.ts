import type {
  ClaimedBillingWebhookEvent,
  NormalizedBillingWebhookPayment
} from "./billing-webhook-types.js";
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

  claimBillingWebhook(
    provider: string
  ): Promise<ClaimedBillingWebhookEvent | null> {
    return this.request<ClaimedBillingWebhookEvent | null>(
      "/internal/billing-webhooks/claim",
      { provider }
    );
  }

  completeBillingWebhookPayment(
    eventId: string,
    payment: NormalizedBillingWebhookPayment
  ): Promise<{
    event: {
      id: string;
      processingStatus: string;
      paymentId: string | null;
    };
    ingestion: {
      payment: { id: string; reconciliationStatus: string };
    };
    replayed: boolean;
  }> {
    return this.request(
      "/internal/billing-webhooks/" +
        encodeURIComponent(eventId) +
        "/payment",
      payment
    );
  }

  completeBillingWebhookOutcome(
    eventId: string,
    input: {
      outcome: "REVIEW_REQUIRED" | "IGNORED" | "FAILED";
      errorCode?: string | null;
      errorMessage?: string | null;
    }
  ): Promise<{
    id: string;
    processingStatus: string;
    paymentId: string | null;
  }> {
    return this.request(
      "/internal/billing-webhooks/" +
        encodeURIComponent(eventId) +
        "/outcome",
      input
    );
  }


  claimRenterPaymentWebhook(
    provider: string
  ): Promise<ClaimedBillingWebhookEvent | null> {
    return this.request<ClaimedBillingWebhookEvent | null>(
      "/internal/renter-payment-webhooks/claim",
      { provider }
    );
  }

  completeRenterPaymentWebhookPayment(
    eventId: string,
    payment: NormalizedBillingWebhookPayment
  ): Promise<unknown> {
    return this.request(
      "/internal/renter-payment-webhooks/" +
        encodeURIComponent(eventId) +
        "/payment",
      payment
    );
  }

  completeRenterPaymentWebhookOutcome(
    eventId: string,
    input: {
      outcome: "REVIEW_REQUIRED" | "IGNORED" | "FAILED";
      errorCode?: string | null;
      errorMessage?: string | null;
    }
  ): Promise<unknown> {
    return this.request(
      "/internal/renter-payment-webhooks/" +
        encodeURIComponent(eventId) +
        "/outcome",
      input
    );
  }


  renterPaymentReconciliationCursor(
    provider: string,
    scopeKey: string
  ): Promise<{
    provider: string;
    scopeKey: string;
    cursor: string | null;
    version: number;
    lastSuccessAt: string | null;
  }> {
    return this.request(
      "/internal/renter-payment-reconciliation/cursor",
      { provider, scopeKey }
    );
  }

  persistRenterPaymentReconciliationObservation(input: {
    provider: string;
    scopeKey: string;
    providerEventId: string;
    rawBody: string;
  }): Promise<unknown> {
    return this.request(
      "/internal/renter-payment-reconciliation/observations",
      input
    );
  }

  advanceRenterPaymentReconciliationCursor(input: {
    provider: string;
    scopeKey: string;
    expectedVersion: number;
    nextCursor: string;
  }): Promise<{
    provider: string;
    scopeKey: string;
    cursor: string | null;
    version: number;
    lastSuccessAt: string | null;
  }> {
    return this.request(
      "/internal/renter-payment-reconciliation/advance",
      input
    );
  }

  billingSweep(limit: number): Promise<{
    processed: number;
    results: Array<{
      organizationId: string;
      ok: boolean;
      invoiceId?: string | null;
      activatedPaidPeriod?: boolean;
      transition?: string | null;
      error?: string;
    }>;
  }> {
    return this.request("/internal/billing/sweep", { limit });
  }

  renterBillingReminderSweep(limit: number): Promise<{
    scanned: number;
    reminded: number;
    skipped: number;
    reminders: Array<{
      invoiceId: string;
      invoiceNumber: string;
      roomCode: string;
      recipientPhone: string;
      recipientName: string | null;
      tier: string;
      remainingVnd: number;
      dueDate: string;
    }>;
  }> {
    return this.request("/internal/renter-billing/reminder-sweep", { limit });
  }

  observabilityHeartbeat(input: {
    workerId: string;
    role:
      | "NOTIFICATION"
      | "BILLING"
      | "BILLING_WEBHOOK"
      | "RENTER_PAYMENT_WEBHOOK"
      | "DUNNING";
    provider?: string | null;
    status: "STARTING" | "HEALTHY" | "DEGRADED" | "STOPPING";
    staleAfterSeconds: number;
    lastErrorCode?: string | null;
    metadata?: Readonly<Record<string, unknown>>;
  }): Promise<{ ok: true }> {
    return this.request("/internal/observability/heartbeat", input);
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

  zaloLoginClaim(): Promise<{
    id: string; organizationId: string; expiresAt: string;
  } | null> {
    return this.request("/internal/zalo-personal/claim", {});
  }

  zaloLoginProgress(requestId: string, qrImage: string): Promise<{ ok: boolean }> {
    return this.request("/internal/zalo-personal/" + encodeURIComponent(requestId) + "/progress", { qrImage });
  }

  zaloLoginFinish(requestId: string, input: {
    status: "CONNECTED" | "FAILED";
    encryptedSession?: string;
    errorMessage?: string;
  }): Promise<{ ok: boolean }> {
    return this.request("/internal/zalo-personal/" + encodeURIComponent(requestId) + "/finish", input);
  }

  zaloPersonalSession(jobId: string): Promise<{
    organizationId: string; encryptedSession: string;
  } | null> {
    return this.request("/internal/zalo-personal/session/" + encodeURIComponent(jobId), {});
  }

  zaloPersonalSaveSession(jobId: string, encryptedSession: string): Promise<{ ok: boolean }> {
    return this.request(
      "/internal/zalo-personal/session/" + encodeURIComponent(jobId) + "/save",
      { encryptedSession }
    );
  }

  zaloPersonalInvalidateSession(jobId: string, reason: string): Promise<{ ok: boolean }> {
    return this.request(
      "/internal/zalo-personal/session/" + encodeURIComponent(jobId) + "/invalidate",
      { reason }
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

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        "Internal API request failed (" +
          String(response.status) +
          ") " +
          path +
          ": " +
          (responseText.trim() || "<empty response>")
      );
    }

    if (!responseText.trim()) {
      return null as T;
    }

    try {
      return JSON.parse(responseText) as T;
    } catch (error) {
      const contentType = response.headers.get("content-type") ?? "unknown";
      const preview =
        responseText.length > 240
          ? responseText.slice(0, 240) + "..."
          : responseText;
      throw new Error(
        "Internal API returned invalid JSON (" +
          String(response.status) +
          ") " +
          path +
          " content-type=" +
          contentType +
          ": " +
          preview +
          (error instanceof Error ? " [" + error.message + "]" : "")
      );
    }
  }
}
