#!/usr/bin/env node

/**
 * HABI Prop-Ops Zero-Cost Load Testing & Benchmark Tool
 * ==============================================================================
 * High-throughput, zero-dependency load testing runner using Node.js native HTTP.
 * Benchmarks API throughput, latency quantiles (p50, p90, p95, p99), and error rates
 * under peak concurrent traffic without requiring expensive cloud load test services.
 *
 * Usage:
 *   node scripts/load-test.mjs [--url http://localhost:4000/api] [--concurrency 50] [--duration 10] [--scenario health]
 */

import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import crypto from "node:crypto";

// ── Parse CLI Arguments ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
HABI Prop-Ops Zero-Cost Load Testing & Benchmark Tool
Cách dùng:
  node scripts/load-test.mjs [tùy_chọn]

Tùy chọn:
  --url <url>           Địa chỉ API gốc (Mặc định: http://localhost:4000/api)
  --concurrency <số>    Số Virtual Users đồng thời (Mặc định: 50)
  --duration <giây>     Thời gian kiểm thử tính bằng giây (Mặc định: 10)
  --scenario <kịch_bản> Kịch bản kiểm thử: 'health' | 'public-invoice' | 'sse-poll' | 'all' (Mặc định: health)
  -h, --help            Hiển thị trợ giúp này
`);
  process.exit(0);
}

function getArg(name, defaultValue) {
  const index = args.indexOf(name);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return defaultValue;
}

const BASE_URL = getArg("--url", process.env.API_BASE_URL || "http://localhost:4000/api").replace(/\/$/, "");
const CONCURRENCY = Math.max(1, parseInt(getArg("--concurrency", "50"), 10));
const DURATION_SECONDS = Math.max(1, parseInt(getArg("--duration", "10"), 10));
const SCENARIO = getArg("--scenario", "health"); // 'health' | 'public-invoice' | 'sse-poll' | 'all'

// ── HTTP Agent with Keep-Alive ───────────────────────────────────────────────

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: CONCURRENCY * 2,
  keepAliveMsecs: 3000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: CONCURRENCY * 2,
  keepAliveMsecs: 3000
});

function request(urlStr, options = {}) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === "https:";
    const agent = isHttps ? httpsAgent : httpAgent;
    const client = isHttps ? https : http;

    const start = performance.now();
    const req = client.request(
      url,
      {
        method: options.method || "GET",
        headers: {
          "Connection": "keep-alive",
          "User-Agent": "HabiLoadTest/1.0",
          ...(options.headers || {})
        },
        agent,
        timeout: 5000
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          const duration = performance.now() - start;
          resolve({
            statusCode: res.statusCode || 0,
            duration,
            body,
            success: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 400
          });
        });
      }
    );

    req.on("error", (err) => {
      const duration = performance.now() - start;
      resolve({
        statusCode: 0,
        duration,
        error: err.message,
        success: false
      });
    });

    req.on("timeout", () => {
      req.destroy();
      const duration = performance.now() - start;
      resolve({
        statusCode: 408,
        duration,
        error: "Timeout",
        success: false
      });
    });

    if (options.body) {
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

// ── Benchmark Executor ───────────────────────────────────────────────────────

async function runBenchmark(name, targetUrl, requestOptionsGenerator) {
  console.log(`\n================================================================================`);
  console.log(`🚀 [LOAD TEST] ${name}`);
  console.log(`Target:      ${targetUrl}`);
  console.log(`Concurrency: ${CONCURRENCY} Virtual Users`);
  console.log(`Duration:    ${DURATION_SECONDS} seconds`);
  console.log(`================================================================================`);

  const initialMemory = process.memoryUsage();
  const latencies = [];
  const statusCodes = new Map();
  let totalRequests = 0;
  let successfulRequests = 0;
  let failedRequests = 0;

  const deadline = performance.now() + DURATION_SECONDS * 1000;
  let isRunning = true;

  async function worker() {
    while (isRunning && performance.now() < deadline) {
      const opts = requestOptionsGenerator ? requestOptionsGenerator() : {};
      const res = await request(targetUrl, opts);

      totalRequests++;
      latencies.push(res.duration);

      const code = res.statusCode;
      statusCodes.set(code, (statusCodes.get(code) || 0) + 1);

      if (res.success) {
        successfulRequests++;
      } else {
        failedRequests++;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  isRunning = false;

  const finalMemory = process.memoryUsage();

  // ── Compute Statistics ──
  latencies.sort((a, b) => a - b);
  const total = latencies.length;
  if (total === 0) {
    console.log("⚠️ Không có request nào hoàn thành. Vui lòng kiểm tra lại địa chỉ máy chủ!");
    return;
  }

  const min = latencies[0].toFixed(2);
  const max = latencies[total - 1].toFixed(2);
  const p50 = latencies[Math.floor(total * 0.5)].toFixed(2);
  const p90 = latencies[Math.floor(total * 0.9)].toFixed(2);
  const p95 = latencies[Math.floor(total * 0.95)].toFixed(2);
  const p99 = latencies[Math.floor(total * 0.99)].toFixed(2);
  const avg = (latencies.reduce((a, b) => a + b, 0) / total).toFixed(2);
  const rps = (totalRequests / DURATION_SECONDS).toFixed(1);
  const errorRate = ((failedRequests / totalRequests) * 100).toFixed(2);

  const rssDeltaMb = ((finalMemory.rss - initialMemory.rss) / (1024 * 1024)).toFixed(1);
  const heapDeltaMb = ((finalMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024)).toFixed(1);

  // ── Display Report ──
  console.log(`\n📊 KẾT QUẢ HIỆU NĂNG:`);
  console.log(`- Tổng số yêu cầu:      ${totalRequests} reqs`);
  console.log(`- Thành công:           ${successfulRequests} reqs (${((successfulRequests / totalRequests) * 100).toFixed(1)}%)`);
  console.log(`- Thất bại / Lỗi:       ${failedRequests} reqs (${errorRate}%)`);
  console.log(`- Tốc độ xử lý (RPS):   ${rps} req/sec`);
  console.log(`\n⏱️ THỜI GIAN PHẢN HỒI (LATENCY):`);
  console.log(`  Min:                  ${min} ms`);
  console.log(`  Trung bình (Avg):     ${avg} ms`);
  console.log(`  Median (p50):         ${p50} ms`);
  console.log(`  p90:                  ${p90} ms`);
  console.log(`  p95 (Ngưỡng cam kết): ${p95} ms`);
  console.log(`  p99:                  ${p99} ms`);
  console.log(`  Max:                  ${max} ms`);
  console.log(`\n💾 BỘ NHỚ BIẾN THIÊN:`);
  console.log(`  RSS Delta:            ${rssDeltaMb > 0 ? "+" : ""}${rssDeltaMb} MB`);
  console.log(`  Heap Delta:           ${heapDeltaMb > 0 ? "+" : ""}${heapDeltaMb} MB`);
  console.log(`\n📋 PHÂN BỔ MÃ HTTP TRẢ VỀ:`);
  for (const [code, count] of statusCodes.entries()) {
    console.log(`  HTTP ${code || "ERROR"}: ${count} (${((count / totalRequests) * 100).toFixed(1)}%)`);
  }

  // ── Quality Evaluation ──
  console.log(`\n🎯 ĐÁNH GIÁ CHẤT LƯỢNG CHỊU TẢI:`);
  if (parseFloat(p95) < 250 && parseFloat(errorRate) < 1.0) {
    console.log(`  ✓ ĐẠT CHUẨN XUẤT SẮC (p95 < 250ms & Error < 1%)`);
  } else if (parseFloat(p95) < 500 && parseFloat(errorRate) < 5.0) {
    console.log(`  ✓ ĐẠT YÊU CẦU CƠ BẢN (p95 < 500ms & Error < 5%)`);
  } else {
    console.log(`  ⚠️ CẦN TỐI ƯU THÊM (p95 hoặc tỷ lệ lỗi cao hơn khuyến nghị)`);
  }
}

// ── Main Controller ──────────────────────────────────────────────────────────

async function main() {
  console.log(`\n⚡ HABI PROP-OPS LOAD BENCHMARK RUNNER`);
  console.log(`Node.js Version: ${process.version}`);
  console.log(`Base URL:        ${BASE_URL}`);

  if (SCENARIO === "health" || SCENARIO === "all") {
    await runBenchmark(
      "Kernel Health Endpoint Benchmark",
      `${BASE_URL}/health`
    );
  }

  if (SCENARIO === "sse-poll" || SCENARIO === "all") {
    // Generate dummy token to test micro-cache & DB fallback rate
    const dummyToken = `habi_inv_${crypto.randomBytes(16).toString("hex")}`;
    await runBenchmark(
      "Public Invoice Status Polling & Micro-Cache Benchmark",
      `${BASE_URL}/public/renter-invoices/${dummyToken}`
    );
  }

  if (SCENARIO === "public-invoice" || SCENARIO === "all") {
    const dummyToken = `habi_inv_${crypto.randomBytes(16).toString("hex")}`;
    await runBenchmark(
      "Resident Portal Public Lookup Benchmark",
      `${BASE_URL}/public/renter-invoices/${dummyToken}/portal`
    );
  }

  console.log(`\n✓ Hoàn tất phiên kiểm thử tải!`);
}

main().catch((err) => {
  console.error("Lỗi thực thi load test:", err);
  process.exit(1);
});
