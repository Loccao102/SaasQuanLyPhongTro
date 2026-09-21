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
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      throw new BillingWebhookIngressRejectedError(
        "Webhook raw body is required."
      );
    }

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
