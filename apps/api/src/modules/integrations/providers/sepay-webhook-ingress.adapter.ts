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

type SePayWebhookIdentityPayload = {
  id?: unknown;
};

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

function providerEventId(rawBody: Buffer): string {
  let payload: SePayWebhookIdentityPayload;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as SePayWebhookIdentityPayload;
  } catch {
    throw new BillingWebhookIngressRejectedError(
      "SePay webhook body is not valid JSON."
    );
  }

  if (
    typeof payload.id !== "number" ||
    !Number.isSafeInteger(payload.id) ||
    payload.id <= 0
  ) {
    throw new BillingWebhookIngressRejectedError(
      "SePay webhook id must be a positive integer."
    );
  }

  return String(payload.id);
}

@Injectable()
export class SePayWebhookIngressAdapter
  implements BillingWebhookIngressAdapter
{
  readonly provider = "SEPAY";

  async inspect(input: {
    rawBody: Buffer;
    headers: BillingWebhookHeaders;
  }): Promise<BillingWebhookIngressInspection> {
    const eventId = providerEventId(input.rawBody);
    const timestampHeader = headerValue(
      input.headers,
      "x-sepay-timestamp"
    );
    const signatureHeader = headerValue(
      input.headers,
      "x-sepay-signature"
    );
    const contentType = headerValue(input.headers, "content-type");

    const safeHeaders: Record<string, string> = {};
    if (timestampHeader) {
      safeHeaders["x-sepay-timestamp"] = timestampHeader;
    }
    if (contentType) {
      safeHeaders["content-type"] = contentType;
    }

    const secret = process.env.SEPAY_WEBHOOK_SECRET?.trim() ?? "";
    if (secret.length < 16) {
      return {
        providerEventId: eventId,
        signatureStatus: "NOT_CONFIGURED",
        safeHeaders
      };
    }

    if (
      !timestampHeader ||
      !/^\d{10,13}$/.test(timestampHeader) ||
      !signatureHeader
    ) {
      return {
        providerEventId: eventId,
        signatureStatus: "INVALID",
        safeHeaders
      };
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isSafeInteger(timestamp)) {
      return {
        providerEventId: eventId,
        signatureStatus: "INVALID",
        safeHeaders
      };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestamp) > 300) {
      return {
        providerEventId: eventId,
        signatureStatus: "INVALID",
        safeHeaders
      };
    }

    const signatureMatch = /^sha256=([a-f0-9]{64})$/i.exec(
      signatureHeader
    );
    if (!signatureMatch) {
      return {
        providerEventId: eventId,
        signatureStatus: "INVALID",
        safeHeaders
      };
    }

    const expected = createHmac("sha256", secret)
      .update(timestampHeader + ".", "utf8")
      .update(input.rawBody)
      .digest();
    const actual = Buffer.from(signatureMatch[1]!, "hex");
    const verified =
      actual.length === expected.length &&
      timingSafeEqual(actual, expected);

    return {
      providerEventId: eventId,
      signatureStatus: verified ? "VERIFIED" : "INVALID",
      safeHeaders
    };
  }
}
