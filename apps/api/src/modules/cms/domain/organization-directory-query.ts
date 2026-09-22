import { BadRequestException } from "@nestjs/common";

export type OrganizationDirectoryCursor = {
  createdAt: string;
  id: string;
};

export type OrganizationDirectoryFilters = {
  query: string;
  plan: string;
  subscriptionStatus: string;
  organizationStatus: string;
  delinquent: boolean | null;
  overLimit: boolean | null;
  limit: number;
  cursor: OrganizationDirectoryCursor | null;
};

function optionalBoolean(value: string | undefined, name: string): boolean | null {
  if (value === undefined || value.trim() === "") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new BadRequestException(name + " must be true or false.");
}

export function decodeOrganizationDirectoryCursor(
  value: string | undefined
): OrganizationDirectoryCursor | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Partial<OrganizationDirectoryCursor>;

    if (
      typeof parsed.createdAt !== "string" ||
      Number.isNaN(new Date(parsed.createdAt).getTime()) ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0
    ) {
      throw new Error("invalid cursor");
    }

    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new BadRequestException("Invalid organization cursor.");
  }
}

export function encodeOrganizationDirectoryCursor(
  cursor: OrganizationDirectoryCursor
): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function normalizeOrganizationDirectoryFilters(input: {
  query?: string;
  plan?: string;
  subscriptionStatus?: string;
  organizationStatus?: string;
  delinquent?: string;
  overLimit?: string;
  limit?: string;
  cursor?: string;
}): OrganizationDirectoryFilters {
  const limitValue = input.limit === undefined ? 25 : Number(input.limit);

  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) {
    throw new BadRequestException("limit must be an integer between 1 and 100.");
  }

  return {
    query: input.query?.trim().slice(0, 200) ?? "",
    plan: input.plan?.trim().slice(0, 100) ?? "",
    subscriptionStatus: input.subscriptionStatus?.trim().slice(0, 50) ?? "",
    organizationStatus: input.organizationStatus?.trim().slice(0, 50) ?? "",
    delinquent: optionalBoolean(input.delinquent, "delinquent"),
    overLimit: optionalBoolean(input.overLimit, "overLimit"),
    limit: limitValue,
    cursor: decodeOrganizationDirectoryCursor(input.cursor)
  };
}
