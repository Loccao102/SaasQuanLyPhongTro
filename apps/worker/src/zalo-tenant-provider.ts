import { join } from "node:path";
import type { NotificationProvider, ClaimedNotificationJob, NotificationProviderResult } from "./notification-types.js";
import { InternalWorkerApiClient } from "./internal-api-client.js";
import { ZaloPlaywrightProvider } from "./providers/zalo-playwright.provider.js";
import { loadZaloPlaywrightConfig } from "./providers/zalo-playwright.config.js";
import { ExclusiveSessionFileLock } from "./providers/zalo-session-store.js";
import { ZaloTenantVault } from "./providers/zalo-tenant-vault.js";

/**
 * Every claimed job is bound by the API to its own organization_id.
 * The remote store retrieves ONLY that job's tenant ciphertext and
 * decrypts it using an authenticated tenant-specific key/AAD.
 */
export class ZaloTenantProvider implements NotificationProvider {
  readonly name = "PLAYWRIGHT_ZALO";
  readonly claimAliases = ["ZALO_PLAYWRIGHT"] as const;
  private readonly vault: ZaloTenantVault;
  private readonly api = new InternalWorkerApiClient();

  constructor() {
    this.vault = new ZaloTenantVault(process.env.ZALO_SESSION_MASTER_KEY_BASE64 ?? "");
  }

  async send(job: ClaimedNotificationJob): Promise<NotificationProviderResult> {
    const config = loadZaloPlaywrightConfig({
      ...process.env,
      ZALO_SESSION_KEY_BASE64: process.env.ZALO_SESSION_MASTER_KEY_BASE64
    });
    const lockRoot = process.env.ZALO_SESSION_LOCK_DIR?.trim() || ".runtime-secrets/zalo/locks";
    const lock = new ExclusiveSessionFileLock(join(lockRoot, job.organizationId + ".lock"));
    const vault = this.vault;
    const api = this.api;
    const store = {
      async load() {
        const remote = await api.zaloPersonalSession(job.id);
        if (!remote || remote.organizationId !== job.organizationId) return undefined;
        return vault.decrypt(job.organizationId, remote.encryptedSession);
      },
      async save(value: unknown) {
        const result = await api.zaloPersonalSaveSession(
          job.id, vault.encrypt(job.organizationId, value)
        );
        if (!result.ok) throw new Error("Zalo tenant session was disconnected during delivery.");
      }
    };
    const provider = ZaloPlaywrightProvider.withStorage(config, store, lock);
    try {
      return await provider.send(job);
    } finally {
      await provider.close();
    }
  }
}
