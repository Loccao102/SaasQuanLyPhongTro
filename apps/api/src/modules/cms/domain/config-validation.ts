export type SettingValueType = "BOOLEAN" | "INTEGER" | "STRING" | "JSON";

export class CmsConfigValidationError extends Error {}

export function validateSettingValue(
  type: SettingValueType,
  value: unknown
): void {
  switch (type) {
    case "BOOLEAN":
      if (typeof value !== "boolean") {
        throw new CmsConfigValidationError("Expected a boolean value.");
      }
      return;
    case "INTEGER":
      if (!Number.isInteger(value) || Number(value) < 0) {
        throw new CmsConfigValidationError(
          "Expected a non-negative integer value."
        );
      }
      return;
    case "STRING":
      if (typeof value !== "string") {
        throw new CmsConfigValidationError("Expected a string value.");
      }
      return;
    case "JSON":
      return;
  }
}

export interface PlanConfigInput {
  monthlyPriceVnd: number;
  roomLimit: number;
  staffLimit: number;
  automationQuota: number;
}

export function validatePlanConfig(input: PlanConfigInput): void {
  const integerFields: Array<[string, number]> = [
    ["monthlyPriceVnd", input.monthlyPriceVnd],
    ["roomLimit", input.roomLimit],
    ["staffLimit", input.staffLimit],
    ["automationQuota", input.automationQuota]
  ];

  for (const [name, value] of integerFields) {
    if (!Number.isInteger(value) || value < 0) {
      throw new CmsConfigValidationError(
        name + " must be a non-negative integer."
      );
    }
  }

  if (input.roomLimit < 1 || input.staffLimit < 1) {
    throw new CmsConfigValidationError(
      "roomLimit and staffLimit must be at least 1."
    );
  }
}
