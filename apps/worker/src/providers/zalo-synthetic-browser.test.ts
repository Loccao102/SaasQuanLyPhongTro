import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { once } from "node:events";
import { loadZaloPlaywrightConfig } from "./zalo-playwright.config.js";
import { ZaloPlaywrightProvider } from "./zalo-playwright.provider.js";
import type { ClaimedNotificationJob } from "../notification-types.js";

const browserTest = process.env.ZALO_BROWSER_SMOKE === "1" ? test : test.skip;
type Scenario = "sent" | "old-bubble-only" | "old-outgoing-then-incoming" | "incoming-only" | "undirected-only" | "blocked" | "ambiguous" | "same-name-sidebar" | "wrong-card" | "header-mismatch" | "wrong-phone" | "correct-phone" | "phone-first";

function mockZaloHtml(mode: Scenario): string {
  // All content here is synthetic local HTML; never use real contact details,
  // Zalo credentials or live network requests in CI.
  return `<!DOCTYPE html><html lang="vi"><meta charset="utf-8"><body>
    <input id="input-search" placeholder="Search contacts" aria-label="Search contacts" />
    <div id="search-results"></div>\n    <aside id="prior-chats" hidden><p>Nguyen A</p></aside>
    <section id="chat" hidden>
      <header><strong id="selected-contact">Nguyen A</strong></header>
      <div id="messages"></div>
      <div role="textbox" contenteditable="true" id="composer"></div>
      <button aria-label="Gửi" id="send">Gửi</button>
    </section>
    <div role="alert" id="warning" hidden></div>
    <script>
      const mode = ${JSON.stringify(mode)};
      const phone = "0901234567";
      const body = "Unique invoice notification";
      const search = document.getElementById("input-search");
      const results = document.getElementById("search-results");
      const chat = document.getElementById("chat");
      const messages = document.getElementById("messages");
      const editor = document.getElementById("composer");
      const addBubble = (value, direction = "outgoing") => {
        const bubble = document.createElement("p");
        bubble.className = direction;
        bubble.textContent = value;
        messages.appendChild(bubble);
      };
      search.addEventListener("input", () => {
        results.replaceChildren();
        if (!search.value.includes(phone)) return;
        const contacts = mode === "ambiguous" ? ["Nguyen A", "Tran B"]
          : mode === "wrong-card" || mode === "same-name-sidebar" ? ["Wrong Contact"] : ["Nguyen A"];
        if (mode === "same-name-sidebar") document.getElementById("prior-chats").hidden = false;
        for (const name of contacts) {
          const item = document.createElement("button");
          item.className = "search-result__item";
          item.textContent = mode === "phone-first" ? "090 123 4567" : name;
          if (mode === "phone-first") {
            const displayName = document.createElement("span");
            displayName.style.display = "block";
            displayName.textContent = name;
            item.appendChild(displayName);
          }
          if (mode === "wrong-phone" || mode === "correct-phone") {
            const mobile = document.createElement("span");
            mobile.style.display = "block";
            mobile.textContent = mode === "wrong-phone" ? "0909998887" : "090 123 4567";
            item.appendChild(mobile);
          }
          item.onclick = () => {
            results.replaceChildren();
            search.hidden = true;
            chat.hidden = false;
            document.getElementById("selected-contact").textContent =
              mode === "header-mismatch" ? "Different Person" : name;
            if (mode === "header-mismatch") document.getElementById("prior-chats").hidden = false;
            if (mode === "old-bubble-only" || mode === "old-outgoing-then-incoming") addBubble(body);
          };
          results.appendChild(item);
        }
      });
      document.getElementById("send").onclick = () => {
        const message = editor.textContent.trim();
        editor.textContent = "";
        if (mode === "blocked") {
          const alert = document.getElementById("warning");
          alert.textContent = "Người này đã chặn bạn";
          alert.hidden = false;
        } else if (mode === "sent") {
          addBubble(message);
        } else if (mode === "incoming-only" || mode === "old-outgoing-then-incoming") {
          addBubble(message, "incoming");
        } else if (mode === "undirected-only") {
          addBubble(message, "generic-message");
        }
      };
    </script>
  </body></html>`;
}

async function openFixture(scenario: Scenario): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(mockZaloHtml(scenario));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local port");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

function job(displayName: string | null = "Nguyen A"): ClaimedNotificationJob {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000002",
    campaignId: "10000000-0000-4000-8000-000000000003",
    recipientKey: "0901234567",
    recipientDisplayName: displayName,
    provider: "PLAYWRIGHT_ZALO",
    channel: "ZALO",
    messageBody: "Unique invoice notification",
    attemptNumber: 1,
    maxAttempts: 3,
    deliveryReplayCheckRequired: false
  };
}

async function runSyntheticSend(scenario: Scenario, recipientName: string | null = "Nguyen A") {
  const fixture = await openFixture(scenario);
  let released = false;
  const config = loadZaloPlaywrightConfig({
    ZALO_BASE_URL: fixture.url,
    ZALO_SESSION_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
    ZALO_HEADLESS: "true",
    ZALO_SELECTOR_TIMEOUT_MS: "1000",
    ZALO_NAVIGATION_TIMEOUT_MS: "6000",
    ZALO_VERIFICATION_TIMEOUT_MS: "1500"
  });
  const provider = ZaloPlaywrightProvider.withStorage(
    config,
    { load: async () => ({ cookies: [], origins: [] }), save: async () => {} },
    { acquire: async () => true, release: async () => { released = true; } }
  );
  try {
    const result = await provider.send(job(recipientName));
    assert.equal(released, true, "The worker must release the tenant session lock");
    return result;
  } finally {
    await provider.close();
    await new Promise<void>((resolve, reject) =>
      fixture.server.close(error => error ? reject(error) : resolve())
    );
  }
}

browserTest("mocked Zalo: new outgoing bubble is observed and verified", async () => {
  const result = await runSyntheticSend("sent");
  assert.equal(result.kind, "SENT_CONFIRMED");
  if (result.kind === "SENT_CONFIRMED") {
    assert.equal(result.recipientVerified, true);
    assert.equal(result.sendVerified, true);
  }
});

browserTest("mocked Zalo: unique phone-only contact can send without a name", async () => {
  const result = await runSyntheticSend("sent", null);
  assert.equal(result.kind, "SENT_CONFIRMED");
  if (result.kind === "SENT_CONFIRMED") {
    assert.equal(result.recipientVerified, true);
    assert.equal(result.sendVerified, true);
  }
});

browserTest("mocked Zalo: old identical bubble never confirms a new send", async () => {
  const result = await runSyntheticSend("old-bubble-only");
  assert.equal(result.kind, "UNKNOWN");
  if (result.kind === "UNKNOWN") assert.equal(result.errorCode, "SEND_UNVERIFIED");
});

browserTest("mocked Zalo: new incoming echo is NOT proof of our send", async () => {
  const result = await runSyntheticSend("incoming-only");
  assert.equal(result.kind, "UNKNOWN");
  if (result.kind === "UNKNOWN") assert.equal(result.errorCode, "SEND_UNVERIFIED");
});

browserTest("mocked Zalo: old outgoing plus new incoming echo cannot increase outgoing count", async () => {
  const result = await runSyntheticSend("old-outgoing-then-incoming");
  assert.equal(result.kind, "UNKNOWN");
  if (result.kind === "UNKNOWN") assert.equal(result.errorCode, "SEND_UNVERIFIED");
});

browserTest("mocked Zalo: a generic new text node without outgoing marker is NOT send proof", async () => {
  const result = await runSyntheticSend("undirected-only");
  assert.equal(result.kind, "UNKNOWN");
  if (result.kind === "UNKNOWN") assert.equal(result.errorCode, "SEND_UNVERIFIED");
});

browserTest("mocked Zalo: explicit recipient block is manual review", async () => {
  const result = await runSyntheticSend("blocked");
  assert.equal(result.kind, "MANUAL_REVIEW");
  if (result.kind === "MANUAL_REVIEW") assert.equal(result.errorCode, "ZALO_RECIPIENT_BLOCKED");
});

browserTest("mocked Zalo: a matching name in a previous conversation cannot override the phone search card", async () => {
  const result = await runSyntheticSend("same-name-sidebar");
  assert.equal(result.kind, "MANUAL_REVIEW");
  if (result.kind === "MANUAL_REVIEW") assert.equal(result.errorCode, "RECIPIENT_NOT_FOUND");
});

browserTest("mocked Zalo: contact card showing a different phone is rejected even with matching name", async () => {
  const result = await runSyntheticSend("wrong-phone");
  assert.equal(result.kind, "MANUAL_REVIEW");
  if (result.kind === "MANUAL_REVIEW") assert.equal(result.errorCode, "RECIPIENT_NOT_FOUND");
});

browserTest("mocked Zalo: phone-first search card still verifies its actual display name", async () => {
  const result = await runSyntheticSend("phone-first", null);
  assert.equal(result.kind, "SENT_CONFIRMED");
});

browserTest("mocked Zalo: formatted matching phone in a unique contact card is accepted", async () => {
  const result = await runSyntheticSend("correct-phone");
  assert.equal(result.kind, "SENT_CONFIRMED");
});

browserTest("mocked Zalo: matching name in sidebar never overrides wrong active chat header", async () => {
  const result = await runSyntheticSend("header-mismatch");
  assert.equal(result.kind, "MANUAL_REVIEW");
  if (result.kind === "MANUAL_REVIEW") assert.equal(result.errorCode, "RECIPIENT_VERIFICATION_FAILED");
});

browserTest("mocked Zalo: a unique phone result with a different display name is rejected", async () => {
  const result = await runSyntheticSend("wrong-card");
  assert.equal(result.kind, "MANUAL_REVIEW");
  if (result.kind === "MANUAL_REVIEW") assert.equal(result.errorCode, "RECIPIENT_NOT_FOUND");
});

browserTest("mocked Zalo: phone-only ambiguous results must not send", async () => {
  const result = await runSyntheticSend("ambiguous", null);
  assert.equal(result.kind, "MANUAL_REVIEW");
  if (result.kind === "MANUAL_REVIEW") assert.equal(result.errorCode, "RECIPIENT_AMBIGUOUS");
});
