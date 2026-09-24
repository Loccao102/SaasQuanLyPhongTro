import { positiveInteger } from "./worker-config.js";

export interface RenterPaymentReconciliationCursor {
  provider: string;
  scopeKey: string;
  cursor: string | null;
  version: number;
  lastSuccessAt: string | null;
}

export interface RenterPaymentReconciliationApi {
  renterPaymentReconciliationCursor(
    provider: string,
    scopeKey: string
  ): Promise<RenterPaymentReconciliationCursor>;

  persistRenterPaymentReconciliationObservation(input: {
    provider: string;
    scopeKey: string;
    providerEventId: string;
    rawBody: string;
  }): Promise<unknown>;

  advanceRenterPaymentReconciliationCursor(input: {
    provider: string;
    scopeKey: string;
    expectedVersion: number;
    nextCursor: string;
  }): Promise<RenterPaymentReconciliationCursor>;
}

type SePayApiV2Transaction = {
  id: string;
  transaction_date: string;
  account_number: string;
  transfer_type: "in" | "out";
  amount_in: number;
  amount_out: number;
  transaction_content: string | null;
  reference_number: string | null;
  code: string | null;
  bank_brand_name: string | null;
  bank_account_id: string | null;
  va_id: string | null;
};

type SePayListResponse = {
  status: string;
  data: SePayApiV2Transaction[];
  meta?: {
    pagination?: {
      has_more?: boolean;
    };
  };
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("SePay API v2 " + field + " is required.");
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error("SePay API v2 optional text field has invalid type.");
  }
  return value.trim() || null;
}

function parseTransaction(value: unknown): SePayApiV2Transaction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("SePay API v2 transaction must be an object.");
  }
  const row = value as Record<string, unknown>;
  const id = requiredString(row.id, "id").toLowerCase();
  if (!uuidPattern.test(id)) {
    throw new Error("SePay API v2 transaction id must be a UUID.");
  }
  const transferType = requiredString(row.transfer_type, "transfer_type");
  if (transferType !== "in" && transferType !== "out") {
    throw new Error("SePay API v2 transfer_type must be in or out.");
  }
  if (
    typeof row.amount_in !== "number" ||
    !Number.isSafeInteger(row.amount_in) ||
    row.amount_in < 0 ||
    typeof row.amount_out !== "number" ||
    !Number.isSafeInteger(row.amount_out) ||
    row.amount_out < 0
  ) {
    throw new Error("SePay API v2 money fields must be non-negative integers.");
  }

  return {
    id,
    transaction_date: requiredString(row.transaction_date, "transaction_date"),
    account_number: requiredString(row.account_number, "account_number"),
    transfer_type: transferType,
    amount_in: row.amount_in,
    amount_out: row.amount_out,
    transaction_content: optionalString(row.transaction_content),
    reference_number: optionalString(row.reference_number),
    code: optionalString(row.code),
    bank_brand_name: optionalString(row.bank_brand_name),
    bank_account_id: optionalString(row.bank_account_id),
    va_id: optionalString(row.va_id)
  };
}

function vietnamLocalDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return (
    value("year") +
    "-" +
    value("month") +
    "-" +
    value("day") +
    " " +
    value("hour") +
    ":" +
    value("minute") +
    ":" +
    value("second")
  );
}

export function stableSePayApiV2Observation(
  transaction: SePayApiV2Transaction
): { providerEventId: string; rawBody: string } {
  return {
    providerEventId: "api-v2:" + transaction.id,
    rawBody: JSON.stringify({
      _habiSource: "SEPAY_API_V2",
      id: transaction.id,
      transaction_date: transaction.transaction_date,
      account_number: transaction.account_number,
      transfer_type: transaction.transfer_type,
      amount_in: transaction.amount_in,
      amount_out: transaction.amount_out,
      transaction_content: transaction.transaction_content,
      reference_number: transaction.reference_number,
      code: transaction.code,
      bank_brand_name: transaction.bank_brand_name,
      bank_account_id: transaction.bank_account_id,
      va_id: transaction.va_id
    })
  };
}

export class SePayApiV2Client {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchFn: typeof fetch;

  constructor(input?: {
    baseUrl?: string;
    token?: string;
    fetchFn?: typeof fetch;
  }) {
    this.baseUrl = (
      input?.baseUrl ??
      process.env.SEPAY_API_BASE_URL ??
      "https://userapi.sepay.vn/v2"
    ).replace(/\/$/, "");
    this.token = input?.token ?? process.env.SEPAY_API_TOKEN ?? "";
    this.fetchFn = input?.fetchFn ?? fetch;

    if (this.token.trim().length < 16) {
      throw new Error(
        "SEPAY_API_TOKEN must be configured with at least 16 characters."
      );
    }
  }

  async listTransactions(input: {
    sinceId?: string | null;
    transactionDateFrom?: Date | null;
    page?: number;
    perPage?: number;
  }): Promise<{
    transactions: SePayApiV2Transaction[];
    hasMore: boolean;
  }> {
    const perPage = input.perPage ?? 100;
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
      throw new Error("SePay perPage must be between 1 and 100.");
    }

    const url = new URL(this.baseUrl + "/transactions");
    url.searchParams.set("transfer_type", "in");
    url.searchParams.set("transaction_date_sort", "asc");
    url.searchParams.set("timestamp_format", "iso8601");
    url.searchParams.set("per_page", String(perPage));

    if (input.sinceId) {
      const sinceId = input.sinceId.trim().toLowerCase();
      if (!uuidPattern.test(sinceId)) {
        throw new Error("SePay since_id must be a UUID.");
      }
      url.searchParams.set("since_id", sinceId);
    } else if (input.transactionDateFrom) {
      url.searchParams.set(
        "transaction_date_from",
        vietnamLocalDateTime(input.transactionDateFrom)
      );
      url.searchParams.set("page", String(input.page ?? 1));
    }

    const response = await this.fetchFn(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: "Bearer " + this.token
      }
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(
        "SePay API v2 request failed (" +
          String(response.status) +
          "): " +
          detail
      );
    }

    const payload = (await response.json()) as unknown;
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload)
    ) {
      throw new Error("SePay API v2 response must be an object.");
    }
    const body = payload as Record<string, unknown>;
    if (body.status !== "success" || !Array.isArray(body.data)) {
      throw new Error("SePay API v2 response status/data is invalid.");
    }

    const parsed = body as unknown as SePayListResponse;
    return {
      transactions: parsed.data.map(parseTransaction),
      hasMore: parsed.meta?.pagination?.has_more === true
    };
  }
}

export async function runSePayReconciliationSweepOnce(
  api: RenterPaymentReconciliationApi,
  client: SePayApiV2Client,
  input: {
    scopeKey: string;
    initialLookbackHours: number;
    maxPages?: number;
    now?: Date;
  }
): Promise<{
  observed: number;
  pages: number;
  previousCursor: string | null;
  nextCursor: string | null;
  truncated: boolean;
}> {
  const scopeKey = input.scopeKey.trim();
  if (!scopeKey) {
    throw new Error("SEPAY_RECONCILIATION_SCOPE_KEY is required.");
  }
  const lookbackHours = positiveInteger(
    String(input.initialLookbackHours),
    24,
    "SEPAY_RECONCILIATION_INITIAL_LOOKBACK_HOURS"
  );
  const maxPages = input.maxPages ?? 100;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000) {
    throw new Error("SePay reconciliation maxPages must be 1..1000.");
  }

  const cursor = await api.renterPaymentReconciliationCursor(
    "SEPAY",
    scopeKey
  );
  let observed = 0;
  let pages = 0;
  let nextCursor = cursor.cursor;
  let page = 1;
  const bootstrapFrom = new Date(
    (input.now ?? new Date()).getTime() - lookbackHours * 60 * 60 * 1000
  );

  let completed = false;

  while (pages < maxPages) {
    const result = await client.listTransactions(
      nextCursor
        ? { sinceId: nextCursor, perPage: 100 }
        : {
            transactionDateFrom: bootstrapFrom,
            page,
            perPage: 100
          }
    );
    pages += 1;

    for (const transaction of result.transactions) {
      const observation = stableSePayApiV2Observation(transaction);
      await api.persistRenterPaymentReconciliationObservation({
        provider: "SEPAY",
        scopeKey,
        providerEventId: observation.providerEventId,
        rawBody: observation.rawBody
      });
      nextCursor = transaction.id;
      observed += 1;
    }

    if (!result.hasMore || result.transactions.length === 0) {
      completed = true;
      break;
    }

    if (!cursor.cursor) {
      page += 1;
    }
  }

  const truncated = !completed;

  if (nextCursor && nextCursor !== cursor.cursor) {
    await api.advanceRenterPaymentReconciliationCursor({
      provider: "SEPAY",
      scopeKey,
      expectedVersion: cursor.version,
      nextCursor
    });
  }

  return {
    observed,
    pages,
    previousCursor: cursor.cursor,
    nextCursor,
    truncated
  };
}
