import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import type { CommercialPolicyService } from "../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../database/database.service.js";
import type { AuthSecurityService } from "../identity/auth/auth-security.service.js";
import { CmsTenantAccountsService } from "./cms-tenant-accounts.service.js";

const organizationId = "41000000-0000-4000-8000-000000000001";
const tenantUserId = "42000000-0000-4000-8000-000000000001";
const platformUserId = "43000000-0000-4000-8000-000000000001";
const membershipId = "44000000-0000-4000-8000-000000000001";
const sessionId = "45000000-0000-4000-8000-000000000001";

async function cleanup(pool: Pool) {
  await pool.query(
    "DELETE FROM platform_audit_events WHERE organization_id = $1::uuid",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM auth_security_alerts WHERE user_id = $1::uuid",
    [tenantUserId]
  );
  await pool.query(
    "DELETE FROM auth_security_events WHERE user_id = $1::uuid",
    [tenantUserId]
  );
  await pool.query(
    "DELETE FROM organization_memberships WHERE organization_id = $1::uuid",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM users WHERE id = ANY($1::uuid[])",
    [[tenantUserId, platformUserId]]
  );
  await pool.query("DELETE FROM organizations WHERE id = $1::uuid", [
    organizationId
  ]);
}

test("Control Plane authenticator recovery clears strong credentials and revokes sessions", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set.");

  const fixture = new Pool({ connectionString });
  const database = new DatabaseService();
  const securityEvents: Array<Record<string, unknown>> = [];
  const commercialPolicy = {} as CommercialPolicyService;
  const authSecurity = {
    async recordEvent(input: Record<string, unknown>) {
      securityEvents.push(input);
    }
  } as unknown as AuthSecurityService;
  const service = new CmsTenantAccountsService(
    database,
    commercialPolicy,
    authSecurity
  );

  try {
    await cleanup(fixture);

    await fixture.query(
      `INSERT INTO organizations (
         id, slug, name, organization_type
       )
       VALUES ($1, 'recovery-integration-org', 'Recovery Integration Org', 'INDIVIDUAL')`,
      [organizationId]
    );
    await fixture.query(
      `INSERT INTO users (
         id,
         organization_id,
         account_type,
         email,
         display_name,
         status,
         email_verified_at
       )
       VALUES
         ($1, $2, 'TENANT', 'recovery-owner@example.invalid', 'Recovery Owner', 'ACTIVE', now()),
         ($3, NULL, 'PLATFORM', 'recovery-platform@example.invalid', 'Recovery Platform', 'ACTIVE', now())`,
      [tenantUserId, organizationId, platformUserId]
    );
    await fixture.query(
      `INSERT INTO organization_memberships (
         id, organization_id, user_id, role, status
       )
       VALUES ($1, $2, $3, 'OWNER', 'ACTIVE')`,
      [membershipId, organizationId, tenantUserId]
    );

    await fixture.query(
      `INSERT INTO user_totp_credentials (
         user_id,
         secret_ciphertext,
         secret_iv,
         secret_tag,
         confirmed_at
       )
       VALUES ($1, $2, $3, $4, now())`,
      [
        tenantUserId,
        Buffer.from("ciphertext"),
        Buffer.alloc(12, 1),
        Buffer.alloc(16, 2)
      ]
    );
    await fixture.query(
      `INSERT INTO user_mfa_recovery_codes (user_id, code_hash)
       VALUES ($1, $2)`,
      [tenantUserId, Buffer.alloc(32, 3)]
    );
    await fixture.query(
      `INSERT INTO user_passkeys (
         user_id,
         credential_id,
         public_key,
         counter,
         transports,
         device_type,
         backed_up,
         name
       )
       VALUES ($1, 'recovery-passkey', $2, 0, ARRAY['internal'], 'singleDevice', false, 'Recovery passkey')`,
      [tenantUserId, Buffer.from([1, 2, 3, 4])]
    );
    await fixture.query(
      `INSERT INTO auth_sessions (
         id,
         user_id,
         organization_id,
         auth_version,
         token_hash,
         csrf_hash,
         expires_at
       )
       VALUES ($1, $2, $3, 1, $4, $5, now() + interval '1 day')`,
      [
        sessionId,
        tenantUserId,
        organizationId,
        Buffer.alloc(32, 4),
        Buffer.alloc(32, 5)
      ]
    );
    await fixture.query(
      `INSERT INTO auth_mfa_challenges (
         user_id, token_hash, expires_at, purpose
       )
       VALUES ($1, $2, now() + interval '5 minutes', 'VERIFY')`,
      [tenantUserId, Buffer.alloc(32, 6)]
    );
    await fixture.query(
      `INSERT INTO auth_webauthn_challenges (
         user_id,
         challenge,
         purpose,
         parent_mfa_token_hash,
         session_id,
         expires_at
       )
       VALUES ($1, 'recovery-registration-challenge', 'REGISTRATION', NULL, NULL, now() + interval '5 minutes')`,
      [tenantUserId]
    );
    await fixture.query(
      `INSERT INTO auth_password_reset_tokens (
         user_id, token_hash, expires_at
       )
       VALUES ($1, $2, now() + interval '30 minutes')`,
      [tenantUserId, Buffer.alloc(32, 7)]
    );

    const before = await fixture.query<{ auth_version: number }>(
      "SELECT auth_version FROM users WHERE id = $1::uuid",
      [tenantUserId]
    );

    const result = await service.resetAuthenticators(
      { userId: platformUserId, role: "PLATFORM_ADMIN" },
      organizationId,
      tenantUserId,
      "User lost authenticator and recovery codes"
    );

    assert.equal(result.authenticatorsReset, true);
    assert.equal(result.removedPasskeys, 1);
    assert.equal(result.sessionsRevoked, 1);
    assert.equal(result.passwordResetTokensInvalidated, true);

    for (const table of [
      "user_totp_credentials",
      "user_mfa_recovery_codes",
      "user_passkeys",
      "auth_mfa_challenges"
    ]) {
      const remaining = await fixture.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${table} WHERE user_id = $1::uuid`,
        [tenantUserId]
      );
      assert.equal(remaining.rows[0]?.count, "0");
    }

    const webauthn = await fixture.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM auth_webauthn_challenges
       WHERE user_id = $1::uuid OR session_id = $2::uuid`,
      [tenantUserId, sessionId]
    );
    assert.equal(webauthn.rows[0]?.count, "0");

    const session = await fixture.query<{ revoked_at: Date | null }>(
      "SELECT revoked_at FROM auth_sessions WHERE id = $1::uuid",
      [sessionId]
    );
    assert.ok(session.rows[0]?.revoked_at);

    const resetToken = await fixture.query<{ consumed_at: Date | null }>(
      `SELECT consumed_at
       FROM auth_password_reset_tokens
       WHERE user_id = $1::uuid
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantUserId]
    );
    assert.ok(resetToken.rows[0]?.consumed_at);

    const after = await fixture.query<{ auth_version: number }>(
      "SELECT auth_version FROM users WHERE id = $1::uuid",
      [tenantUserId]
    );
    assert.equal(
      after.rows[0]?.auth_version,
      (before.rows[0]?.auth_version ?? 0) + 1
    );

    const audit = await fixture.query<{ action: string }>(
      `SELECT action
       FROM platform_audit_events
       WHERE organization_id = $1::uuid
         AND target_key = $2
       ORDER BY occurred_at DESC
       LIMIT 1`,
      [organizationId, tenantUserId]
    );
    assert.equal(
      audit.rows[0]?.action,
      "TENANT_ACCOUNT_AUTHENTICATORS_RESET"
    );

    assert.equal(securityEvents.length, 1);
    assert.equal(
      securityEvents[0]?.eventType,
      "ACCOUNT_AUTHENTICATORS_RESET"
    );
  } finally {
    await cleanup(fixture);
    await fixture.end();
  }
});
