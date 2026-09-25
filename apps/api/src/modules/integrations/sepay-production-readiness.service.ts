import { Injectable } from "@nestjs/common";

export type SePayReadinessStatus = "PASS" | "WARN" | "FAIL";

export interface SePayReadinessCheck {
  code: string;
  status: SePayReadinessStatus;
  message: string;
}

export interface SePayWebhookReadinessView {
  ready: boolean;
  overlapConfigured: boolean;
  checks: SePayReadinessCheck[];
}

function value(name: string): string {
  return process.env[name]?.trim() ?? "";
}

@Injectable()
export class SePayProductionReadinessService {
  webhook(): SePayWebhookReadinessView {
    const current = value("SEPAY_RENTER_WEBHOOK_SECRET");
    const previous = value("SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS");
    const checks: SePayReadinessCheck[] = [];

    if (current.length < 16) {
      checks.push({
        code: "WEBHOOK_CURRENT_SECRET_INVALID",
        status: "FAIL",
        message:
          "Current SePay webhook secret is missing or shorter than 16 characters."
      });
    } else {
      checks.push({
        code: "WEBHOOK_CURRENT_SECRET_CONFIGURED",
        status: "PASS",
        message: "Current SePay webhook secret is configured."
      });
    }

    if (!previous) {
      checks.push({
        code: "WEBHOOK_ROTATION_OVERLAP_INACTIVE",
        status: "PASS",
        message: "No previous webhook secret is configured."
      });
    } else if (previous.length < 16) {
      checks.push({
        code: "WEBHOOK_PREVIOUS_SECRET_INVALID",
        status: "FAIL",
        message:
          "Previous SePay webhook secret is configured but shorter than 16 characters."
      });
    } else if (current && previous === current) {
      checks.push({
        code: "WEBHOOK_PREVIOUS_SECRET_EQUALS_CURRENT",
        status: "FAIL",
        message: "Previous and current SePay webhook secrets must differ."
      });
    } else {
      checks.push({
        code: "WEBHOOK_ROTATION_OVERLAP_ACTIVE",
        status: "WARN",
        message:
          "Previous webhook secret is active; remove it after the cutover window."
      });
    }

    return {
      ready: !checks.some((check) => check.status === "FAIL"),
      overlapConfigured: previous.length > 0,
      checks
    };
  }
}
