export function formatMeterValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
}

export function normalizeMeterInput(raw: string): string | null {
  const normalized = raw.trim().replace(",", ".");
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(normalized);
  if (!match || !match[1]) return null;
  const fraction = match[2]?.replace(/0+$/, "") ?? "";
  return fraction ? match[1] + "." + fraction : match[1];
}

export function calculateUsage(
  current: string | number | null | undefined,
  previous: string | number | null | undefined
): { usage: number; formatted: string } | null {
  if (current === null || current === undefined || current === "") return null;
  if (previous === null || previous === undefined || previous === "") return null;
  const curr = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
  const delta = Math.round((curr - prev) * 1000) / 1000;
  return {
    usage: delta,
    formatted: formatMeterValue(delta)
  };
}

export function validateReadingAgainstPrevious(
  current: string | null | undefined,
  previous: string | null | undefined
): string | null {
  if (!current || !previous) return null;
  const curr = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
  if (curr < prev) {
    return "Chỉ số mới không được nhỏ hơn chỉ số cũ (" + formatMeterValue(previous) + ").";
  }
  return null;
}

export function anomalyWarning(
  current: string | null | undefined,
  previous: string | null | undefined,
  baselineUsage: string | null | undefined
): string | null {
  if (!current || !previous || !baselineUsage) return null;
  const curr = Number(current);
  const prev = Number(previous);
  const baseline = Number(baselineUsage);
  if (!Number.isFinite(curr) || !Number.isFinite(prev) || !Number.isFinite(baseline) || baseline <= 0) {
    return null;
  }
  const usage = curr - prev;
  if (usage > baseline * 2.5) {
    return (
      "Mức dùng " +
      formatMeterValue(usage) +
      " cao hơn đáng kể so với baseline (" +
      formatMeterValue(baseline) +
      "). Vui lòng kiểm tra lại."
    );
  }
  return null;
}
