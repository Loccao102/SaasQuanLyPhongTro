import type {
  BillingWebhookAdapter,
  BillingWebhookAdapterResult,
  ClaimedBillingWebhookEvent
} from "../billing-webhook-types.js";

type DevJsonBankPayload = {
  transactionId?: unknown;
  amountVnd?: unknown;
  occurredAt?: unknown;
  paymentReference?: unknown;
  payerName?: unknown;
  note?: unknown;
};

export class DevJsonBankBillingWebhookAdapter
  implements BillingWebhookAdapter
{
  readonly provider = "DEV_JSON_BANK";

  async normalize(
    event: ClaimedBillingWebhookEvent
  ): Promise<BillingWebhookAdapterResult> {
    let payload: DevJsonBankPayload;
    try {
      payload = JSON.parse(event.rawBody) as DevJsonBankPayload;
    } catch {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "DEV_JSON_BANK_INVALID_JSON",
        errorMessage: "Webhook body is not valid JSON."
      };
    }

    if (
      typeof payload.transactionId !== "string" ||
      payload.transactionId.trim().length === 0
    ) {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "DEV_JSON_BANK_TRANSACTION_ID_MISSING",
        errorMessage: "transactionId is required."
      };
    }

    if (
      typeof payload.amountVnd !== "number" ||
      !Number.isInteger(payload.amountVnd) ||
      payload.amountVnd <= 0
    ) {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "DEV_JSON_BANK_AMOUNT_INVALID",
        errorMessage: "amountVnd must be a positive integer."
      };
    }

    if (
      typeof payload.occurredAt !== "string" ||
      Number.isNaN(new Date(payload.occurredAt).getTime())
    ) {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "DEV_JSON_BANK_OCCURRED_AT_INVALID",
        errorMessage:
          "occurredAt must be a provider-supplied valid date-time."
      };
    }

    if (
      payload.paymentReference !== undefined &&
      payload.paymentReference !== null &&
      typeof payload.paymentReference !== "string"
    ) {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "DEV_JSON_BANK_REFERENCE_INVALID",
        errorMessage: "paymentReference must be a string when present."
      };
    }

    if (
      (payload.payerName !== undefined && payload.payerName !== null && typeof payload.payerName !== "string") ||
      (payload.note !== undefined && payload.note !== null && typeof payload.note !== "string")
    ) {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "DEV_JSON_BANK_OPTIONAL_TEXT_INVALID",
        errorMessage: "payerName and note must be strings when present."
      };
    }

    return {
      kind: "PAYMENT",
      payment: {
        providerTransactionId: payload.transactionId.trim(),
        amountVnd: payload.amountVnd,
        occurredAt: new Date(payload.occurredAt).toISOString(),
        paymentReference:
          typeof payload.paymentReference === "string"
            ? payload.paymentReference.trim().toUpperCase() || null
            : null,
        ...(typeof payload.payerName === "string" && payload.payerName.trim()
          ? { payerName: payload.payerName.trim() }
          : {}),
        ...(typeof payload.note === "string" && payload.note.trim()
          ? { note: payload.note.trim() }
          : {}),
        metadata: {
          adapter: this.provider,
          providerEventId: event.providerEventId
        }
      }
    };
  }
}
