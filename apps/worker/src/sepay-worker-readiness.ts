export type SePayWorkerReadinessStatus = "PASS" | "WARN" | "FAIL";

export interface SePayWorkerReadinessCheck {
  code: string;
  status: SePayWorkerReadinessStatus;
  message: string;
}

export interface SePayWorkerReadiness {
  ready: boolean;
  reconciliationEnabled: boolean;
  checks: SePayWorkerReadinessCheck[];
}

function envValue(
  env: NodeJS.ProcessEnv,
  name: string
): string {
  return env[name]?.trim() ?? "";
}

export function evaluateSePayWorkerReadiness(input: {
  provider: string;
  env?: NodeJS.ProcessEnv;
}): SePayWorkerReadiness {
  const env = input.env ?? process.env;
  const enabled =
    envValue(env, "SEPAY_RECONCILIATION_ENABLED").toLowerCase() === "true";
  const checks: SePayWorkerReadinessCheck[] = [];

  if (input.provider !== "SEPAY") {
    checks.push({
      code: enabled
        ? "RECONCILIATION_PROVIDER_MISMATCH"
        : "SEPAY_PROVIDER_INACTIVE",
      status: enabled ? "FAIL" : "PASS",
      message: enabled
        ? "SePay reconciliation requires the SEPAY renter-payment provider."
        : "SePay provider is not active for this worker."
    });
    return {
      ready: !enabled,
      reconciliationEnabled: enabled,
      checks
    };
  }

  checks.push({
    code: "SEPAY_PROVIDER_ACTIVE",
    status: "PASS",
    message: "SePay renter-payment provider is active."
  });

  if (!enabled) {
    checks.push({
      code: "RECONCILIATION_DISABLED",
      status: "WARN",
      message:
        "Periodic SePay API-v2 reconciliation is disabled; webhook processing can still run."
    });
    return {
      ready: true,
      reconciliationEnabled: false,
      checks
    };
  }

  const token = envValue(env, "SEPAY_API_TOKEN");
  checks.push(
    token.length >= 16
      ? {
          code: "RECONCILIATION_API_TOKEN_CONFIGURED",
          status: "PASS",
          message: "SePay API-v2 bearer token is configured."
        }
      : {
          code: "RECONCILIATION_API_TOKEN_INVALID",
          status: "FAIL",
          message:
            "SEPAY_API_TOKEN is missing or shorter than 16 characters."
        }
  );

  const baseUrl =
    envValue(env, "SEPAY_API_BASE_URL") || "https://userapi.sepay.vn/v2";
  try {
    const parsed = new URL(baseUrl);
    const production = envValue(env, "NODE_ENV") === "production";
    if (parsed.protocol === "https:") {
      checks.push({
        code: "RECONCILIATION_API_HTTPS",
        status: "PASS",
        message: "SePay API-v2 base URL uses HTTPS."
      });
    } else {
      checks.push({
        code: "RECONCILIATION_API_NOT_HTTPS",
        status: production ? "FAIL" : "WARN",
        message: production
          ? "Production SePay API-v2 base URL must use HTTPS."
          : "Non-HTTPS SePay API-v2 base URL is allowed only outside production."
      });
    }
  } catch {
    checks.push({
      code: "RECONCILIATION_API_URL_INVALID",
      status: "FAIL",
      message: "SEPAY_API_BASE_URL is not a valid URL."
    });
  }

  const scope =
    envValue(env, "SEPAY_RECONCILIATION_SCOPE_KEY") || "default";
  if (scope === "default" && envValue(env, "NODE_ENV") === "production") {
    checks.push({
      code: "RECONCILIATION_SCOPE_DEFAULT",
      status: "WARN",
      message:
        "Production reconciliation should use a deployment-specific scope key instead of default."
    });
  } else {
    checks.push({
      code: "RECONCILIATION_SCOPE_CONFIGURED",
      status: "PASS",
      message: "Reconciliation scope key is configured."
    });
  }

  return {
    ready: !checks.some((check) => check.status === "FAIL"),
    reconciliationEnabled: true,
    checks
  };
}

export function failedSePayWorkerReadinessCodes(
  readiness: SePayWorkerReadiness
): string[] {
  return readiness.checks
    .filter((check) => check.status === "FAIL")
    .map((check) => check.code);
}
