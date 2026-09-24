import type {
  BillingWebhookAdapter,
  BillingWebhookAdapterResult,
  ClaimedBillingWebhookEvent
} from "../billing-webhook-types.js";

type SePayWebhookPayload = {
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

type SePayApiV2Payload = {
  _habiSource?: unknown;
  id?: unknown;
  transaction_date?: unknown;
  account_number?: unknown;
  transfer_type?: unknown;
  amount_in?: unknown;
  amount_out?: unknown;
  transaction_content?: unknown;
  reference_number?: unknown;
  code?: unknown;
  bank_brand_name?: unknown;
  bank_account_id?: unknown;
  va_id?: unknown;
};

type NormalizedSePayPayload = {
  providerTransactionId: string | null;
  aliasType: "SEPAY_WEBHOOK_NUMERIC_ID" | "SEPAY_API_V2_UUID";
  transactionDate: unknown;
  accountNumber: unknown;
  code: unknown;
  content: unknown;
  transferType: unknown;
  amount: unknown;
  referenceNumber: unknown;
  metadata: Record<string, unknown>;
};

const renterReferencePattern = /^RENT[A-F0-9]{32}$/i;
const renterReferenceInTextPattern =
  /(?:^|[^A-Z0-9])(RENT[A-F0-9]{32})(?=$|[^A-Z0-9])/i;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function paymentReference(
  codeValue: unknown,
  contentValue: unknown
): string | null {
  const code = optionalString(codeValue);
  if (code && renterReferencePattern.test(code)) {
    return code.toUpperCase();
  }

  const content = optionalString(contentValue);
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

function normalizeSource(
  payload: SePayWebhookPayload | SePayApiV2Payload
): NormalizedSePayPayload {
  if ((payload as SePayApiV2Payload)._habiSource === "SEPAY_API_V2") {
    const api = payload as SePayApiV2Payload;
    const id = optionalString(api.id);
    return {
      providerTransactionId: id && uuidPattern.test(id) ? id.toLowerCase() : null,
      aliasType: "SEPAY_API_V2_UUID",
      transactionDate: api.transaction_date,
      accountNumber: api.account_number,
      code: api.code,
      content: api.transaction_content,
      transferType: api.transfer_type,
      amount: api.amount_in,
      referenceNumber: api.reference_number,
      metadata: {
        source: "SEPAY_API_V2",
        bankBrandName: optionalString(api.bank_brand_name),
        bankAccountId: optionalString(api.bank_account_id),
        vaId: optionalString(api.va_id)
      }
    };
  }

  const webhook = payload as SePayWebhookPayload;
  let id: string | null = null;
  if (
    typeof webhook.id === "number" &&
    Number.isSafeInteger(webhook.id) &&
    webhook.id > 0
  ) {
    id = String(webhook.id);
  } else if (
    typeof webhook.id === "string" &&
    /^[1-9]\d*$/.test(webhook.id.trim())
  ) {
    id = webhook.id.trim();
  }

  return {
    providerTransactionId: id,
    aliasType: "SEPAY_WEBHOOK_NUMERIC_ID",
    transactionDate: webhook.transactionDate,
    accountNumber: webhook.accountNumber,
    code: webhook.code,
    content: webhook.content,
    transferType: webhook.transferType,
    amount: webhook.transferAmount,
    referenceNumber: webhook.referenceCode,
    metadata: {
      source: "SEPAY_WEBHOOK",
      gateway: optionalString(webhook.gateway),
      subAccount: optionalString(webhook.subAccount),
      description: optionalString(webhook.description)
    }
  };
}

export class SePayRenterPaymentWebhookAdapter
  implements BillingWebhookAdapter
{
  readonly provider = "SEPAY";

  async normalize(
    event: ClaimedBillingWebhookEvent
  ): Promise<BillingWebhookAdapterResult> {
    let parsed: SePayWebhookPayload | SePayApiV2Payload;
    try {
      parsed = JSON.parse(event.rawBody) as
        | SePayWebhookPayload
        | SePayApiV2Payload;
    } catch {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "SEPAY_INVALID_JSON",
        errorMessage: "SePay payment observation is not valid JSON."
      };
    }

    const payload = normalizeSource(parsed);

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
        errorMessage: "SePay transfer type must be in or out."
      };
    }

    if (!payload.providerTransactionId) {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "SEPAY_TRANSACTION_ID_INVALID",
        errorMessage:
          payload.aliasType === "SEPAY_API_V2_UUID"
            ? "SePay API v2 id must be a UUID transaction identifier."
            : "SePay webhook id must be a positive transaction identifier."
      };
    }

    if (
      typeof payload.amount !== "number" ||
      !Number.isSafeInteger(payload.amount) ||
      payload.amount <= 0
    ) {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "SEPAY_AMOUNT_INVALID",
        errorMessage: "SePay incoming amount must be a positive integer VND amount."
      };
    }

    const occurredAt = sePayTimestamp(payload.transactionDate);
    if (!occurredAt) {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "SEPAY_TRANSACTION_DATE_INVALID",
        errorMessage:
          "SePay transaction date must be a valid Vietnam local timestamp or ISO date-time."
      };
    }

    const content = optionalString(payload.content);
    const destinationAccountNo = optionalString(payload.accountNumber);
    const referenceNumber = optionalString(payload.referenceNumber);
    const reference = paymentReference(payload.code, payload.content);
    const providerIdentity =
      destinationAccountNo && referenceNumber
        ? {
            aliasType: payload.aliasType,
            aliasValue: payload.providerTransactionId,
            referenceNumber,
            destinationAccountNo,
            occurredAt,
            direction: "IN" as const,
            amountVnd: payload.amount
          }
        : null;

    return {
      kind: "PAYMENT",
      payment: {
        providerTransactionId: payload.providerTransactionId,
        amountVnd: payload.amount,
        occurredAt,
        paymentReference: reference,
        destinationAccountNo,
        providerIdentity,
        ...(content ? { note: content } : {}),
        metadata: {
          adapter: this.provider,
          providerEventId: event.providerEventId,
          accountNumber: destinationAccountNo,
          referenceNumber,
          transferType: payload.transferType,
          ...payload.metadata
        }
      }
    };
  }
}
