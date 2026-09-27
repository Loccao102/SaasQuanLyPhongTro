import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  SaasBillingWebhookInboxService,
  type SaasBillingWebhookEventView
} from "./saas-billing-webhook-inbox.service.js";

export type BillingWebhookHeaders = Record<
  string,
  string | string[] | undefined
>;

export interface BillingWebhookIngressInspection {
  providerEventId: string;
  signatureStatus: "VERIFIED" | "INVALID" | "NOT_CONFIGURED";
  safeHeaders?: Record<string, string>;
}

export interface BillingWebhookIngressAdapter {
  readonly provider: string;

  inspect(input: {
    rawBody: Buffer;
    headers: BillingWebhookHeaders;
  }): Promise<BillingWebhookIngressInspection>;
}

export class BillingWebhookIngressRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingWebhookIngressRejectedError";
  }
}

export function assertWebhookBodySize(rawBody: Buffer): void {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    throw new BillingWebhookIngressRejectedError(
      "Webhook raw body is required."
    );
  }

  const configured = Number(process.env.WEBHOOK_MAX_BODY_BYTES ?? "262144");
  if (
    !Number.isSafeInteger(configured) ||
    configured < 1024 ||
    configured > 2 * 1024 * 1024
  ) {
    throw new Error(
      "WEBHOOK_MAX_BODY_BYTES must be an integer between 1024 and 2097152."
    );
  }

  if (rawBody.length > configured) {
    throw new BillingWebhookIngressRejectedError(
      "Webhook payload exceeds the configured size limit."
    );
  }
}

@Injectable()
export class BillingWebhookIngressService {
  constructor(
    private readonly inbox: SaasBillingWebhookInboxService
  ) {}

  async accept(
    adapter: BillingWebhookIngressAdapter,
    rawBody: Buffer,
    headers: BillingWebhookHeaders
  ): Promise<SaasBillingWebhookEventView> {
    assertWebhookBodySize(rawBody);

    const inspection = await adapter.inspect({
      rawBody,
      headers
    });
    const providerEventId = inspection.providerEventId.trim();
    if (!providerEventId) {
      throw new BillingWebhookIngressRejectedError(
        "Provider event id is required."
      );
    }

    const rawBodySha256 = createHash("sha256")
      .update(rawBody)
      .digest("hex");

    return this.inbox.persist({
      provider: adapter.provider,
      providerEventId,
      signatureStatus: inspection.signatureStatus,
      rawBody: rawBody.toString("utf8"),
      rawBodySha256,
      headers: inspection.safeHeaders ?? {}
    });
  }
}
