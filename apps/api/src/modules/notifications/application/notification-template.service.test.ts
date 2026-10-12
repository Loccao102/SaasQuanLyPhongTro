import assert from "node:assert/strict";
import test from "node:test";
import { validateNotificationTemplateDraft } from "./notification-template.service.js";

const valid = {
  name: "Nhắc đóng tiền phòng",
  category: "RENT",
  body: "Chào bạn, hạn thanh toán {{han_thanh_toan}}. Nếu cần hỗ trợ, hãy phản hồi."
};

test("allows reusable named templates and recognized variables", () => {
  assert.deepEqual(validateNotificationTemplateDraft(valid), valid);
  assert.equal(validateNotificationTemplateDraft({
    ...valid,
    body: "Thông báo cho {{ten_khach}}, phòng {{so_phong}}."
  }).category, "RENT");
});

test("rejects unapproved fields and malformed interpolation", () => {
  assert.throws(() => validateNotificationTemplateDraft({
    ...valid, body: "Chào {{mat_khau}}"
  }));
  assert.throws(() => validateNotificationTemplateDraft({
    ...valid, body: "Chào {{"
  }));
  assert.throws(() => validateNotificationTemplateDraft({
    ...valid, body: "Chào }}"
  }));
});

test("rejects blank, oversized or unsafe categories", () => {
  assert.throws(() => validateNotificationTemplateDraft({ ...valid, name: " " }));
  assert.throws(() => validateNotificationTemplateDraft({ ...valid, category: "UNKNOWN" }));
  assert.throws(() => validateNotificationTemplateDraft({ ...valid, body: "x".repeat(4001) }));
});
