import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const PASSWORD_SCRYPT_N = 2 ** 17;
export const PASSWORD_SCRYPT_R = 8;
export const PASSWORD_SCRYPT_P = 1;
export const PASSWORD_KEY_LENGTH = 64;
export const PASSWORD_SALT_LENGTH = 16;
export const PASSWORD_MAX_BYTES = 1024;
export const PASSWORD_MIN_BYTES = 12;
const PASSWORD_SCRYPT_MAXMEM = 192 * 1024 * 1024;

export interface PasswordCredential {
  hash: Buffer;
  salt: Buffer;
  n: number;
  r: number;
  p: number;
}

export class InvalidPasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPasswordPolicyError";
  }
}

function passwordBytes(password: string): Buffer {
  return Buffer.from(password, "utf8");
}

function assertPasswordLengthForSet(password: string): void {
  const bytes = passwordBytes(password).byteLength;

  if (bytes < PASSWORD_MIN_BYTES) {
    throw new InvalidPasswordPolicyError(
      `Password must contain at least ${PASSWORD_MIN_BYTES} UTF-8 bytes.`
    );
  }

  if (bytes > PASSWORD_MAX_BYTES) {
    throw new InvalidPasswordPolicyError(
      `Password must not exceed ${PASSWORD_MAX_BYTES} UTF-8 bytes.`
    );
  }
}

function canVerifyPassword(password: string): boolean {
  const bytes = passwordBytes(password).byteLength;
  return bytes > 0 && bytes <= PASSWORD_MAX_BYTES;
}

async function derive(
  password: string,
  credential: Pick<PasswordCredential, "salt" | "n" | "r" | "p">
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      credential.salt,
      PASSWORD_KEY_LENGTH,
      {
        N: credential.n,
        r: credential.r,
        p: credential.p,
        maxmem: PASSWORD_SCRYPT_MAXMEM
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      }
    );
  });
}

export async function hashPassword(
  password: string
): Promise<PasswordCredential> {
  assertPasswordLengthForSet(password);

  const credential: PasswordCredential = {
    hash: Buffer.alloc(PASSWORD_KEY_LENGTH),
    salt: randomBytes(PASSWORD_SALT_LENGTH),
    n: PASSWORD_SCRYPT_N,
    r: PASSWORD_SCRYPT_R,
    p: PASSWORD_SCRYPT_P
  };

  credential.hash = await derive(password, credential);
  return credential;
}

export async function verifyPassword(
  password: string,
  credential: PasswordCredential
): Promise<boolean> {
  if (!canVerifyPassword(password)) {
    return false;
  }

  const candidate = await derive(password, credential);

  if (candidate.byteLength !== credential.hash.byteLength) {
    return false;
  }

  return timingSafeEqual(candidate, credential.hash);
}
