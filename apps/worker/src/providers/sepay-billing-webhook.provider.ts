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

const paymentReferencePattern = /^SAAS[A-F0-9]{32}$/i;
const embeddedPaymentReferencePattern =
  /(?:^|[^A-Z0-9])(SAAS[A-F0-9]{32})(?=$|[^A-Z0-9])/i;

function paymentReference(payload: SePayWebhookPayload): string | null {
  if (
    typeof payload.code === "string" &&
    paymentReferencePattern.test(payload.code.trim())
  ) {
    return payload.code.trim().toUpperCase();
  }

  if (typeof payload.content === "string") {
    const match = embeddedPaymentReferencePattern.exec(payload.content);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

function vietnamTransactionDate(value: string): string | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(
      value
    );
  if (!match) return null;

  const iso =
    value.replace(" ", "T") + "+07:00";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map(Number);
  const vietnam = new Date(
    date.getTime() + 7 * 60 * 60 * 1000
  );

  if (
    vietnam.getUTCFullYear() !== year ||
    vietnam.getUTCMonth() + 1 !== month ||
    vietnam.getUTCDate() !== day ||
    vietnam.getUTCHours() !== hour ||
    vietnam.getUTCMinutes() !== minute ||
    vietnam.getUTCSeconds() !== second
  ) {
    return null;
  }

  return date.toISOString();
}

export class SePayBillingWebhookAdapter
  implements BillingWebhookAdapter
{
  readonly provider = "SEPAY";

  constructor(
    private readonly allowedAccountNumbers: ReadonlySet<string>
  ) {}

  static fromEnvironment(
    env: NodeJS.ProcessEnv = process.env
  ): SePayBillingWebhookAdapter {
    const accounts = (env.SEPAY_ALLOWED_ACCOUNT_NUMBERS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (accounts.length === 0) {
      throw new Error(
        "SEPAY_ALLOWED_ACCOUNT_NUMBERS must contain at least one expected bank account."
      );
    }

    return new SePayBillingWebhookAdapter(new Set(accounts));
  }

  async normalize(
    event: ClaimedBillingWebhookEvent
  ): Promise<BillingWebhookAdapterResult> {
    if (event.signatureStatus !== "VERIFIED") {
      return {
        kind: "FAILED",
        errorCode: "SEPAY_SIGNATURE_NOT_VERIFIED",
        errorMessage:
          "Only signature-verified SePay webhook events may be normalized."
      };
    }

    let payload: SePayWebhookPayload;
    try {
      payload = JSON.parse(event.rawBody) as SePayWebhookPayload;
    } catch {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "SEPAY_INVALID_JSON",
        errorMessage: "SePay webhook body is not valid JSON."
      };
    }

    if (
      typeof payload.id !== "number" ||
      !Number.isSafeInteger(payload.id) ||
      payload.id <= 0
    ) {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "SEPAY_TRANSACTION_ID_INVALID",
        errorMessage: "SePay transaction id must be a positive integer."
      };
    }

    if (String(payload.id) !== event.providerEventId) {
      return {
        kind: "FAILED",
        errorCode: "SEPAY_EVENT_ID_MISMATCH",
        errorMessage:
          "Persisted SePay provider event id does not match the raw payload."
      };
    }

    if (payload.transferType === "out") {
      return {
        kind: "IGNORED",
        errorCode: "SEPAY_OUTGOING_TRANSACTION",
        errorMessage:
          "Outgoing bank transactions are not subscription payments."
      };
    }

    if (payload.transferType !== "in") {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "SEPAY_TRANSFER_TYPE_INVALID",
        errorMessage: "SePay transferType must be in or out."
      };
    }

    if (
      typeof payload.accountNumber !== "string" ||
      !this.allowedAccountNumbers.has(payload.accountNumber.trim())
    ) {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "SEPAY_ACCOUNT_NOT_ALLOWED",
        errorMessage:
          "Webhook transaction targets an unconfigured bank account."
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
        errorMessage:
          "SePay transferAmount must be a positive integer VND amount."
      };
    }

    if (typeof payload.transactionDate !== "string") {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "SEPAY_TRANSACTION_DATE_INVALID",
        errorMessage: "SePay transactionDate is required."
      };
    }

    const occurredAt = vietnamTransactionDate(
      payload.transactionDate.trim()
    );
    if (!occurredAt) {
      return {
        kind: "REVIEW_REQUIRED",
        errorCode: "SEPAY_TRANSACTION_DATE_INVALID",
        errorMessage:
          "SePay transactionDate must use YYYY-MM-DD HH:mm:ss in Vietnam time."
      };
    }

    return {
      kind: "PAYMENT",
      payment: {
        providerTransactionId: String(payload.id),
        amountVnd: payload.transferAmount,
        occurredAt,
        paymentReference: paymentReference(payload),
        metadata: {
          adapter: this.provider,
          gateway:
            typeof payload.gateway === "string"
              ? payload.gateway
              : null,
          accountNumber: payload.accountNumber.trim(),
          subAccount:
            typeof payload.subAccount === "string"
              ? payload.subAccount || null
              : null,
          bankReference:
            typeof payload.referenceCode === "string"
              ? payload.referenceCode || null
              : null,
          providerEventId: event.providerEventId
        }
      }
    };
  }
}
