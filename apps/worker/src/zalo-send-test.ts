import { randomUUID } from "node:crypto";
import { ZaloPlaywrightProvider } from "./providers/zalo-playwright.provider.js";
import type { ClaimedNotificationJob } from "./notification-types.js";

async function main(): Promise<void> {
  const recipientKey = process.env.TEST_ZALO_RECIPIENT || process.argv[2];
  const recipientDisplayName = process.env.TEST_ZALO_NAME || process.argv[3];
  const messageBody =
    process.env.TEST_ZALO_MESSAGE ||
    process.argv[4] ||
    "Xin chao, day la tin nhan thu nghiem tu Habi Prop-Ops SaaS!";

  if (!recipientKey || !recipientDisplayName) {
    console.log(`
[zalo-send-test] Huong dan test gui tin Zalo doc lap:
  pnpm --filter @propops/worker zalo:send-test "<SoDienThoai_Hoac_Key>" "<TenHienThiZaloChinhXac>" "[NoiDungTinNhan]"

Vi du:
  pnpm --filter @propops/worker zalo:send-test "0912345678" "Nguyen Van A" "Thong bao test Zalo tu he thong"
`);
    process.exit(1);
  }

  // Mac dinh headless = false de nguoi dung truc tiep quan sat trinh duyet go tin nhan
  if (process.env.ZALO_HEADLESS === undefined) {
    process.env.ZALO_HEADLESS = "false";
  }

  console.log(`[zalo-send-test] Chuan bi gui den: ${recipientDisplayName} (${recipientKey})...`);
  console.log(`[zalo-send-test] Noi dung: "${messageBody}"\n`);

  const provider = ZaloPlaywrightProvider.fromEnvironment();

  const dummyJob: ClaimedNotificationJob = {
    id: randomUUID(),
    organizationId: randomUUID(),
    campaignId: randomUUID(),
    recipientKey,
    recipientDisplayName,
    provider: "PLAYWRIGHT_ZALO",
    channel: "ZALO",
    messageBody,
    attemptNumber: 1,
    maxAttempts: 3,
    deliveryReplayCheckRequired: false
  };

  try {
    const result = await provider.send(dummyJob);
    console.log("[zalo-send-test] Ket qua:", JSON.stringify(result, null, 2));

    if (result.kind === "SENT_CONFIRMED") {
      console.log("\n>>> THANH CONG! Tin nhan da duoc gui va xac nhan tren Zalo. <<<\n");
    } else {
      console.log(
        `\n>>> CHUA HOAN TAT: Trang thai = ${result.kind}, Ma loi = ${result.errorCode || "N/A"} - ${result.errorMessage || ""} <<<\n`
      );
    }
  } finally {
    await provider.close();
  }
}

void main();
