import {
  createHash,
  createHmac,
  timingSafeEqual
} from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
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

function sePayTransactionId(rawBody: Buffer): string | null {
  try {
    const payload = JSON.parse(rawBody.toString("utf8")) as {
      id?: unknown;
    };
    if (
      typeof payload.id === "number" &&
      Number.isSafeInteger(payload.id) &&
      payload.id > 0
    ) {
      return String(payload.id);
    }
    if (
      typeof payload.id === "string" &&
      /^[1-9]\d*$/.test(payload.id.trim())
    ) {
      return payload.id.trim();
    }
  } catch {
    // Malformed payloads still get a deterministic raw-body event key.
  }
  return null;
}

export class SePayWebhookConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SePayWebhookConfigurationError";
  }
}


function configuredSecrets(): readonly string[] {
  const current =
    process.env.SEPAY_RENTER_WEBHOOK_SECRET?.trim() ?? "";
  if (current.length < 16) {
    throw new SePayWebhookConfigurationError(
      "SEPAY_RENTER_WEBHOOK_SECRET must be configured with at least 16 characters."
    );
  }

  const previous =
    process.env.SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS?.trim() ?? "";
  if (previous.length > 0 && previous.length < 16) {
    throw new SePayWebhookConfigurationError(
      "SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS must be empty or contain at least 16 characters."
    );
  }
  if (previous.length > 0 && previous === current) {
    throw new SePayWebhookConfigurationError(
      "SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS must differ from the current secret."
    );
  }

  return previous.length > 0 ? [current, previous] : [current];
}

function signatureMatches(
  secret: string,
  timestampValue: string,
  rawBody: Buffer,
  suppliedSignature: string
): boolean {
  const expected =
    "sha256=" +
    createHmac("sha256", secret)
      .update(timestampValue + ".")
      .update(rawBody)
      .digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(
    suppliedSignature.toLowerCase(),
    "utf8"
  );

  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

@Injectable()
export class SePayRenterPaymentWebhookIngressAdapter
  implements BillingWebhookIngressAdapter
{
  readonly provider = "SEPAY";

  async inspect(input: {
    rawBody: Buffer;
    headers: BillingWebhookHeaders;
  }): Promise<BillingWebhookIngressInspection> {
    const secrets = configuredSecrets();

    const rawBodySha256 = createHash("sha256")
      .update(input.rawBody)
      .digest("hex");
    const timestampValue = headerValue(
      input.headers,
      "x-sepay-timestamp"
    );
    const suppliedSignature = headerValue(
      input.headers,
      "x-sepay-signature"
    );

    let verified = false;
    if (
      timestampValue !== null &&
      /^\d+$/.test(timestampValue) &&
      suppliedSignature !== null &&
      /^sha256=[a-f0-9]{64}$/i.test(suppliedSignature)
    ) {
      const timestamp = Number(timestampValue);
      const current = Math.floor(Date.now() / 1000);
      if (
        Number.isSafeInteger(timestamp) &&
        timestamp > 0 &&
        Math.abs(current - timestamp) <= 300
      ) {
        let anyMatch = false;
        for (const secret of secrets) {
          const matches = signatureMatches(
            secret,
            timestampValue,
            input.rawBody,
            suppliedSignature
          );
          anyMatch = anyMatch || matches;
        }
        verified = anyMatch;
      }
    }

    const transactionId = verified
      ? sePayTransactionId(input.rawBody)
      : null;
    const providerEventId = verified
      ? transactionId ?? "verified-raw:" + rawBodySha256
      : "invalid:" + rawBodySha256;

    const safeHeaders: Record<string, string> = {};
    const contentType = headerValue(input.headers, "content-type");
    if (contentType) safeHeaders["content-type"] = contentType;
    if (timestampValue) {
      safeHeaders["x-sepay-timestamp"] = timestampValue;
    }

    return {
      providerEventId,
      signatureStatus: verified ? "VERIFIED" : "INVALID",
      safeHeaders
    };
  }
}
