import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import { AuthenticationRepository } from "./authentication.repository.js";
import {
  AuthenticationService,
  InvalidCredentialsError
} from "./authentication.service.js";
import { hashPassword } from "./password.js";
import { hashOpaqueToken } from "./session-token.js";

const userId = "21000000-0000-0000-0000-000000000001";
const organizationId = "11000000-0000-0000-0000-000000000001";
const membershipId = "22000000-0000-0000-0000-000000000001";
const email = "auth-test@example.invalid";
const password = "auth integration password 2026";

async function cleanup(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM auth_sessions WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM user_password_credentials WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM membership_scopes WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organization_memberships WHERE organization_id = $1", [organizationId]);
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

test("login creates opaque session, resolves memberships and supports revocation", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set.");

  const fixture = new Pool({ connectionString });
  const database = new DatabaseService();
  const repository = new AuthenticationRepository(database);
  const service = new AuthenticationService(repository);

  try {
    await cleanup(fixture);

    await fixture.query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, $2, 'Auth Integration User')`,
      [userId, email]
    );
    await fixture.query(
      `INSERT INTO organizations (
         id, slug, name, organization_type
       ) VALUES (
         $1, 'auth-integration-org', 'Auth Integration Org', 'INDIVIDUAL'
       )`,
      [organizationId]
    );
    await fixture.query(
      `INSERT INTO organization_memberships (
         id, organization_id, user_id, role, status
       ) VALUES ($1, $2, $3, 'OWNER', 'ACTIVE')`,
      [membershipId, organizationId, userId]
    );
    await fixture.query(
      `INSERT INTO membership_scopes (
         organization_id, membership_id, scope_type
       ) VALUES ($1, $2, 'ORGANIZATION')`,
      [organizationId, membershipId]
    );

    const credential = await hashPassword(password);
    await fixture.query(
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

    await assert.rejects(
      () => service.login({ email, password: "definitely wrong password" }),
      InvalidCredentialsError
    );

    const login = await service.login({ email, password });
    assert.equal(login.user.id, userId);
    assert.deepEqual(login.memberships, [
      {
        organizationId,
        organizationName: "Auth Integration Org",
        role: "OWNER"
      }
    ]);

    const stored = await fixture.query<{ token_hash: Buffer }>(
      "SELECT token_hash FROM auth_sessions WHERE id = $1",
      [login.sessionId]
    );
    assert.deepEqual(
      stored.rows[0]!.token_hash,
      hashOpaqueToken(login.sessionToken)
    );
    assert.notEqual(
      stored.rows[0]!.token_hash.toString("utf8"),
      login.sessionToken
    );

    const session = await service.authenticateSession(login.sessionToken);
    assert.ok(session);
    assert.equal(session.userId, userId);
    assert.equal(service.verifyCsrf(session, login.csrfToken), true);
    assert.equal(
      service.verifyCsrf(
        session,
        "wrong-csrf-token-value-12345678901234567890"
      ),
      false
    );

    await service.logout(login.sessionToken);
    assert.equal(await service.authenticateSession(login.sessionToken), null);

    const secondLogin = await service.login({ email, password });
    await fixture.query(
      "UPDATE users SET auth_version = auth_version + 1 WHERE id = $1",
      [userId]
    );
    assert.equal(
      await service.authenticateSession(secondLogin.sessionToken),
      null
    );
  } finally {
    await database.onModuleDestroy();
    await cleanup(fixture);
    await fixture.end();
  }
});
