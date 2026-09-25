export type SePayReadinessSeverity = "ERROR" | "WARNING";

export type SePayReadinessIssue = {
  severity: SePayReadinessSeverity;
  code: string;
  message: string;
};

export type SePayReadinessReport = {
  ready: boolean;
  reconciliationEnabled: boolean;
  previousWebhookSecretConfigured: boolean;
  issues: SePayReadinessIssue[];
};

function value(env: NodeJS.ProcessEnv, key: string): string {
  return env[key]?.trim() ?? "";
}

function positiveInteger(
  raw: string,
  key: string,
  issues: SePayReadinessIssue[]
): number | null {
  if (!/^\d+$/.test(raw)) {
    issues.push({
      severity: "ERROR",
      code: key + "_INVALID",
      message: key + " must be a positive integer."
    });
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    issues.push({
      severity: "ERROR",
      code: key + "_INVALID",
      message: key + " must be a positive integer."
    });
    return null;
  }
  return parsed;
}

export function inspectSePayReadiness(
  env: NodeJS.ProcessEnv
): SePayReadinessReport {
  const issues: SePayReadinessIssue[] = [];

  if (value(env, "RENTER_PAYMENT_WEBHOOK_PROVIDER") !== "SEPAY") {
    issues.push({
      severity: "ERROR",
      code: "RENTER_PAYMENT_PROVIDER_NOT_SEPAY",
      message:
        "RENTER_PAYMENT_WEBHOOK_PROVIDER must be SEPAY for production cutover."
    });
  }

  const currentSecret = value(env, "SEPAY_RENTER_WEBHOOK_SECRET");
  if (currentSecret.length < 16) {
    issues.push({
      severity: "ERROR",
      code: "WEBHOOK_SECRET_MISSING",
      message:
        "SEPAY_RENTER_WEBHOOK_SECRET must contain at least 16 characters."
    });
  }

  const previousSecret = value(
    env,
    "SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS"
  );
  if (previousSecret.length > 0 && previousSecret.length < 16) {
    issues.push({
      severity: "ERROR",
      code: "WEBHOOK_PREVIOUS_SECRET_INVALID",
      message:
        "SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS must be empty or contain at least 16 characters."
    });
  }
  if (
    previousSecret.length > 0 &&
    currentSecret.length > 0 &&
    previousSecret === currentSecret
  ) {
    issues.push({
      severity: "ERROR",
      code: "WEBHOOK_ROTATION_SECRETS_EQUAL",
      message:
        "Current and previous SePay webhook secrets must differ."
    });
  }
  if (previousSecret.length > 0) {
    issues.push({
      severity: "WARNING",
      code: "WEBHOOK_ROTATION_OVERLAP_ACTIVE",
      message:
        "A previous webhook secret is still configured; remove it after cutover verification."
    });
  }

  const reconciliationEnabled =
    value(env, "SEPAY_RECONCILIATION_ENABLED").toLowerCase() === "true";

  if (reconciliationEnabled) {
    if (value(env, "SEPAY_API_TOKEN").length < 16) {
      issues.push({
        severity: "ERROR",
        code: "API_TOKEN_MISSING",
        message:
          "SEPAY_API_TOKEN must contain at least 16 characters when reconciliation is enabled."
      });
    }

    const baseUrl =
      value(env, "SEPAY_API_BASE_URL") || "https://userapi.sepay.vn/v2";
    let parsedUrl: URL | null = null;
    try {
      parsedUrl = new URL(baseUrl);
    } catch {
      issues.push({
        severity: "ERROR",
        code: "API_BASE_URL_INVALID",
        message: "SEPAY_API_BASE_URL must be a valid absolute URL."
      });
    }
    if (
      parsedUrl &&
      env.NODE_ENV === "production" &&
      parsedUrl.protocol !== "https:"
    ) {
      issues.push({
        severity: "ERROR",
        code: "API_BASE_URL_NOT_HTTPS",
        message: "SEPAY_API_BASE_URL must use HTTPS in production."
      });
    }

    const scope = value(env, "SEPAY_RECONCILIATION_SCOPE_KEY");
    if (!scope || scope === "default") {
      issues.push({
        severity: env.NODE_ENV === "production" ? "ERROR" : "WARNING",
        code: "RECONCILIATION_SCOPE_NOT_EXPLICIT",
        message:
          "SEPAY_RECONCILIATION_SCOPE_KEY should explicitly identify the upstream SePay transaction stream."
      });
    }

    const interval = positiveInteger(
      value(env, "SEPAY_RECONCILIATION_INTERVAL_MS") || "900000",
      "SEPAY_RECONCILIATION_INTERVAL_MS",
      issues
    );
    if (interval !== null && interval < 60000) {
      issues.push({
        severity: "WARNING",
        code: "RECONCILIATION_INTERVAL_AGGRESSIVE",
        message:
          "SePay reconciliation interval is below 60 seconds; verify provider rate limits before production."
      });
    }

    positiveInteger(
      value(env, "SEPAY_RECONCILIATION_INITIAL_LOOKBACK_HOURS") || "24",
      "SEPAY_RECONCILIATION_INITIAL_LOOKBACK_HOURS",
      issues
    );
  } else {
    issues.push({
      severity: "WARNING",
      code: "RECONCILIATION_DISABLED",
      message:
        "Periodic SePay API-v2 reconciliation is disabled; missed webhooks will not be recovered automatically."
    });
  }

  return {
    ready: !issues.some((issue) => issue.severity === "ERROR"),
    reconciliationEnabled,
    previousWebhookSecretConfigured: previousSecret.length > 0,
    issues
  };
}
