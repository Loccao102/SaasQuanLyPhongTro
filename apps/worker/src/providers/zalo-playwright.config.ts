export interface ZaloPlaywrightConfig {
  baseUrl: string;
  headless: boolean;
  navigationTimeoutMs: number;
  selectorTimeoutMs: number;
  verificationTimeoutMs: number;
  sessionPath: string;
  sessionKeyBase64: string;
  lockPath: string;
  selectors: {
    loginIndicators: readonly string[];
    captchaIndicators: readonly string[];
    searchInputs: readonly string[];
    messageEditors: readonly string[];
    sendButtons: readonly string[];
  };
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  field: string
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(field + " must be a positive integer.");
  }
  return parsed;
}

function booleanValue(
  value: string | undefined,
  fallback: boolean
): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new Error("Boolean environment value must be true/false or 1/0.");
}

function selectorList(
  value: string | undefined,
  fallback: readonly string[]
): readonly string[] {
  if (!value?.trim()) return fallback;
  const selectors = value
    .split("||")
    .map((item) => item.trim())
    .filter(Boolean);
  if (selectors.length === 0) {
    throw new Error("Selector list cannot be empty.");
  }
  return selectors;
}

export function loadZaloPlaywrightConfig(
  env: NodeJS.ProcessEnv = process.env
): ZaloPlaywrightConfig {
  const sessionPath =
    env.ZALO_SESSION_PATH?.trim() || ".runtime-secrets/zalo/session.enc";
  const sessionKeyBase64 = env.ZALO_SESSION_KEY_BASE64?.trim() || "";

  if (!sessionKeyBase64) {
    throw new Error(
      "ZALO_SESSION_KEY_BASE64 is required for encrypted browser session storage."
    );
  }

  const key = Buffer.from(sessionKeyBase64, "base64");
  if (key.length !== 32) {
    throw new Error(
      "ZALO_SESSION_KEY_BASE64 must decode to exactly 32 bytes."
    );
  }

  return {
    baseUrl: env.ZALO_BASE_URL?.trim() || "https://chat.zalo.me/",
    headless: booleanValue(env.ZALO_HEADLESS, true),
    navigationTimeoutMs: positiveInteger(
      env.ZALO_NAVIGATION_TIMEOUT_MS,
      30000,
      "ZALO_NAVIGATION_TIMEOUT_MS"
    ),
    selectorTimeoutMs: positiveInteger(
      env.ZALO_SELECTOR_TIMEOUT_MS,
      5000,
      "ZALO_SELECTOR_TIMEOUT_MS"
    ),
    verificationTimeoutMs: positiveInteger(
      env.ZALO_VERIFICATION_TIMEOUT_MS,
      10000,
      "ZALO_VERIFICATION_TIMEOUT_MS"
    ),
    sessionPath,
    sessionKeyBase64,
    lockPath: env.ZALO_SESSION_LOCK_PATH?.trim() || sessionPath + ".lock",
    selectors: {
      loginIndicators: selectorList(env.ZALO_LOGIN_INDICATORS, [
        'text=/Quét mã QR/i',
        'text=/Đăng nhập/i',
        'text=/Login/i'
      ]),
      captchaIndicators: selectorList(env.ZALO_CAPTCHA_INDICATORS, [
        'text=/CAPTCHA/i',
        'text=/Xác minh bảo mật/i',
        'text=/Xác minh tài khoản/i'
      ]),
      searchInputs: selectorList(env.ZALO_SEARCH_INPUT_SELECTORS, [
        'input[placeholder*="Tìm kiếm"]',
        'input[placeholder*="Tìm"]',
        'input[placeholder*="Search"]'
      ]),
      messageEditors: selectorList(env.ZALO_MESSAGE_EDITOR_SELECTORS, [
        '[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"]',
        'textarea'
      ]),
      sendButtons: selectorList(env.ZALO_SEND_BUTTON_SELECTORS, [
        'button[aria-label*="Gửi"]',
        'button[title*="Gửi"]',
        'button[aria-label*="Send"]',
        'button[title*="Send"]'
      ])
    }
  };
}
