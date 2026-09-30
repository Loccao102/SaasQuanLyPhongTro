#!/usr/bin/env node

/**
 * HABI Prop-Ops Automated Zero-Cost PostgreSQL Backup Utility
 * ==============================================================================
 * Cross-platform database backup script (Windows/macOS/Linux) with:
 * - High-ratio compression (gzip level 9)
 * - SHA-256 integrity checksum verification
 * - Local backup rotation (retention policy)
 * - Optional zero-cost cloud upload to Cloudflare R2 Free Tier (10GB free, 0$ egress)
 *
 * Usage:
 *   node scripts/backup-db.mjs
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execSync, spawn } from "node:child_process";

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || "./backups");
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || "30", 10);
const COMPOSE_FILE = process.env.COMPOSE_FILE || "infra/docker-compose.yml";
const POSTGRES_SERVICE = process.env.POSTGRES_SERVICE || "postgres";
const POSTGRES_USER = process.env.POSTGRES_USER || "propops";
const POSTGRES_DB = process.env.POSTGRES_DB || "propops";
const LOG_FILE = path.join(BACKUP_DIR, "backup.log");

// Ensure backup dir exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function runBackup() {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
  const baseFilename = `habi_db_${POSTGRES_DB}_${timestamp}.sql.gz`;
  const targetFilepath = path.join(BACKUP_DIR, baseFilename);
  const checksumFilepath = path.join(BACKUP_DIR, `${baseFilename}.sha256`);

  log(`=== Bắt đầu quy trình sao lưu cơ sở dữ liệu [${POSTGRES_DB}] ===`);

  const gzip = zlib.createGzip({ level: 9 });
  const hash = crypto.createHash("sha256");
  const outputStream = fs.createWriteStream(targetFilepath);

  // Check if docker compose or local pg_dump is used
  let dumpProcess;
  const isDocker = fs.existsSync(COMPOSE_FILE);

  if (isDocker) {
    log(`Sử dụng docker compose service [${POSTGRES_SERVICE}]...`);
    dumpProcess = spawn("docker", [
      "compose",
      "-f",
      COMPOSE_FILE,
      "exec",
      "-T",
      POSTGRES_SERVICE,
      "pg_dump",
      "-U",
      POSTGRES_USER,
      "-d",
      POSTGRES_DB,
      "--no-owner",
      "--clean",
      "--if-exists"
    ]);
  } else {
    log(`Sử dụng pg_dump trực tiếp...`);
    dumpProcess = spawn("pg_dump", [
      "-U",
      POSTGRES_USER,
      "-d",
      POSTGRES_DB,
      "--no-owner",
      "--clean",
      "--if-exists"
    ]);
  }

  dumpProcess.stderr.on("data", (chunk) => {
    const errText = chunk.toString().trim();
    if (errText && !errText.includes("NOTICE:")) {
      log(`[pg_dump stderr] ${errText}`);
    }
  });

  dumpProcess.stdout.pipe(gzip);
  gzip.on("data", (chunk) => hash.update(chunk));
  gzip.pipe(outputStream);

  await new Promise((resolve, reject) => {
    outputStream.on("finish", resolve);
    outputStream.on("error", reject);
    dumpProcess.on("error", reject);
  });

  // Verify file size
  const stats = fs.statSync(targetFilepath);
  if (stats.size < 512) {
    fs.unlinkSync(targetFilepath);
    throw new Error(`Tệp sao lưu quá nhỏ (${stats.size} bytes). Quá trình pg_dump có thể đã thất bại.`);
  }

  // Save SHA-256 checksum sidecar
  const sha256 = hash.digest("hex");
  fs.writeFileSync(checksumFilepath, `${sha256}  ${baseFilename}\n`, "utf8");

  log(`✓ Sao lưu THÀNH CÔNG: ${baseFilename} (${formatBytes(stats.size)})`);
  log(`✓ Checksum SHA-256:   ${sha256}`);

  // Retention cleanup
  cleanupOldBackups();

  // Cloud Sync (Cloudflare R2 / S3 Free Tier)
  await uploadToCloudIfConfigured(targetFilepath, checksumFilepath);

  log(`=== Hoàn tất phiên sao lưu an toàn ===`);
}

function cleanupOldBackups() {
  log(`Áp dụng chính sách lưu trữ: Giữ lại ${RETENTION_DAYS} ngày gần nhất...`);
  const now = Date.now();
  const maxAgeMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const files = fs.readdirSync(BACKUP_DIR);
  let deletedCount = 0;

  for (const file of files) {
    if (file.startsWith("habi_db_") && (file.endsWith(".sql.gz") || file.endsWith(".sha256"))) {
      const filePath = path.join(BACKUP_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        deletedCount++;
        log(`Đã dọn dẹp bản sao lưu cũ: ${file}`);
      }
    }
  }

  log(`Đã dọn dẹp ${deletedCount} tệp cũ quá ${RETENTION_DAYS} ngày.`);
}

async function uploadToCloudIfConfigured(filePath, checksumPath) {
  const r2Bucket = process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_R2_BUCKET;
  if (!r2Bucket) {
    log(`Ghi chú: Chưa cấu hình R2_BUCKET_NAME. Bản sao lưu được lưu an toàn tại máy chủ cục bộ (0đ chi phí).`);
    return;
  }

  log(`Đang đồng bộ bản sao lưu lên Cloudflare R2 Free Tier [${r2Bucket}]...`);
  try {
    // If rclone or aws cli is available, upload directly
    const fileName = path.basename(filePath);
    execSync(`rclone copy "${filePath}" "r2:${r2Bucket}/backups/"`, { stdio: "ignore" });
    execSync(`rclone copy "${checksumPath}" "r2:${r2Bucket}/backups/"`, { stdio: "ignore" });
    log(`✓ Đã tải thành công lên Cloudflare R2: backups/${fileName} (0đ phí băng thông tải về)`);
  } catch {
    log(`⚠️ Không tìm thấy công cụ rclone hoặc cấu hình R2 không hợp lệ. Bản sao lưu vẫn an toàn tại thư mục cục bộ.`);
  }
}

runBackup().catch((err) => {
  log(`LỖI SAO LƯU: ${err.message}`);
  process.exit(1);
});
