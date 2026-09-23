import { ConflictException } from "@nestjs/common";

export function normalizeQuantity3(
  value: string | number,
  field = "quantity"
): string {
  const raw = typeof value === "number" ? String(value) : value.trim();
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(raw);
  if (!match) {
    throw new ConflictException(
      field + " must be a non-negative decimal with at most 3 decimals."
    );
  }
  return match[1] + "." + (match[2] ?? "").padEnd(3, "0");
}

export function quantityToMilli(value: string | number): bigint {
  const normalized = normalizeQuantity3(value);
  const [whole, fraction] = normalized.split(".");
  return BigInt(whole!) * 1000n + BigInt(fraction!);
}

export function quantityTimesUnitPriceVnd(
  quantity: string | number,
  unitPriceVnd: number
): number {
  if (!Number.isSafeInteger(unitPriceVnd) || unitPriceVnd < 0) {
    throw new ConflictException(
      "unitPriceVnd must be a non-negative safe integer."
    );
  }

  const raw = BigInt(unitPriceVnd) * quantityToMilli(quantity);
  const rounded = (raw + 500n) / 1000n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ConflictException("Calculated amount exceeds safe integer range.");
  }
  return Number(rounded);
}
