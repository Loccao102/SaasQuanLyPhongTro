import assert from "node:assert/strict";
import test from "node:test";
import { classifyZaloSendFeedback } from "./zalo-message-feedback.js";

test("recognizes an explicit Zalo account sending restriction", () => {
  assert.equal(classifyZaloSendFeedback("Bạn đã vượt giới hạn gửi tin nhắn"), "ZALO_RATE_RESTRICTED");
  assert.equal(classifyZaloSendFeedback("Too many messages"), "ZALO_RATE_RESTRICTED");
});

test("recognizes a clear recipient blocking notice", () => {
  assert.equal(classifyZaloSendFeedback("Người này đã chặn bạn"), "ZALO_RECIPIENT_BLOCKED");
});

test("treats explicit send failures as uncertain rather than delivered", () => {
  assert.equal(classifyZaloSendFeedback("Không thể gửi tin nhắn"), "ZALO_SEND_REJECTED");
});

test("does not infer blocked or delivered from absence of a provider warning", () => {
  assert.equal(classifyZaloSendFeedback("Tin nhắn của bạn"), null);
  assert.equal(classifyZaloSendFeedback("Bạn đã nhận được một tin nhắn"), null);
});
