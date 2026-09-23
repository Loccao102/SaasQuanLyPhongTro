export function normalizeMeterInput(raw: string): string | null {
  const normalized = raw.trim().replace(",", ".");
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(normalized);
  if (!match) return null;
  return match[1] + "." + (match[2] ?? "").padEnd(3, "0");
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
      usage.toFixed(3) +
      " cao hơn đáng kể so với baseline " +
      baseline.toFixed(3) +
      ". Kiểm tra lại trước khi lưu."
    );
  }
  return null;
}
