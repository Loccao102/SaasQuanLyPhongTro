import { BadRequestException } from "@nestjs/common";

export type GlobalSearchInput = {
  query: string;
  limit: number;
};

export function normalizeGlobalSearchInput(input: {
  query?: string;
  limit?: string;
}): GlobalSearchInput {
  const query = input.query?.trim() ?? "";
  if (query.length < 2) {
    throw new BadRequestException(
      "Global search query must contain at least 2 characters."
    );
  }
  if (query.length > 200) {
    throw new BadRequestException(
      "Global search query must contain at most 200 characters."
    );
  }

  const limit = input.limit === undefined ? 8 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new BadRequestException(
      "Global search limit must be an integer between 1 and 20."
    );
  }

  return { query, limit };
}
