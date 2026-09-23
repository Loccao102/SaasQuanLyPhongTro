import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type EncryptedEnvelope = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
};

export class EncryptedStorageStateStore {
  private readonly key: Buffer;

  constructor(
    private readonly filePath: string,
    keyBase64: string
  ) {
    this.key = Buffer.from(keyBase64, "base64");
    if (this.key.length !== 32) {
      throw new Error("Encrypted session key must be exactly 32 bytes.");
    }
  }

  async load(): Promise<unknown | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }

    const envelope = JSON.parse(raw) as EncryptedEnvelope;
    if (
      envelope.version !== 1 ||
      envelope.algorithm !== "aes-256-gcm" ||
      !envelope.iv ||
      !envelope.tag ||
      !envelope.ciphertext
    ) {
      throw new Error("Encrypted Zalo session file has an invalid envelope.");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(envelope.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final()
    ]);

    return JSON.parse(plaintext.toString("utf8")) as unknown;
  }

  async save(storageState: unknown): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(storageState), "utf8");
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final()
    ]);
    const envelope: EncryptedEnvelope = {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };

    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath =
      this.filePath + ".tmp-" + process.pid + "-" + Date.now();
    await writeFile(temporaryPath, JSON.stringify(envelope), {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, this.filePath);
  }
}

export class ExclusiveSessionFileLock {
  private handle: Awaited<ReturnType<typeof open>> | null = null;

  constructor(
    private readonly lockPath: string,
    private readonly staleAfterMs = 5 * 60 * 1000
  ) {}

  async acquire(): Promise<boolean> {
    await mkdir(dirname(this.lockPath), { recursive: true, mode: 0o700 });

    try {
      this.handle = await open(this.lockPath, "wx", 0o600);
      await this.handle.writeFile(
        JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })
      );
      return true;
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        (error as { code?: string }).code !== "EEXIST"
      ) {
        throw error;
      }
    }

    try {
      const metadata = await stat(this.lockPath);
      if (Date.now() - metadata.mtimeMs > this.staleAfterMs) {
        await unlink(this.lockPath);
        this.handle = await open(this.lockPath, "wx", 0o600);
        await this.handle.writeFile(
          JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })
        );
        return true;
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        return this.acquire();
      }
      throw error;
    }

    return false;
  }

  async release(): Promise<void> {
    try {
      await this.handle?.close();
    } finally {
      this.handle = null;
      try {
        await unlink(this.lockPath);
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          (error as { code?: string }).code !== "ENOENT"
        ) {
          throw error;
        }
      }
    }
  }
}
