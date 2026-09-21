import {
  createHmac,
  timingSafeEqual
} from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  BillingWebhookIngressRejectedError,
  type BillingWebhookHeaders,
  type BillingWebhookIngressAdapter,
  type BillingWebhookIngressInspection
} from "../billing-webhook-ingress.service.js";

function headerValue(
  headers: BillingWebhookHeaders,
  name: string
): string | null {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }
  return value?.trim() || null;
}

@Injectable()
export class DevJsonBankWebhookIngressAdapter
  implements BillingWebhookIngressAdapter
{
  readonly provider = "DEV_JSON_BANK";

  async inspect(input: {
    rawBody: Buffer;
    headers: BillingWebhookHeaders;
  }): Promise<BillingWebhookIngressInspection> {
    const providerEventId = headerValue(
      input.headers,
      "x-dev-event-id"
    );
    if (!providerEventId) {
      throw new BillingWebhookIngressRejectedError(
        "x-dev-event-id is required."
      );
    }

    const safeHeaders: Record<string, string> = {
      "x-dev-event-id": providerEventId
    };
    const contentType = headerValue(input.headers, "content-type");
    if (contentType) {
      safeHeaders["content-type"] = contentType;
    }

    const secret =
      process.env.DEV_BILLING_WEBHOOK_SECRET?.trim() ?? "";
    if (secret.length < 16) {
      return {
        providerEventId,
        signatureStatus: "NOT_CONFIGURED",
        safeHeaders
      };
    }

    const supplied = headerValue(
      input.headers,
      "x-dev-signature"
    );
    if (!supplied || !/^[a-f0-9]{64}$/i.test(supplied)) {
      return {
        providerEventId,
        signatureStatus: "INVALID",
        safeHeaders
      };
    }

    const expected = createHmac("sha256", secret)
      .update(input.rawBody)
      .digest();
    const actual = Buffer.from(supplied, "hex");
    const verified =
      actual.length === expected.length &&
      timingSafeEqual(actual, expected);

    return {
      providerEventId,
      signatureStatus: verified ? "VERIFIED" : "INVALID",
      safeHeaders
    };
  }
}
