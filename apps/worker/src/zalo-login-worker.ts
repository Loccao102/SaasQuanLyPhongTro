import { chromium, type BrowserContext } from "playwright";
import { setTimeout as sleep } from "node:timers/promises";
import { InternalWorkerApiClient } from "./internal-api-client.js";
import { loadZaloPlaywrightConfig } from "./providers/zalo-playwright.config.js";
import { ZaloTenantVault } from "./providers/zalo-tenant-vault.js";

async function isChatReady(page: import("playwright").Page, selectors: readonly string[]) {
  for (const selector of selectors) {
    try {
      if (await page.locator(selector).first().isVisible()) return true;
    } catch { /* UI may be navigating. */ }
  }
  return false;
}

export async function runZaloLoginWorker(): Promise<void> {
  const api = new InternalWorkerApiClient();
  const vault = new ZaloTenantVault(process.env.ZALO_SESSION_MASTER_KEY_BASE64 ?? "");
  const config = loadZaloPlaywrightConfig({
    ...process.env,
    ZALO_SESSION_KEY_BASE64: process.env.ZALO_SESSION_MASTER_KEY_BASE64
  });
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  while (!stopping) {
    let request: Awaited<ReturnType<typeof api.zaloLoginClaim>> = null;
    try {
      request = await api.zaloLoginClaim();
      if (!request) {
        await sleep(2500);
        continue;
      }

      const browser = await chromium.launch({ headless: true });
      let context: BrowserContext | undefined;
      try {
        context = await browser.newContext({
          viewport: { width: 580, height: 720 },
          deviceScaleFactor: 1
        });
        const page = await context.newPage();
        await page.goto(config.baseUrl, {
          waitUntil: "domcontentloaded",
          timeout: config.navigationTimeoutMs
        });

        let nextScreenshotAt = 0;
        let connected = false;
        while (!stopping && Date.now() < new Date(request.expiresAt).getTime()) {
          const chatReady = await isChatReady(page, config.selectors.searchInputs);
          if (chatReady) {
            // Persist only AFTER a verifiable authenticated chat UI appears.
            const encryptedSession = vault.encrypt(
              request.organizationId, await context.storageState()
            );
            const result = await api.zaloLoginFinish(request.id, {
              status: "CONNECTED", encryptedSession
            });
            connected = result.ok;
            break;
          }

          // Authentication challenges require the user to act in their own
          // Zalo mobile app. Never try to bypass CAPTCHA or 2FA.
          if (Date.now() >= nextScreenshotAt) {
            // Prefer a lossless QR-only image for reliable phone scanning.
            // Zalo UI selectors can change; fallback to the compact login page.
            let qrImage = "";
            for (const selector of [
              '[class*="qr"] canvas',
              '[class*="qr"] img',
              'img[alt*="QR"]'
            ]) {
              const candidate = page.locator(selector).first();
              if (await candidate.isVisible().catch(() => false)) {
                const png = await candidate.screenshot({ type: "png" });
                const encoded = "data:image/png;base64," + png.toString("base64");
                if (encoded.length <= 90_000) {
                  qrImage = encoded;
                  break;
                }
              }
            }
            if (!qrImage) {
              const imageBytes = await page.screenshot({
                type: "jpeg", quality: 38, animations: "disabled"
              });
              qrImage = "data:image/jpeg;base64," + imageBytes.toString("base64");
            }
            if (qrImage.length <= 90_000) {
              const result = await api.zaloLoginProgress(request.id, qrImage);
              if (!result.ok) break; // User disconnected or request expired.
            }
            nextScreenshotAt = Date.now() + 5000;
          }
          await sleep(1500);
        }

        if (!connected) {
          await api.zaloLoginFinish(request.id, {
            status: "FAILED",
            errorMessage: stopping
              ? "Login worker stopped before completion."
              : "Zalo login expired or was cancelled."
          });
        }
      } finally {
        await context?.close().catch(() => {});
        await browser.close().catch(() => {});
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write("[zalo-login-worker] " + message + "\n");
      if (request) {
        await api.zaloLoginFinish(request.id, {
          status: "FAILED",
          errorMessage: "Unable to open Zalo login on the server. Check the worker logs."
        }).catch(() => {});
      }
      await sleep(3000);
    }
  }
}
