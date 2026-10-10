import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright";
import { isAuthenticatedZaloChat } from "./zalo-login-detection.js";

function fakePage(input: {
  visibleSelectors?: string[];
  visibleLabels?: string[];
}): Page {
  const selectors = new Set(input.visibleSelectors ?? []);
  const labels = new Set(input.visibleLabels ?? []);
  return {
    locator(selector: string) {
      return { first: () => ({ isVisible: async () => selectors.has(selector) }) };
    },
    getByText(label: string) {
      return { first: () => ({ isVisible: async () => labels.has(label) }) };
    }
  } as unknown as Page;
}

const legacySearch = ['input[placeholder*="Tìm kiếm"]'];

test("recognizes a logged-in Zalo chat with a custom search field", async () => {
  const page = fakePage({
    visibleLabels: ["Tất cả", "Chưa đọc"],
    visibleSelectors: ['[role="searchbox"]']
  });
  assert.equal(await isAuthenticatedZaloChat(page, legacySearch), true);
});

test("recognizes the logged-in screenshot's My Documents chat shell", async () => {
  const page = fakePage({
    visibleLabels: ["Tất cả", "Chưa đọc", "My Documents"]
  });
  assert.equal(await isAuthenticatedZaloChat(page, legacySearch), true);
});

test("rejects a login screen that has a search field but no chat tabs", async () => {
  const page = fakePage({
    visibleSelectors: legacySearch
  });
  assert.equal(await isAuthenticatedZaloChat(page, legacySearch), false);
});

test("rejects chat navigation when a QR login overlay is visible", async () => {
  const page = fakePage({
    visibleLabels: ["Tất cả", "Chưa đọc", "My Documents"],
    visibleSelectors: ['[class*="qr"] canvas']
  });
  assert.equal(await isAuthenticatedZaloChat(page, legacySearch), false);
});

test("rejects chat tabs without search or an actual conversation marker", async () => {
  const page = fakePage({
    visibleLabels: ["Tất cả", "Chưa đọc"]
  });
  assert.equal(await isAuthenticatedZaloChat(page, legacySearch), false);
});
