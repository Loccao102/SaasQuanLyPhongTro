import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { loadZaloPlaywrightConfig } from "./zalo-playwright.config.js";

test("Zalo Playwright config requires a 32-byte encryption key", () => {
  assert.throws(
    () => loadZaloPlaywrightConfig({}),
    /ZALO_SESSION_KEY_BASE64 is required/
  );

  assert.throws(
    () =>
      loadZaloPlaywrightConfig({
        ZALO_SESSION_KEY_BASE64: Buffer.from("too-short").toString("base64")
      }),
    /exactly 32 bytes/
  );
});

test("Zalo Playwright config parses safe defaults and selector overrides", () => {
  const config = loadZaloPlaywrightConfig({
    ZALO_SESSION_KEY_BASE64: randomBytes(32).toString("base64"),
    ZALO_HEADLESS: "false",
    ZALO_SEARCH_INPUT_SELECTORS: "#one || #two"
  });

  assert.equal(config.headless, false);
  assert.equal(config.baseUrl, "https://chat.zalo.me/");
  assert.deepEqual(config.selectors.searchInputs, ["#one", "#two"]);
  assert.equal(config.sessionPath, ".runtime-secrets/zalo/session.enc");
});
