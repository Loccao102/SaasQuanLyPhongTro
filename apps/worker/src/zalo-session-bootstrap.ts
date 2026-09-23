import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium, type BrowserContextOptions } from "playwright";
import { loadZaloPlaywrightConfig } from "./providers/zalo-playwright.config.js";
import { EncryptedStorageStateStore } from "./providers/zalo-session-store.js";

async function main(): Promise<void> {
  const config = loadZaloPlaywrightConfig();
  const store = new EncryptedStorageStateStore(
    config.sessionPath,
    config.sessionKeyBase64
  );
  const existing = await store.load();

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(
    existing
      ? {
          storageState:
            existing as BrowserContextOptions["storageState"]
        }
      : undefined
  );
  const page = await context.newPage();

  try {
    await page.goto(config.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.navigationTimeoutMs
    });

    const readline = createInterface({ input, output });
    try {
      output.write(
        "\n[zalo-session] Complete Zalo login in the opened browser.\n" +
          "[zalo-session] Verify the expected account and close any CAPTCHA/security prompts.\n" +
          "[zalo-session] Press ENTER here only after the chat UI is fully available.\n"
      );
      await readline.question("");
    } finally {
      readline.close();
    }

    await store.save(await context.storageState());
    output.write(
      "[zalo-session] Encrypted storage state saved to " +
        config.sessionPath +
        ".\n"
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

void main();
