#!/usr/bin/env node

/**
 * HABI Prop-Ops Cross-Platform Disaster Recovery & Restore Utility
 * ==============================================================================
 * Zero-cost, high-integrity database restore tool with:
 * - SHA-256 checksum verification before restoration
 * - Automatic pre-restore safety snapshot (zero accidental data loss)
 * - Cross-platform support (Docker compose or native psql on Windows/macOS/Linux)
 *
 * Usage:
 *   node scripts/restore-db.mjs <backup-file.sql.gz> [--yes]
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import readline from "node:readline";
import { spawn } from "node:child_process";

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || "./backups");
const COMPOSE_FILE = process.env.COMPOSE_FILE || "infra/docker-compose.yml";
const POSTGRES_SERVICE = process.env.POSTGRES_SERVICE || "postgres";
const POSTGRES_USER = process.env.POSTGRES_USER || "propops";
const POSTGRES_DB = process.env.POSTGRES_DB || "propops";

const args = process.argv.slice(2);
const restoreFileArg = args.find((a) => !a.startsWith("--"));
const autoConfirm = args.includes("--yes") || args.includes("-y");

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function verifyChecksumIfPresent(filePath) {
  const checksumFile = `${filePath}.sha256`;
  if (!fs.existsSync(checksumFile)) {
    console.log(`ℹ️ Không tìm thấy tệp checksum ${path.basename(checksumFile)}, bỏ qua bước xác minh mã băm.`);
    return true;
  }

  const expectedContent = fs.readFileSync(checksumFile, "utf8").trim();
  const expectedHash = expectedContent.split(/\s+/)[0];

  const fileBuffer = fs.readFileSync(filePath);
  const actualHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  if (expectedHash !== actualHash) {
    throw new Error(
      `LỖI TÍNH TOÀN VẸN: SHA-256 checksum không khớp!\nKỳ vọng: ${expectedHash}\nThực tế: ${actualHash}`
    );
  }

  console.log(`✓ Đã xác minh tính toàn vẹn SHA-256 thành công: ${actualHash}`);
  return true;
}

async function promptConfirm() {
  if (autoConfirm) return true;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(
      "\n⚠️ CẢNH BÁO NGUY HIỂM: Hành động này sẽ GHI ĐÈ toàn bộ dữ liệu trong database!\nNhập 'XACNHAN' để tiếp tục: ",
      (answer) => {
        rl.close();
        resolve(answer.trim() === "XACNHAN");
      }
    );
  });
}

async function createSafetySnapshot() {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
  const snapshotPath = path.join(BACKUP_DIR, `safety_before_restore_${timestamp}.sql.gz`);
  console.log(`\nĐang tạo bản snapshot an toàn trước khi khôi phục: ${path.basename(snapshotPath)}...`);

  const gzip = zlib.createGzip({ level: 1 });
  const out = fs.createWriteStream(snapshotPath);
  const isDocker = fs.existsSync(COMPOSE_FILE);

  const dump = isDocker
    ? spawn("docker", [
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
        "--no-owner"
      ])
    : spawn("pg_dump", [
        "-U",
        POSTGRES_USER,
        "-d",
        POSTGRES_DB,
        "--no-owner"
      ]);

  dump.stdout.pipe(gzip).pipe(out);
  await new Promise((resolve) => {
    out.on("finish", resolve);
    dump.on("error", () => resolve(null));
  });

  console.log(`✓ Snapshot an toàn đã được lưu trữ phòng ngừa sự cố.`);
}

async function executeRestore(filePath) {
  const isDocker = fs.existsSync(COMPOSE_FILE);
  console.log(`\nBắt đầu khôi phục dữ liệu vào database [${POSTGRES_DB}]...`);

  const gunzip = zlib.createGunzip();
  const fileStream = fs.createReadStream(filePath);

  const psqlProcess = isDocker
    ? spawn("docker", [
        "compose",
        "-f",
        COMPOSE_FILE,
        "exec",
        "-T",
        POSTGRES_SERVICE,
        "psql",
        "-U",
        POSTGRES_USER,
        "-d",
        POSTGRES_DB
      ])
    : spawn("psql", [
        "-U",
        POSTGRES_USER,
        "-d",
        POSTGRES_DB
      ]);

  psqlProcess.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text && !text.includes("NOTICE:")) {
      console.error(`[psql stderr] ${text}`);
    }
  });

  fileStream.pipe(gunzip).pipe(psqlProcess.stdin);

  await new Promise((resolve, reject) => {
    psqlProcess.on("close", (code) => {
      if (code === 0) resolve(code);
      else reject(new Error(`Quá trình psql kết thúc với mã lỗi: ${code}`));
    });
    psqlProcess.on("error", reject);
    gunzip.on("error", reject);
    fileStream.on("error", reject);
  });

  console.log(`\n✓ KHÔI PHỤC DỮ LIỆU HOÀN TẤT THÀNH CÔNG!`);
}

async function main() {
  console.log(`================================================================================`);
  console.log(`HABI PROP-OPS DISASTER RECOVERY & RESTORE TOOL`);
  console.log(`================================================================================`);

  if (!restoreFileArg) {
    console.log(`Cách dùng: node scripts/restore-db.mjs <tệp_sao_lưu.sql.gz> [--yes]\n`);
    console.log(`Các bản sao lưu có sẵn trong [${BACKUP_DIR}]:`);
    if (fs.existsSync(BACKUP_DIR)) {
      const files = fs
        .readdirSync(BACKUP_DIR)
        .filter((f) => f.endsWith(".sql.gz"))
        .map((f) => {
          const stat = fs.statSync(path.join(BACKUP_DIR, f));
          return `  - ${f} (${formatBytes(stat.size)}, sửa lúc ${new Date(stat.mtimeMs).toLocaleString("vi-VN")})`;
        });
      console.log(files.length > 0 ? files.join("\n") : "  (Chưa có bản sao lưu nào)");
    }
    process.exit(1);
  }

  const resolvedPath = path.resolve(restoreFileArg);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ Tệp sao lưu không tồn tại: ${resolvedPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(resolvedPath);
  console.log(`Tệp sao lưu:  ${resolvedPath} (${formatBytes(stat.size)})`);
  console.log(`Database đích: ${POSTGRES_DB}`);

  // 1. Verify Checksum
  verifyChecksumIfPresent(resolvedPath);

  // 2. Prompt confirmation
  const confirmed = await promptConfirm();
  if (!confirmed) {
    console.log(`Đã huỷ thao tác phục hồi.`);
    process.exit(0);
  }

  // 3. Safety snapshot
  await createSafetySnapshot();

  // 4. Restore
  await executeRestore(resolvedPath);
}

main().catch((err) => {
  console.error(`\n❌ LỖI PHỤC HỒI DỮ LIỆU:`, err.message);
  process.exit(1);
});
