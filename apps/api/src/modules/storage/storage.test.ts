import assert from "node:assert/strict";
import test from "node:test";
import { StorageService } from "./storage.service.js";

test("storage: rejects unsupported mime type", async () => {
  const service = new StorageService();
  await assert.rejects(
    () => service.saveBase64File({
      fileName: "malicious.exe",
      mimeType: "application/x-msdownload",
      fileBase64: Buffer.from("test").toString("base64")
    }),
    /Loại tệp không được hỗ trợ/
  );
});

test("storage: saves valid base64 image and reads back file", async () => {
  const service = new StorageService();
  const testPayload = "Hello Habi Storage Test Content";
  const base64 = Buffer.from(testPayload).toString("base64");

  const stored = await service.saveBase64File({
    fileName: "meter_photo.png",
    mimeType: "image/png",
    fileBase64: base64
  });

  assert.ok(stored.id);
  assert.ok(stored.url.startsWith("/api/storage/files/"));
  assert.equal(stored.mimeType, "image/png");

  const fetched = await service.getFile(stored.id);
  assert.equal(fetched.buffer.toString(), testPayload);
  assert.equal(fetched.mimeType, "image/png");
});

test("storage: rejects path traversal attempts in getFile", async () => {
  const service = new StorageService();
  await assert.rejects(
    () => service.getFile("../../../etc/passwd"),
    /Tên tệp không hợp lệ/
  );
  await assert.rejects(
    () => service.getFile("subdir/file.png"),
    /Tên tệp không hợp lệ/
  );
});
