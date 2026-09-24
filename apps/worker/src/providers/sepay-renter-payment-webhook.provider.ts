import type {
  BillingWebhookAdapter,
  BillingWebhookAdapterResult,
  ClaimedBillingWebhookEvent
} from "../billing-webhook-types.js";

type SePayPayload = {
  id?: unknown;
  gateway?: unknown;
  transactionDate?: unknown;
  accountNumber?: unknown;
  subAccount?: unknown;
  code?: unknown;
  content?: unknown;
  transferType?: unknown;
  description?: unknown;
  transferAmount?: unknown;
  accumulated?: unknown;
  referenceCode?: unknown;
};

const renterReferencePattern = /^RENT[A-F0-9]{32}$/i;
const renterReferenceInTextPattern =
  /(?:^|[^A-Z0-9])(RENT[A-F0-9]{32})(?=$|[^A-Z0-9])/i;

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function paymentReference(payload: SePayPayload): string | null {
  const code = optionalString(payload.code);
  if (code && renterReferencePattern.test(code)) {
    return code.toUpperCase();
  }

  const content = optionalString(payload.content);
  if (!content) return null;
  const match = content.match(renterReferenceInTextPattern);
  return match?.[1]?.toUpperCase() ?? null;
}

function sePayTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();

  const local = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
  );
  if (local) {
    const year = Number(local[1]);
    const month = Number(local[2]);
    const day = Number(local[3]);
    const hour = Number(local[4]);
    const minute = Number(local[5]);
    const second = Number(local[6]);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > daysInMonth ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      return null;
    }
    return new Date(
      normalized.replace(" ", "T") + "+07:00"
    ).toISOString();
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export class SePayRenterPaymentWebhookAdapter
  implements BillingWebhookAdapter
{
  readonly provider = "SEPAY";

  async normalize(
    event: ClaimedBillingWebhookEvent
  ): Promise<BillingWebhookAdapterResult> {
    let payload: SePayPayload;
    try {
      payload = JSON.parse(event.rawBody) as SePayPayload;
    } catch {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "SEPAY_INVALID_JSON",
        errorMessage: "SePay webhook body is not valid JSON."
      };
    }

    if (payload.transferType === "out") {
      return {
        kind: "IGNORED",
        errorCode: "SEPAY_OUTGOING_TRANSACTION",
        errorMessage: "Outgoing bank transactions are not renter payments."
      };
    }
    if (payload.transferType !== "in") {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "SEPAY_TRANSFER_TYPE_INVALID",
        errorMessage: "SePay transferType must be in or out."
      };
    }

    let providerTransactionId: string | null = null;
    if (
      typeof payload.id === "number" &&
      Number.isSafeInteger(payload.id) &&
      payload.id > 0
    ) {
      providerTransactionId = String(payload.id);
    } else if (
      typeof payload.id === "string" &&
      /^[1-9]\d*$/.test(payload.id.trim())
    ) {
      providerTransactionId = payload.id.trim();
    }
    if (!providerTransactionId) {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "SEPAY_TRANSACTION_ID_INVALID",
        errorMessage: "SePay id must be a positive transaction identifier."
      };
    }

    if (
      typeof payload.transferAmount !== "number" ||
      !Number.isSafeInteger(payload.transferAmount) ||
      payload.transferAmount <= 0
    ) {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "SEPAY_AMOUNT_INVALID",
        errorMessage: "SePay transferAmount must be a positive integer VND amount."
      };
    }

    const occurredAt = sePayTimestamp(payload.transactionDate);
    if (!occurredAt) {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "SEPAY_TRANSACTION_DATE_INVALID",
        errorMessage:
          "SePay transactionDate must be a valid Vietnam local timestamp or ISO date-time."
      };
    }

    const content = optionalString(payload.content);
    const reference = paymentReference(payload);
    const destinationAccountNo = optionalString(payload.accountNumber);
    const referenceNumber = optionalString(payload.referenceCode);
    const providerIdentity =
      destinationAccountNo && referenceNumber
        ? {
            aliasType: "SEPAY_WEBHOOK_NUMERIC_ID",
            aliasValue: providerTransactionId,
            referenceNumber,
            destinationAccountNo,
            occurredAt,
            direction: "IN" as const,
            amountVnd: payload.transferAmount
          }
        : null;

    return {
      kind: "PAYMENT",
      payment: {
        providerTransactionId,
        amountVnd: payload.transferAmount,
        occurredAt,
        paymentReference: reference,
        destinationAccountNo,
        providerIdentity,
        ...(content ? { note: content } : {}),
        metadata: {
          adapter: this.provider,
          providerEventId: event.providerEventId,
          gateway: optionalString(payload.gateway),
          accountNumber: optionalString(payload.accountNumber),
          subAccount: optionalString(payload.subAccount),
          referenceCode: optionalString(payload.referenceCode),
          description: optionalString(payload.description),
          transferType: payload.transferType
        }
      }
    };
  }
}
