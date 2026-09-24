import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_MIN_LENGTH = 32;
const TOKEN_MAX_LENGTH = 256;

export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashOpaqueToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function safeTokenHash(token: string | undefined): Buffer | null {
  if (
    !token ||
    token.length < TOKEN_MIN_LENGTH ||
    token.length > TOKEN_MAX_LENGTH
  ) {
    return null;
  }

  return hashOpaqueToken(token);
}

export function tokenMatchesHash(
  token: string | undefined,
  expectedHash: Buffer
): boolean {
  const actualHash = safeTokenHash(token);

  if (!actualHash || actualHash.byteLength !== expectedHash.byteLength) {
    return false;
  }

  return timingSafeEqual(actualHash, expectedHash);
}
