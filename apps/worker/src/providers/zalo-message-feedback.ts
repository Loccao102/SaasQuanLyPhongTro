import type { Page } from "playwright";

export type ZaloSendFeedback =
  | "ZALO_RATE_RESTRICTED"
  | "ZALO_RECIPIENT_BLOCKED"
  | "ZALO_SEND_REJECTED";

/**
 * Interpret only *visible provider alert/toast UI*, never a user's chat text.
 * Zalo Web is unofficial and its markup may change: no detected alert is
 * NOT proof of delivery. New or unrecognized UI must remain unverified.
 */
export function classifyZaloSendFeedback(text: string): ZaloSendFeedback | null {
  const normalized = text.toLocaleLowerCase("vi-VN").replace(/\s+/g, " ").trim();
  if (/(?:gửi quá nhiều|vượt giới hạn|hạn chế gửi|tạm khóa gửi|tạm khoá gửi|spam|rate.limit|too many messages|sending restricted)/i.test(normalized)) {
    return "ZALO_RATE_RESTRICTED";
  }
  if (/(?:bạn đã bị chặn|người này đã chặn|đã chặn bạn|blocked you|you are blocked)/i.test(normalized)) {
    return "ZALO_RECIPIENT_BLOCKED";
  }
  if (/(?:không thể gửi(?: tin nhắn)?|gửi (?:tin nhắn )?thất bại|không gửi được|message not sent|failed to send|cannot send message)/i.test(normalized)) {
    return "ZALO_SEND_REJECTED";
  }
  return null;
}

export async function visibleZaloSendFeedback(page: Page): Promise<ZaloSendFeedback | null> {
  const alerts = page.locator(
    '[role="alert"], [role="status"], [class*="toast"], ' +
    '[class*="Toast"], [class*="snackbar"], [class*="Snackbar"]'
  );
  const count = Math.min(await alerts.count(), 12);
  for (let i = 0; i < count; i += 1) {
    const alert = alerts.nth(i);
    if (!await alert.isVisible().catch(() => false)) continue;
    const text = (await alert.innerText().catch(() => "")).slice(0, 500);
    const code = classifyZaloSendFeedback(text);
    if (code) return code;
  }
  return null;
}
