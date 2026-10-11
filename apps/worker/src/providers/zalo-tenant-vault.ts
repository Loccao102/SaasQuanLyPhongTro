import {
  createCipheriv, createDecipheriv, createHash, randomBytes
} from "node:crypto";

/**
 * Browser storageState encrypted before crossing into the API/database.
 * The organization UUID is authenticated as AES-GCM AAD, preventing
 * ciphertext from one tenant being accepted for another.
 */
export class ZaloTenantVault {
  private readonly master: Buffer;

  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, "base64");
    if (key.length !== 32) {
      throw new Error("ZALO_SESSION_MASTER_KEY_BASE64 must decode to 32 bytes.");
    }
    this.master = key;
  }

  private keyFor(orgId: string): Buffer {
    return createHash("sha256")
      .update("Habi Zalo tenant vault v1\0")
      .update(this.master)
      .update(orgId)
      .digest();
  }

  encrypt(orgId: string, storageState: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.keyFor(orgId), iv);
    cipher.setAAD(Buffer.from("habi:zalo:tenant:" + orgId));
    const plaintext = Buffer.from(JSON.stringify(storageState), "utf8");
    if (plaintext.length > 500_000) throw new Error("Zalo session exceeds maximum size.");
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return JSON.stringify({
      v: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64")
    });
  }

  decrypt(orgId: string, encryptedSession: string): unknown {
    const envelope = JSON.parse(encryptedSession) as {
      v: number; iv: string; tag: string; data: string;
    };
    if (envelope.v !== 1 || typeof envelope.iv !== "string" ||
        typeof envelope.tag !== "string" || typeof envelope.data !== "string") {
      throw new Error("Invalid encrypted Zalo session.");
    }
    const iv = Buffer.from(envelope.iv, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid Zalo session nonce.");
    const decipher = createDecipheriv("aes-256-gcm", this.keyFor(orgId), iv);
    decipher.setAAD(Buffer.from("habi:zalo:tenant:" + orgId));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final()
    ]);
    return JSON.parse(plaintext.toString("utf8")) as unknown;
  }
}
