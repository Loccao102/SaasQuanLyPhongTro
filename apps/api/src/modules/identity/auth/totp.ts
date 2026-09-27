import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

export type EncryptedTotpSecret = {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
};

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpProvisioningUri(input: {
  secret: string;
  email: string;
  issuer?: string;
}): string {
  const issuer = input.issuer?.trim() || "Habi";
  const label = encodeURIComponent(issuer + ":" + input.email);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS)
  });
  return "otpauth://totp/" + label + "?" + params.toString();
}

export function verifyTotpCode(
  secret: string,
  code: string,
  now = Date.now()
): boolean {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;

  const counter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
  for (const offset of [-1, 0, 1]) {
    const expected = totpCode(secret, counter + offset);
    const left = Buffer.from(expected, "utf8");
    const right = Buffer.from(normalized, "utf8");
    if (left.length === right.length && timingSafeEqual(left, right)) {
      return true;
    }
  }
  return false;
}

export function encryptTotpSecret(secret: string): EncryptedTotpSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", totpEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final()
  ]);
  return {
    ciphertext,
    iv,
    tag: cipher.getAuthTag()
  };
}

export function decryptTotpSecret(
  encrypted: EncryptedTotpSecret
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    totpEncryptionKey(),
    encrypted.iv
  );
  decipher.setAuthTag(encrypted.tag);
  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final()
  ]).toString("utf8");
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const value = randomBytes(8).toString("hex").toUpperCase();
    return "HABI-" + value.slice(0, 4) + "-" + value.slice(4, 8) +
      "-" + value.slice(8, 12) + "-" + value.slice(12, 16);
  });
}

export function hashRecoveryCode(code: string): Buffer {
  return createHash("sha256")
    .update(normalizeRecoveryCode(code), "utf8")
    .digest();
}

export function looksLikeRecoveryCode(code: string): boolean {
  return /^HABI-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/i.test(
    code.trim()
  );
}

function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase();
}

function totpCode(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const value = Buffer.alloc(8);
  value.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", key).update(value).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function base32Encode(value: Buffer): string {
  let bits = 0;
  let current = 0;
  let output = "";

  for (const byte of value) {
    current = (current << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(current >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(current << (5 - bits)) & 31]!;
  }
  return output;
}

function base32Decode(value: string): Buffer {
  let bits = 0;
  let current = 0;
  const output: number[] = [];

  for (const character of value.toUpperCase().replace(/=+$/g, "")) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Invalid TOTP secret encoding.");
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((current >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

function totpEncryptionKey(): Buffer {
  const configured = process.env.AUTH_TOTP_ENCRYPTION_KEY?.trim();
  if (configured) {
    const key = Buffer.from(configured, "base64");
    if (key.length === 32) return key;
    throw new Error(
      "AUTH_TOTP_ENCRYPTION_KEY must be a base64-encoded 32-byte key."
    );
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_TOTP_ENCRYPTION_KEY is required when MFA is used in production."
    );
  }

  return createHash("sha256")
    .update("habi-development-totp-encryption-key")
    .digest();
}
