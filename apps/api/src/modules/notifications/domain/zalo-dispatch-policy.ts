/**
 * Conservative operating guardrails for user-consented, transactional Zalo
 * Personal messaging. These are NOT official Zalo limits or a spam bypass.
 * Limits are evaluated against persisted attempts by the API at claim time,
 * so a worker restart cannot reset the pace.
 */
export interface ZaloDispatchPolicy {
  minGapSeconds: number;
  maxPer15Minutes: number;
  maxPer24Hours: number;
  startHour: number;
  endHour: number;
}

function integerInRange(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = env[key];
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(key + " must be an integer between " + min + " and " + max);
  }
  return value;
}

export function zaloDispatchPolicy(
  env: NodeJS.ProcessEnv = process.env
): ZaloDispatchPolicy {
  const policy = {
    minGapSeconds: integerInRange(env, "ZALO_SEND_MIN_GAP_SECONDS", 60, 30, 3600),
    maxPer15Minutes: integerInRange(env, "ZALO_SEND_MAX_PER_15_MINUTES", 4, 1, 5),
    maxPer24Hours: integerInRange(env, "ZALO_SEND_MAX_PER_24_HOURS", 30, 1, 50),
    startHour: integerInRange(env, "ZALO_SEND_START_HOUR", 8, 0, 23),
    endHour: integerInRange(env, "ZALO_SEND_END_HOUR", 20, 1, 24)
  };
  if (policy.startHour >= policy.endHour) {
    throw new Error("ZALO_SEND_START_HOUR must be earlier than ZALO_SEND_END_HOUR");
  }
  return policy;
}
