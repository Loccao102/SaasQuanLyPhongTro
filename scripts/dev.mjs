import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

const envPath = resolve(process.cwd(), ".env");

if (existsSync(envPath)) {
  loadEnvFile(envPath);
} else {
  console.warn(
    "[env] .env not found. Copy .env.example to .env or export the required variables."
  );
}

const services = [
  { name: "api", args: ["--filter", "@propops/api", "dev"] },
  { name: "admin", args: ["--filter", "@propops/admin", "dev"] },
  { name: "staff", args: ["--filter", "@propops/staff", "dev"] },
  { name: "public", args: ["--filter", "@propops/public-invoice", "dev"] },
  { name: "cms", args: ["--filter", "@propops/cms", "dev"] },
  {
    name: "notify",
    args: ["--filter", "@propops/worker", "dev"],
    env: { WORKER_ROLE: "NOTIFICATION", WORKER_ID: "local-notification-worker" }
  },
  {
    name: "billing",
    args: ["--filter", "@propops/worker", "dev"],
    env: { WORKER_ROLE: "BILLING", WORKER_ID: "local-billing-worker" }
  },
  {
    name: "webhook",
    args: ["--filter", "@propops/worker", "dev"],
    env: { WORKER_ROLE: "BILLING_WEBHOOK", WORKER_ID: "local-billing-webhook-worker" }
  }
];

const children = new Set();
let stopping = false;

function pipeLines(stream, name, target) {
  const lines = createInterface({ input: stream });
  lines.on("line", (line) => target(`[${name}] ${line}`));
}

function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;

  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }

  setTimeout(() => process.exit(exitCode), 250).unref();
}

for (const service of services) {
  const child = spawn("pnpm", service.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...service.env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32"
  });

  children.add(child);
  pipeLines(child.stdout, service.name, console.log);
  pipeLines(child.stderr, service.name, console.error);

  child.on("error", (error) => {
    console.error(`[${service.name}] failed to start:`, error);
    stopAll(1);
  });

  child.on("exit", (code, signal) => {
    children.delete(child);

    if (!stopping) {
      console.error(
        `[${service.name}] exited unexpectedly (code=${code}, signal=${signal ?? "none"}).`
      );
      stopAll(code ?? 1);
    }
  });
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
