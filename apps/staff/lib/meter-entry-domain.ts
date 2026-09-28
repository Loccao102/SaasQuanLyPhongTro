export function formatMeterValue(value: string | number): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
}

export function normalizeMeterInput(raw: string): string | null {
  const normalized = raw.trim().replace(",", ".");
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(normalized);
  if (!match) return null;
  const fraction = match[2]?.replace(/0+$/, "") ?? "";
  return fraction ? match[1] + "." + fraction : match[1];
}

export function validateAgainstPrevious(
  current: string,
  previous: string | null
): string | null {
  if (previous === null) return null;
  if (Number(current) < Number(previous)) {
    return "Chỉ số mới không được nhỏ hơn chỉ số cũ.";
  }
  return null;
}

export function anomalyWarning(
  current: string,
  previous: string | null,
  baselineUsage: string | null
): string | null {
  if (previous === null || baselineUsage === null) return null;
  const usage = Number(current) - Number(previous);
  const baseline = Number(baselineUsage);
  if (!Number.isFinite(usage) || !Number.isFinite(baseline) || baseline <= 0) {
    return null;
  }
  if (usage > baseline * 2.5) {
    return (
      "Mức dùng " +
      formatMeterValue(usage) +
      " cao hơn đáng kể so với baseline " +
      formatMeterValue(baseline) +
      ". Kiểm tra lại trước khi lưu."
    );
  }
  return null;
}
