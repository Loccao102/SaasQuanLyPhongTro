import { Pool } from "pg";
import { hashPassword } from "../src/modules/identity/auth/password.js";

const databaseUrl = process.env.DATABASE_URL;
const email = process.env.BOOTSTRAP_OWNER_EMAIL?.trim();
const displayName = process.env.BOOTSTRAP_OWNER_DISPLAY_NAME?.trim();
const password = process.env.BOOTSTRAP_OWNER_PASSWORD;
const organizationName = process.env.BOOTSTRAP_ORGANIZATION_NAME?.trim();
const organizationSlug = process.env.BOOTSTRAP_ORGANIZATION_SLUG?.trim();
const organizationType =
  process.env.BOOTSTRAP_ORGANIZATION_TYPE?.trim() || "INDIVIDUAL";

if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!email) throw new Error("BOOTSTRAP_OWNER_EMAIL is required.");
if (!displayName) throw new Error("BOOTSTRAP_OWNER_DISPLAY_NAME is required.");
if (!password) throw new Error("BOOTSTRAP_OWNER_PASSWORD is required.");
if (!organizationName) throw new Error("BOOTSTRAP_ORGANIZATION_NAME is required.");
if (!organizationSlug) throw new Error("BOOTSTRAP_ORGANIZATION_SLUG is required.");
if (!["INDIVIDUAL","HOUSEHOLD_BUSINESS","COMPANY"].includes(organizationType)) {
  throw new Error("BOOTSTRAP_ORGANIZATION_TYPE is invalid.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

async function main(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query<{ id: string }>(
      `INSERT INTO users (email, display_name)
       VALUES ($1, $2)
       ON CONFLICT (lower(email)) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             updated_at = now()
       RETURNING id::text`,
      [email, displayName]
    );
    const userId = userResult.rows[0]!.id;

    const organizationResult = await client.query<{ id: string }>(
      `INSERT INTO organizations (slug, name, organization_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name,
             updated_at = now()
       RETURNING id::text`,
      [organizationSlug, organizationName, organizationType]
    );
    const organizationId = organizationResult.rows[0]!.id;

    const membershipResult = await client.query<{ id: string }>(
      `INSERT INTO organization_memberships (
         organization_id, user_id, role, status
       ) VALUES ($1, $2, 'OWNER', 'ACTIVE')
       ON CONFLICT (organization_id, user_id) DO UPDATE
         SET role = 'OWNER',
             status = 'ACTIVE',
             updated_at = now()
       RETURNING id::text`,
      [organizationId, userId]
    );
    const membershipId = membershipResult.rows[0]!.id;

    await client.query(
      `INSERT INTO membership_scopes (
         organization_id, membership_id, scope_type
       ) VALUES ($1, $2, 'ORGANIZATION')
       ON CONFLICT DO NOTHING`,
      [organizationId, membershipId]
    );

    const existingCredential = await client.query(
      "SELECT 1 FROM user_password_credentials WHERE user_id = $1",
      [userId]
    );

    if (!existingCredential.rowCount) {
      const credential = await hashPassword(password!);
      await client.query(
        `INSERT INTO user_password_credentials (
           user_id, password_hash, password_salt, scrypt_n, scrypt_r, scrypt_p
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          credential.hash,
          credential.salt,
          credential.n,
          credential.r,
          credential.p
        ]
      );
    }

    await client.query("COMMIT");
    console.log(
      `[auth] owner ready: user=${userId} organization=${organizationId}`
    );
    if (existingCredential.rowCount) {
      console.log(
        "[auth] existing password credential preserved; bootstrap did not reset it."
      );
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error("[auth] bootstrap owner failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
