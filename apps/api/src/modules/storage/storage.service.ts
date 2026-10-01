import {
  BadRequestException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf"
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export interface StoredFileMetadata {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

@Injectable()
export class StorageService {
  private readonly storageDir: string;

  constructor() {
    this.storageDir = resolve(process.env.STORAGE_LOCAL_DIR || "./data/storage");
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });
  }

  async saveBase64File(input: {
    fileName: string;
    mimeType: string;
    fileBase64: string;
    organizationId?: string;
  }): Promise<StoredFileMetadata> {
    const rawMime = input.mimeType?.toLowerCase().trim();
    if (!rawMime || !ALLOWED_MIME_TYPES.has(rawMime)) {
      throw new BadRequestException(
        `Loại tệp không được hỗ trợ (${rawMime || "không rõ"}). Chỉ chấp nhận JPG, PNG, WEBP, GIF, PDF.`
      );
    }

    // Clean base64 header if present (e.g., "data:image/png;base64,....")
    const base64Data = input.fileBase64.includes(",")
      ? input.fileBase64.split(",")[1]!
      : input.fileBase64;

    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.length === 0) {
      throw new BadRequestException("Nội dung tệp rỗng.");
    }
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `Dung lượng tệp (${(buffer.length / 1024 / 1024).toFixed(1)}MB) vượt quá giới hạn tối đa cho phép (10MB).`
      );
    }

    await this.ensureDir();

    const fileId = randomUUID();
    const originalExt = extname(input.fileName || "").toLowerCase() || this.mimeToExt(rawMime);
    const safeBaseName = basename(input.fileName || "file", originalExt).replace(/[^a-zA-Z0-9_\u00C0-\u1EF9-]/g, "_");
    const storedFileName = `${fileId}_${safeBaseName}${originalExt}`;
    const targetPath = join(this.storageDir, storedFileName);

    await writeFile(targetPath, buffer);

    // Save sidecar meta
    const meta: StoredFileMetadata = {
      id: storedFileName,
      url: `/api/storage/files/${storedFileName}`,
      fileName: input.fileName || storedFileName,
      mimeType: rawMime,
      sizeBytes: buffer.length,
      uploadedAt: new Date().toISOString()
    };

    const metaPath = join(this.storageDir, `${storedFileName}.json`);
    await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");

    return meta;
  }

  async getFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const safeName = basename(fileId);
    if (!safeName || safeName.includes("..") || safeName !== fileId) {
      throw new BadRequestException("Tên tệp không hợp lệ.");
    }

    const filePath = join(this.storageDir, safeName);
    const metaPath = join(this.storageDir, `${safeName}.json`);

    try {
      await stat(filePath);
    } catch {
      throw new NotFoundException("Tệp tin không tồn tại hoặc đã bị xóa.");
    }

    const buffer = await readFile(filePath);
    let mimeType = "application/octet-stream";
    let fileName = safeName;

    try {
      const metaRaw = await readFile(metaPath, "utf-8");
      const meta = JSON.parse(metaRaw) as StoredFileMetadata;
      if (meta.mimeType) mimeType = meta.mimeType;
      if (meta.fileName) fileName = meta.fileName;
    } catch {
      // Fallback mime from extension
      const ext = extname(safeName).toLowerCase();
      mimeType = this.extToMime(ext);
    }

    return { buffer, mimeType, fileName };
  }

  private mimeToExt(mime: string): string {
    switch (mime) {
      case "image/jpeg": return ".jpg";
      case "image/png": return ".png";
      case "image/webp": return ".webp";
      case "image/gif": return ".gif";
      case "application/pdf": return ".pdf";
      default: return ".bin";
    }
  }

  private extToMime(ext: string): string {
    switch (ext) {
      case ".jpg":
      case ".jpeg": return "image/jpeg";
      case ".png": return "image/png";
      case ".webp": return "image/webp";
      case ".gif": return "image/gif";
      case ".pdf": return "application/pdf";
      default: return "application/octet-stream";
    }
  }
}
