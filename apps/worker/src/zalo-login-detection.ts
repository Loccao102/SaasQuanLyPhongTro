import type { Page } from "playwright";

/**
 * A login can display the authenticated Zalo chat shell without a native
 * <input placeholder="Tìm kiếm">. Zalo's search field is sometimes a custom
 * div/contenteditable, so checking only input placeholders leaves the QR
 * request RUNNING even after the chat screen has opened.
 *
 * The chat navigation markers must be visible together with either a search
 * control or a conversation-list marker. This intentionally fails closed:
 * never persist credentials from a generic webpage or an unverified login UI.
 */
async function visible(page: Page, selector: string): Promise<boolean> {
  try {
    return await page.locator(selector).first().isVisible();
  } catch {
    return false;
  }
}

async function visibleText(page: Page, text: string): Promise<boolean> {
  try {
    return await page.getByText(text, { exact: true }).first().isVisible();
  } catch {
    return false;
  }
}

export async function isAuthenticatedZaloChat(
  page: Page,
  searchInputs: readonly string[]
): Promise<boolean> {
  const tabsPresent =
    (await visibleText(page, "Tất cả")) &&
    (await visibleText(page, "Chưa đọc"));

  if (!tabsPresent) return false;

  // Explicitly reject a still-visible QR challenge even when Zalo pre-renders
  // parts of its chat UI beneath an authentication overlay.
  for (const selector of [
    '[class*="qr"] canvas',
    '[class*="qr"] img',
    'img[alt*="QR"]'
  ]) {
    if (await visible(page, selector)) return false;
  }

  for (const selector of [
    ...searchInputs,
    '[role="searchbox"]',
    'input[placeholder*="Tìm"]',
    '[contenteditable="true"][data-placeholder*="Tìm"]',
    '[contenteditable="true"][placeholder*="Tìm"]',
    '#contact-search-input'
  ]) {
    if (await visible(page, selector)) return true;
  }

  // The post-login default conversation ("My Documents") is visible in the
  // current Zalo Web design even when its search element is not an <input>.
  return visibleText(page, "My Documents");
}
