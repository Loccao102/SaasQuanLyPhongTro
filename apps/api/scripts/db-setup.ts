import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const migrationsDir = resolve(apiRoot, "db", "migrations");
const devSeedPath = resolve(apiRoot, "db", "seeds", "cms_dev_operator.sql");

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? String(fallback));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(name + " must be a positive integer.");
  }
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function waitForDatabase(): Promise<void> {
  const retries = positiveInteger("DB_SETUP_CONNECT_RETRIES", 30);
  const delayMs = positiveInteger("DB_SETUP_CONNECT_DELAY_MS", 1000);
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      if (attempt > 1) {
        console.log("[db] database connection is ready");
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      console.warn(
        "[db] database not ready (" +
          String(attempt) +
          "/" +
          String(retries) +
          "), retrying in " +
          String(delayMs) +
          "ms"
      );
      await delay(delayMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Database did not become ready.");
}

async function main(): Promise<void> {
  await waitForDatabase();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && !file.endsWith(".down.sql"))
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    const applied = await pool.query<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = $1",
      [file]
    );

    if (applied.rowCount) {
      console.log(`[db] skip ${file}`);
      continue;
    }

    console.log(`[db] apply ${file}`);
    const sql = await readFile(resolve(migrationsDir, file), "utf8");
    await pool.query(sql);
    await pool.query(
      "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
      [file]
    );
  }

  console.log("[db] apply idempotent development seed");
  await pool.query(await readFile(devSeedPath, "utf8"));
  console.log("[db] ready");
}

main()
  .catch((error) => {
    console.error("[db] setup failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
