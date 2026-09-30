import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVietQrUrl,
  getPlatformBankInfo
} from "./tenant-subscription.service.js";

test("tenant subscription: buildVietQrUrl generates standard compact2 VietQR URL", () => {
  const url = buildVietQrUrl({
    bankId: "MB",
    accountNo: "0388888888",
    accountName: "HABI SAAS",
    amountVnd: 249000,
    paymentReference: "SAASABCDEF12"
  });

  assert.ok(url.startsWith("https://img.vietqr.io/image/MB-0388888888-compact2.png"));
  assert.ok(url.includes("amount=249000"));
  assert.ok(url.includes("addInfo=SAASABCDEF12"));
  assert.ok(url.includes("accountName=HABI%20SAAS"));
});

test("tenant subscription: getPlatformBankInfo returns non-empty defaults", () => {
  const bank = getPlatformBankInfo();

  assert.ok(bank.bankId.length > 0);
  assert.ok(bank.bankName.length > 0);
  assert.ok(bank.accountNo.length > 0);
  assert.ok(bank.accountName.length > 0);
});

test("tenant subscription: quota percentage is safe and bounded", () => {
  function computePercentage(current: number, limit: number): number {
    return limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0;
  }

  assert.equal(computePercentage(5, 20), 25);
  assert.equal(computePercentage(20, 20), 100);
  assert.equal(computePercentage(25, 20), 100);
  assert.equal(computePercentage(0, 20), 0);
  assert.equal(computePercentage(10, 0), 0);
});
