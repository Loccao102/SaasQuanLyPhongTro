import {
  chromium,
  errors,
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
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      return locator;
    } catch {
      // Try the next configured selector.
    }
  }
  return null;
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

export class ZaloPlaywrightProvider implements NotificationProvider {
  readonly name = "PLAYWRIGHT_ZALO";
  readonly claimAliases = ["ZALO_PLAYWRIGHT"] as const;

  private constructor(
    private readonly config: ZaloPlaywrightConfig,
    private readonly sessionStore: EncryptedStorageStateStore,
    private readonly sessionLock: ExclusiveSessionFileLock
  ) {}

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

    if (!job.recipientDisplayName?.trim()) {
      return {
        kind: "MANUAL_REVIEW",
        errorCode: "RECIPIENT_DISPLAY_NAME_REQUIRED",
        errorMessage:
          "A recipient display name is required for safe Zalo recipient verification.",
        evidence: evidence(job, "validate-recipient")
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

      const browser = await chromium.launch({
        headless: this.config.headless
      });

      try {
        context = await browser.newContext(
          storageState
            ? { storageState: storageState as BrowserContextOptions["storageState"] }
            : undefined
        );
        const page = await context.newPage();
        page.setDefaultTimeout(this.config.selectorTimeoutMs);
        page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);

        await page.goto(this.config.baseUrl, {
          waitUntil: "domcontentloaded",
          timeout: this.config.navigationTimeoutMs
        });

        const blocker = await this.detectBlocker(page, job);
        if (blocker) return blocker;

        const searchInput = await firstVisible(
          page,
          this.config.selectors.searchInputs,
          this.config.selectorTimeoutMs
        );
        if (!searchInput) {
          return {
            kind: "UNKNOWN",
            errorCode: "PROVIDER_UI_BROKEN",
            errorMessage: "Zalo recipient search input was not found.",
            evidence: evidence(job, "find-search-input")
          };
        }

        await searchInput.fill(job.recipientKey);
        await page.waitForTimeout(600);

        const displayName = job.recipientDisplayName.trim();
        const recipientMatches = await visibleExactTextCount(
          page,
          displayName
        );

        if (recipientMatches.count === 0 || !recipientMatches.first) {
          return {
            kind: "MANUAL_REVIEW",
            errorCode: "RECIPIENT_NOT_FOUND",
            errorMessage:
              "No uniquely verifiable Zalo recipient matched the expected display name.",
            evidence: evidence(job, "verify-recipient-search", {
              visibleExactMatches: 0
            })
          };
        }

        if (recipientMatches.count !== 1) {
          return {
            kind: "MANUAL_REVIEW",
            errorCode: "RECIPIENT_AMBIGUOUS",
            errorMessage:
              "Multiple visible Zalo results matched the expected display name.",
            evidence: evidence(job, "verify-recipient-search", {
              visibleExactMatches: recipientMatches.count
            })
          };
        }

        await recipientMatches.first.click();

        const editor = await firstVisible(
          page,
          this.config.selectors.messageEditors,
          this.config.selectorTimeoutMs
        );
        if (!editor) {
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

        const conversationMatches = await visibleExactTextCount(
          page,
          displayName
        );
        if (conversationMatches.count < 1) {
          return {
            kind: "MANUAL_REVIEW",
            errorCode: "RECIPIENT_VERIFICATION_FAILED",
            errorMessage:
              "Conversation header could not be verified against the expected recipient.",
            evidence: evidence(job, "verify-open-conversation")
          };
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

        await editor.fill(job.messageBody);

        const sendButton = await firstVisible(
          page,
          this.config.selectors.sendButtons,
          Math.min(1500, this.config.selectorTimeoutMs)
        );
        sendActionAttempted = true;
        if (sendButton) {
          await sendButton.click();
        } else {
          await editor.press("Enter");
        }

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

        return {
          kind: "SENT_CONFIRMED",
          recipientVerified: true,
          sendVerified: true,
          providerReference: null,
          evidence: evidence(job, "sent-confirmed", {
            recipientVerification: "display-name-exact",
            postSendVerification: "message-bubble-exact"
          })
        };
      } finally {
        if (context) {
          try {
            await this.sessionStore.save(await context.storageState());
          } catch {
            // Do not convert a verified send into failure because session refresh persistence failed.
            // The next attempt will surface SESSION_STORAGE_ERROR if the stored state becomes unusable.
          }
        }
        await browser.close();
      }
    } catch (error) {
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
