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

async function main(): Promise<void> {
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
