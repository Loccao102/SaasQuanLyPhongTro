import { Pool } from "pg";
import {
  collectSePayPreflightDatabaseSnapshot,
  evaluateSePayProductionPreflight
} from "../src/modules/integrations/sepay-production-preflight.js";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";

async function main(): Promise<void> {
  if (!databaseUrl) {
    console.error(
      "[FAIL] database-url - DATABASE_URL is required for SePay production preflight."
    );
    process.exitCode = 1;
    return;
  }

  const scopeKey =
    process.env.SEPAY_RECONCILIATION_SCOPE_KEY?.trim() || "default";
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });

  try {
    const snapshot = await collectSePayPreflightDatabaseSnapshot(
      pool,
      scopeKey
    );
    const report = evaluateSePayProductionPreflight(process.env, snapshot);

    console.log("SePay production preflight");
    for (const check of report.checks) {
      console.log("[" + check.status + "] " + check.id + " - " + check.message);
    }
    console.log(
      "Summary: " +
        String(report.summary.pass) +
        " pass, " +
        String(report.summary.warn) +
        " warning(s), " +
        String(report.summary.fail) +
        " failure(s)."
    );

    if (!report.ready) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : "Unknown preflight error.";
  console.error("[FAIL] preflight-runtime - " + message);
  process.exitCode = 1;
});
