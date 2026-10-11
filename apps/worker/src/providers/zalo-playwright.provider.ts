import {
  chromium,
  errors,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page
} from "playwright";
import type {
  ClaimedNotificationJob,
  NotificationProvider,
  NotificationProviderResult
} from "../notification-types.js";
import {
  loadZaloPlaywrightConfig,
  type ZaloPlaywrightConfig
} from "./zalo-playwright.config.js";
import {
  EncryptedStorageStateStore,
  ExclusiveSessionFileLock
} from "./zalo-session-store.js";

function evidence(
  job: ClaimedNotificationJob,
  stage: string,
  extra: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  return {
    jobId: job.id,
    attemptNumber: job.attemptNumber,
    stage,
    messageLength: job.messageBody.length,
    ...extra
  };
}

export function existingDeliveryReplayResult(
  job: ClaimedNotificationJob,
  visibleExactMatches: number
): NotificationProviderResult | null {
  if (
    !job.deliveryReplayCheckRequired ||
    !Number.isInteger(visibleExactMatches) ||
    visibleExactMatches < 1
  ) {
    return null;
  }

  return {
    kind: "SENT_CONFIRMED",
    recipientVerified: true,
    sendVerified: true,
    providerReference: null,
    evidence: evidence(job, "pre-send-replay-detected", {
      visibleExactMatches,
      recipientVerification: "display-name-exact",
      postSendVerification: "existing-message-bubble-exact"
    })
  };
}

async function firstVisible(
  page: Page,
  selectors: readonly string[],
  timeoutMs: number
): Promise<Locator | null> {
  // Poll selectors together rather than spending the entire timeout on
  // a hidden or obsolete element while the Zalo SPA is still rendering.
  const deadline = Date.now() + timeoutMs;
  do {
    for (const selector of selectors) {
      try {
        const locator = page.locator(selector);
        for (let index = 0, n = Math.min(await locator.count(), 12); index < n; index += 1) {
          const candidate = locator.nth(index);
          if (await candidate.isVisible()) return candidate;
        }
      } catch {
        // The DOM can change during navigation.
      }
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await page.waitForTimeout(Math.min(250, remaining));
  } while (Date.now() < deadline);
  return null;
}

export function normalizeZaloRecipientPhone(value: string): string | null {
  const input = value.replace(/[\s().-]/g, "");
  if (/^0[35789]\d{8}$/.test(input)) return input;
  if (/^(?:\+84|84)[35789]\d{8}$/.test(input)) {
    return "0" + input.replace(/^\+?84/, "");
  }
  return null;
}

type RecipientCandidate = {
  first: Locator | null;
  count: number;
  verification: "display-name-exact" | "phone-text-exact" | "phone-search-unique";
  expectedName: string | null;
};

async function findRecipientCandidate(
  page: Page,
  name: string | null,
  phone: string
): Promise<RecipientCandidate> {
  if (name) {
    const found = await visibleExactTextCount(page, name);
    return { ...found, verification: "display-name-exact", expectedName: name };
  }

  // Exact phone displayed in the search result is preferred.
  for (const value of [phone, "84" + phone.slice(1), "+84" + phone.slice(1)]) {
    const found = await visibleExactTextCount(page, value);
    if (found.count) {
      return { ...found, verification: "phone-text-exact", expectedName: null };
    }
  }

  // Some Zalo versions expose a contact card without showing its phone.
  // Select only ONE visible card in the phone-search results, never the
  // first arbitrary conversation or free-text suggestion.
  const selectors = [
    '[data-testid="contact-search-result"]',
    '[data-testid="user-search-result"]',
    '[role="listbox"] [role="option"]',
    '.search-result .friend-item',
    '.search-result .user-item',
    '.search-result__item',
    '.search-result-item',
    '.list-search-result .item'
  ];
  for (const selector of selectors) {
    const entries = page.locator(selector);
    const visible: Locator[] = [];
    for (let i = 0, n = Math.min(await entries.count(), 20); i < n; i += 1) {
      const entry = entries.nth(i);
      if (await entry.isVisible()) visible.push(entry);
    }
    if (!visible.length) continue;
    const displayName = visible.length === 1
      ? (await visible[0]!.innerText()).split("\n")
          .map((part) => part.trim())
          .find((part) => part.length > 1 && part.length <= 100 &&
            part !== phone && !/^(Kết bạn|Nhắn tin|Add friend|Message)$/i.test(part)) ?? null
      : null;
    return {
      first: displayName && visible.length === 1 ? visible[0]! : null,
      count: visible.length,
      verification: "phone-search-unique",
      expectedName: displayName
    };
  }
  return { first: null, count: 0, verification: "phone-search-unique", expectedName: null };
}

async function searchInputDiagnostics(page: Page): Promise<Record<string, unknown>> {
  // Field metadata only: do not log input values, phone numbers or message bodies.
  try {
    const inputHints = await page.locator("input, [role='searchbox']").evaluateAll(
      (elements) => elements.slice(0, 16).map((element) => ({
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute("type"),
        id: (element.id || "").slice(0, 60),
        placeholder: (element.getAttribute("placeholder") || "").slice(0, 80),
        ariaLabel: (element.getAttribute("aria-label") || "").slice(0, 80)
      }))
    );
    return { pageHost: new URL(page.url()).hostname, inputHints };
  } catch {
    return { inputDiagnosticUnavailable: true };
  }
}

async function anyVisible(
  page: Page,
  selectors: readonly string[],
  timeoutMs: number
): Promise<boolean> {
  return (await firstVisible(page, selectors, timeoutMs)) !== null;
}

async function visibleExactTextCount(
  page: Page,
  text: string,
  limit = 20
): Promise<{ count: number; first: Locator | null }> {
  const locator = page.getByText(text, { exact: true });
  const total = Math.min(await locator.count(), limit);
  let count = 0;
  let first: Locator | null = null;

  for (let index = 0; index < total; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) {
      count += 1;
      first ??= candidate;
    }
  }

  return { count, first };
}

async function editorText(locator: Locator): Promise<string> {
  const tagName = await locator.evaluate((element) => element.tagName.toLowerCase());
  if (tagName === "textarea" || tagName === "input") {
    return locator.inputValue();
  }
  return (await locator.textContent()) ?? "";
}

export interface ZaloStorageStatePort {
  load(): Promise<unknown | undefined>;
  save(value: unknown): Promise<void>;
}

export interface ZaloSessionLockPort {
  acquire(): Promise<boolean>;
  release(): Promise<void>;
}

export interface ZaloMonitorPort {
  enabled(job: ClaimedNotificationJob): Promise<{ watching: boolean }>;
  publish(
    job: ClaimedNotificationJob,
    input: { stage: string; image: string | null; errorCode?: string | null }
  ): Promise<{ ok: boolean }>;
}

export class ZaloPlaywrightProvider implements NotificationProvider {
  readonly name = "PLAYWRIGHT_ZALO";
  readonly claimAliases = ["ZALO_PLAYWRIGHT"] as const;

  private browser: Browser | null = null;
  private monitorPort: ZaloMonitorPort | null = null;

  setMonitorPort(monitor: ZaloMonitorPort): void {
    this.monitorPort = monitor;
  }

  private async captureForMonitor(
    job: ClaimedNotificationJob,
    stage: string,
    page: Page | null,
    errorCode?: string
  ): Promise<void> {
    if (!this.monitorPort) return;
    try {
      const { watching } = await this.monitorPort.enabled(job);
      if (!watching) return;
      let image: string | null = null;
      if (page && !page.isClosed()) {
        // Short-lived read-only debug frames. Never log, save to disk, or
        // attach to durable notification evidence.
        try {
          let jpeg = await page.screenshot({
            type: "jpeg",
            quality: 35,
            animations: "disabled",
            timeout: 1800
          });
          if (jpeg.length > 135_000) {
            jpeg = await page.screenshot({
              type: "jpeg", quality: 18, animations: "disabled", timeout: 1800
            });
          }
          const base64 = jpeg.toString("base64");
          if (base64.length <= 199_950) {
            image = "data:image/jpeg;base64," + base64;
          }
        } catch {
          // The page may be navigating; stage/error info is still useful.
        }
      }
      await this.monitorPort.publish(job, { stage, image, errorCode });
    } catch {
      // Diagnostic transport must never block or change a delivery outcome.
    }
  }

  private constructor(
    private readonly config: ZaloPlaywrightConfig,
    private readonly sessionStore: ZaloStorageStatePort,
    private readonly sessionLock: ZaloSessionLockPort
  ) {}

  private async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      const channel =
        process.env.PLAYWRIGHT_CHANNEL ||
        (process.platform === "win32" ? "chrome" : undefined);
      this.browser = await chromium.launch({
        headless: this.config.headless,
        channel
      });
    }
    return this.browser;
  }

  async close(): Promise<void> {
    if (this.browser) {
      try {
        if (this.browser.isConnected()) {
          await this.browser.close();
        }
      } catch {
        // Suppress cleanup error on shutdown
      } finally {
        this.browser = null;
      }
    }
  }

  static fromEnvironment(
    env: NodeJS.ProcessEnv = process.env
  ): ZaloPlaywrightProvider {
    const config = loadZaloPlaywrightConfig(env);
    return new ZaloPlaywrightProvider(
      config,
      new EncryptedStorageStateStore(
        config.sessionPath,
        config.sessionKeyBase64
      ),
      new ExclusiveSessionFileLock(config.lockPath)
    );
  }

  static withStorage(
    config: ZaloPlaywrightConfig,
    store: ZaloStorageStatePort,
    lock: ZaloSessionLockPort
  ): ZaloPlaywrightProvider {
    return new ZaloPlaywrightProvider(config, store, lock);
  }

  async send(
    job: ClaimedNotificationJob
  ): Promise<NotificationProviderResult> {
    if (job.channel.toUpperCase() !== "ZALO") {
      return {
        kind: "PERMANENT_FAILURE",
        errorCode: "CHANNEL_UNSUPPORTED",
        errorMessage: "ZALO_PLAYWRIGHT can only deliver ZALO jobs.",
        evidence: evidence(job, "validate-channel")
      };
    }

    const recipientName = job.recipientDisplayName?.trim() || null;
    const recipientPhone = normalizeZaloRecipientPhone(job.recipientKey);
    if (!recipientPhone) {
      return {
        kind: "MANUAL_REVIEW",
        errorCode: "RECIPIENT_PHONE_INVALID",
        errorMessage: "A valid Vietnamese recipient phone is required for Zalo lookup.",
        evidence: evidence(job, "validate-recipient-phone")
      };
    }

    const acquired = await this.sessionLock.acquire();
    if (!acquired) {
      return {
        kind: "TRANSIENT_FAILURE",
        errorCode: "SESSION_BUSY",
        errorMessage:
          "Another Zalo worker is currently using the encrypted browser session.",
        evidence: evidence(job, "session-lock")
      };
    }

    let context: BrowserContext | null = null;
    let sendActionAttempted = false;
    let monitorPage: Page | null = null;
    let monitorStage = "INITIALIZING";
    let monitorTimer: ReturnType<typeof setInterval> | null = null;
    let monitorBusy = false;
    let monitorChain: Promise<void> = Promise.resolve();
    const monitorCapture = (stage = monitorStage, errorCode?: string): Promise<void> => {
      monitorChain = monitorChain
        .catch(() => {})
        .then(() => this.captureForMonitor(job, stage, monitorPage, errorCode));
      return monitorChain;
    };
    try {
      let storageState: unknown | undefined;
      try {
        storageState = await this.sessionStore.load();
      } catch (error) {
        return {
          kind: "UNKNOWN",
          errorCode: "SESSION_STORAGE_ERROR",
          errorMessage:
            error instanceof Error
              ? error.message
              : "Encrypted Zalo session could not be loaded.",
          evidence: evidence(job, "load-session")
        };
      }

      if (!storageState) {
        return {
          kind: "MANUAL_REVIEW",
          errorCode: "ZALO_SESSION_NOT_CONNECTED",
          errorMessage: "This tenant has no connected Zalo Personal session.",
          evidence: evidence(job, "tenant-session-required")
        };
      }

      const browser = await this.getBrowser();

      try {
        context = await browser.newContext(
          storageState
            ? { storageState: storageState as BrowserContextOptions["storageState"] }
            : undefined
        );
        const page = await context.newPage();
        monitorPage = page;
        monitorStage = "OPENING_ZALO";
        // Periodic screenshots only when an authenticated admin opted in.
        monitorTimer = setInterval(() => {
          if (monitorBusy) return;
          monitorBusy = true;
          void monitorCapture().finally(() => { monitorBusy = false; });
        }, 2500);
        void monitorCapture();
        page.setDefaultTimeout(this.config.selectorTimeoutMs);
        page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);

        await page.goto(this.config.baseUrl, {
          waitUntil: "domcontentloaded",
          timeout: this.config.navigationTimeoutMs
        });

        monitorStage = "WAITING_FOR_SEARCH";
        const blocker = await this.detectBlocker(page, job);
        if (blocker) return blocker;

        const searchInput = await firstVisible(
          page,
          this.config.selectors.searchInputs,
          Math.min(15000, this.config.navigationTimeoutMs)
        );
        if (!searchInput) {
          monitorStage = "SEARCH_INPUT_NOT_FOUND";
          await monitorCapture(monitorStage, "PROVIDER_UI_BROKEN");
          const lateBlocker = await this.detectBlocker(page, job);
          if (lateBlocker) return lateBlocker;
          return {
            kind: "UNKNOWN",
            errorCode: "PROVIDER_UI_BROKEN",
            errorMessage: "Zalo recipient search input was not found.",
            evidence: evidence(job, "find-search-input", await searchInputDiagnostics(page))
          };
        }

        monitorStage = "SEARCHING_PHONE";
        await searchInput.fill(recipientPhone);
        let recipientMatches = await findRecipientCandidate(page, recipientName, recipientPhone);
        for (let i = 0; i < 5 && recipientMatches.count === 0; i += 1) {
          await page.waitForTimeout(700);
          recipientMatches = await findRecipientCandidate(page, recipientName, recipientPhone);
        }
        if (recipientMatches.count === 0) {
          // Certain Zalo builds only search by phone after pressing Enter.
          await searchInput.press("Enter");
          for (let i = 0; i < 4 && recipientMatches.count === 0; i += 1) {
            await page.waitForTimeout(700);
            recipientMatches = await findRecipientCandidate(page, recipientName, recipientPhone);
          }
        }

        if (recipientMatches.count > 1) {
          monitorStage = "RECIPIENT_AMBIGUOUS";
          await monitorCapture(monitorStage, "RECIPIENT_AMBIGUOUS");
          return {
            kind: "MANUAL_REVIEW",
            errorCode: "RECIPIENT_AMBIGUOUS",
            errorMessage: "Multiple results were found for this phone. Refusing to pick one.",
            evidence: evidence(job, "verify-recipient-search", {
              visibleMatches: recipientMatches.count
            })
          };
        }
        if (!recipientMatches.first || recipientMatches.count !== 1) {
          monitorStage = "RECIPIENT_NOT_FOUND";
          await monitorCapture(monitorStage, "RECIPIENT_NOT_FOUND");
          return {
            kind: "MANUAL_REVIEW",
            errorCode: "RECIPIENT_NOT_FOUND",
            errorMessage: "A uniquely verifiable Zalo recipient could not be found by phone.",
            evidence: evidence(job, "verify-recipient-search", {
              visibleMatches: recipientMatches.count,
              verificationMode: recipientMatches.verification
            })
          };
        }
        monitorStage = "OPENING_CHAT";
        await recipientMatches.first.click();

        const editor = await firstVisible(
          page,
          this.config.selectors.messageEditors,
          this.config.selectorTimeoutMs
        );
        if (!editor) {
          monitorStage = "MESSAGE_EDITOR_NOT_FOUND";
          await monitorCapture(monitorStage, "PROVIDER_UI_BROKEN");
          const postClickBlocker = await this.detectBlocker(page, job);
          if (postClickBlocker) return postClickBlocker;

          return {
            kind: "UNKNOWN",
            errorCode: "PROVIDER_UI_BROKEN",
            errorMessage:
              "Zalo conversation opened without a detectable message editor.",
            evidence: evidence(job, "find-message-editor")
          };
        }

        if (recipientMatches.expectedName) {
          const conversationMatches = await visibleExactTextCount(
            page,
            recipientMatches.expectedName
          );
          if (conversationMatches.count < 1) {
            return {
              kind: "MANUAL_REVIEW",
              errorCode: "RECIPIENT_VERIFICATION_FAILED",
              errorMessage: "Conversation did not match the selected search result.",
              evidence: evidence(job, "verify-open-conversation")
            };
          }
        }

        if (job.deliveryReplayCheckRequired) {
          const existingDelivery = await visibleExactTextCount(
            page,
            job.messageBody
          );
          const replayResult = existingDeliveryReplayResult(
            job,
            existingDelivery.count
          );
          if (replayResult) {
            return replayResult;
          }
        }

        monitorStage = "PREPARING_MESSAGE";
        await editor.fill(job.messageBody);

        const sendButton = await firstVisible(
          page,
          this.config.selectors.sendButtons,
          Math.min(1500, this.config.selectorTimeoutMs)
        );
        monitorStage = "SENDING_MESSAGE";
        sendActionAttempted = true;
        if (sendButton) {
          await sendButton.click();
        } else {
          await editor.press("Enter");
        }

        monitorStage = "VERIFYING_DELIVERY";
        const postSendBlocker = await this.detectBlocker(page, job);
        if (postSendBlocker) return postSendBlocker;

        const remainingEditorText = (await editorText(editor)).trim();
        if (remainingEditorText === job.messageBody.trim()) {
          return {
            kind: "UNKNOWN",
            errorCode: "SEND_UNVERIFIED",
            errorMessage:
              "Message remained in the editor after the send action.",
            evidence: evidence(job, "verify-editor-cleared")
          };
        }

        const sentMessage = page.getByText(job.messageBody, { exact: true }).last();
        try {
          await sentMessage.waitFor({
            state: "visible",
            timeout: this.config.verificationTimeoutMs
          });
        } catch {
          return {
            kind: "UNKNOWN",
            errorCode: "SEND_UNVERIFIED",
            errorMessage:
              "A post-send message bubble matching the message body was not observed.",
            evidence: evidence(job, "verify-sent-message")
          };
        }

        monitorStage = "SENT_CONFIRMED";
        await monitorCapture();
        return {
          kind: "SENT_CONFIRMED",
          recipientVerified: true,
          sendVerified: true,
          providerReference: null,
          evidence: evidence(job, "sent-confirmed", {
            recipientVerification: recipientMatches.verification,
            postSendVerification: "message-bubble-exact"
          })
        };
      } finally {
        if (monitorTimer) {
          clearInterval(monitorTimer);
          monitorTimer = null;
        }
        await monitorChain.catch(() => {});
        if (context) {
          try {
            await this.sessionStore.save(await context.storageState());
          } catch {
            // Do not convert a verified send into failure because session refresh persistence failed.
            // The next attempt will surface SESSION_STORAGE_ERROR if the stored state becomes unusable.
          }
          try {
            await context.close();
          } catch {
            // Best-effort context close.
          }
        }
      }
    } catch (error) {
      if (this.browser && !this.browser.isConnected()) {
        this.browser = null;
      }
      if (error instanceof errors.TimeoutError) {
        if (sendActionAttempted) {
          return {
            kind: "UNKNOWN",
            errorCode: "POST_SEND_TIMEOUT",
            errorMessage:
              "Zalo timed out after a send action was attempted; delivery must be verified before retry.",
            evidence: evidence(job, "post-send-timeout")
          };
        }

        return {
          kind: "TRANSIENT_FAILURE",
          errorCode: "PROVIDER_TIMEOUT",
          errorMessage: error.message,
          evidence: evidence(job, "playwright-timeout")
        };
      }

      return {
        kind: "UNKNOWN",
        errorCode: "PROVIDER_EXCEPTION",
        errorMessage:
          error instanceof Error ? error.message : "Unknown Playwright provider error.",
        evidence: evidence(job, "playwright-exception")
      };
    } finally {
      if (monitorTimer) clearInterval(monitorTimer);
      await this.sessionLock.release();
    }
  }

  private async detectBlocker(
    page: Page,
    job: ClaimedNotificationJob
  ): Promise<NotificationProviderResult | null> {
    if (
      await anyVisible(
        page,
        this.config.selectors.captchaIndicators,
        Math.min(500, this.config.selectorTimeoutMs)
      )
    ) {
      return {
        kind: "MANUAL_REVIEW",
        errorCode: "CAPTCHA",
        errorMessage:
          "Zalo requires CAPTCHA or interactive verification. Provider is paused for operator action.",
        evidence: evidence(job, "detect-captcha")
      };
    }

    if (
      await anyVisible(
        page,
        this.config.selectors.loginIndicators,
        Math.min(500, this.config.selectorTimeoutMs)
      )
    ) {
      return {
        kind: "MANUAL_REVIEW",
        errorCode: "AUTH_REQUIRED",
        errorMessage:
          "Zalo browser session is not authenticated. Refresh the encrypted session before resuming.",
        evidence: evidence(job, "detect-auth")
      };
    }

    return null;
  }
}
