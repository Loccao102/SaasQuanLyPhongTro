import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { RenterPaymentWebhookInboxService } from "../renter-payments/renter-payment-webhook-inbox.service.js";
import type {
  BillingWebhookHeaders,
  BillingWebhookIngressAdapter
} from "./billing-webhook-ingress.service.js";
import { BillingWebhookIngressRejectedError } from "./billing-webhook-ingress.service.js";

@Injectable()
export class RenterPaymentWebhookIngressService {
  constructor(private readonly inbox: RenterPaymentWebhookInboxService) {}

  async accept(
    adapter: BillingWebhookIngressAdapter,
    rawBody: Buffer,
    headers: BillingWebhookHeaders
  ) {
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      throw new BillingWebhookIngressRejectedError(
        "Webhook raw body is required."
      );
    }
    const inspection = await adapter.inspect({ rawBody, headers });
    const providerEventId = inspection.providerEventId.trim();
    if (!providerEventId) {
      throw new BillingWebhookIngressRejectedError(
        "Provider event id is required."
      );
    }

    return this.inbox.persist({
      provider: adapter.provider,
      providerEventId,
      signatureStatus: inspection.signatureStatus,
      rawBody: rawBody.toString("utf8"),
      rawBodySha256: createHash("sha256").update(rawBody).digest("hex"),
      headers: inspection.safeHeaders ?? {}
    });
  }
}
