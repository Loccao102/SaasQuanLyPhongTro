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
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
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
      `INSERT INTO users (id, email, display_name, email_verified_at)
       VALUES ($1, $2, 'Auth Integration User', now())`,
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
       ) VALUES ($1, $2, $3, 'ADMIN', 'ACTIVE')`,
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

    await assert.rejects(
      () =>
        service.login({
          email,
          password,
          accountType: "PLATFORM"
        }),
      InvalidCredentialsError
    );

    const loginResult = await service.login({
      email,
      password,
      accountType: "TENANT"
    });
    assert.equal("mfaRequired" in loginResult, false);
    assert.equal("mfaEnrollmentRequired" in loginResult, false);
    if (
      "mfaRequired" in loginResult ||
      "mfaEnrollmentRequired" in loginResult
    ) {
      throw new Error("ADMIN fixture unexpectedly requires MFA.");
    }
    const login = loginResult;
    assert.equal(login.user.id, userId);
    assert.deepEqual(login.memberships, [
      {
        organizationId,
        organizationName: "Auth Integration Org",
        role: "ADMIN"
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
    const freshStepUp = service.stepUpStatus(session);
    assert.equal(freshStepUp.recent, true);

    await fixture.query(
      `UPDATE auth_sessions
       SET reauthenticated_at = now() - interval '20 minutes'
       WHERE id = $1::uuid`,
      [login.sessionId]
    );
    const staleSession = await service.authenticateSession(login.sessionToken);
    assert.ok(staleSession);
    assert.equal(service.stepUpStatus(staleSession).recent, false);

    await service.stepUpWithPassword(staleSession, password);
    assert.equal(service.stepUpStatus(staleSession).recent, true);


    await service.logout(login.sessionToken);
    assert.equal(await service.authenticateSession(login.sessionToken), null);

    await fixture.query(
      `UPDATE organization_memberships
       SET role = 'OWNER', updated_at = now()
       WHERE id = $1`,
      [membershipId]
    );
    const ownerLogin = await service.login({
      email,
      password,
      accountType: "TENANT"
    });
    assert.equal("mfaEnrollmentRequired" in ownerLogin, true);
    if (!("mfaEnrollmentRequired" in ownerLogin)) {
      throw new Error("OWNER should require MFA enrollment.");
    }
    assert.equal(ownerLogin.requiredByRole, "OWNER");

    const activeAfterOwnerPrimary = await fixture.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM auth_sessions
       WHERE user_id = $1::uuid
         AND revoked_at IS NULL
         AND expires_at > now()`,
      [userId]
    );
    assert.equal(activeAfterOwnerPrimary.rows[0]?.count, "0");

    await fixture.query(
      `UPDATE organization_memberships
       SET role = 'ADMIN', updated_at = now()
       WHERE id = $1`,
      [membershipId]
    );

    const secondLoginResult = await service.login({
      email,
      password,
      accountType: "TENANT"
    });
    assert.equal("mfaRequired" in secondLoginResult, false);
    assert.equal("mfaEnrollmentRequired" in secondLoginResult, false);
    if (
      "mfaRequired" in secondLoginResult ||
      "mfaEnrollmentRequired" in secondLoginResult
    ) {
      throw new Error("ADMIN fixture unexpectedly requires MFA.");
    }
    const secondLogin = secondLoginResult;
    await repository.replaceWebAuthnChallenge({
      userId,
      challenge: "integration-registration-challenge",
      purpose: "REGISTRATION",
      expiresAt: new Date(Date.now() + 60_000)
    });
    const registrationChallenge =
      await repository.getActiveWebAuthnChallenge({
        userId,
        purpose: "REGISTRATION"
      });
    assert.ok(registrationChallenge);

    const passkey = await repository.completePasskeyRegistration({
      challengeId: registrationChallenge.id,
      userId,
      credentialId: "integration-passkey-credential",
      publicKey: new Uint8Array([1, 2, 3, 4]),
      counter: 0,
      transports: ["internal"],
      deviceType: "singleDevice",
      backedUp: false,
      name: "Integration passkey"
    });
    assert.ok(passkey);

    const replayedRegistration =
      await repository.completePasskeyRegistration({
        challengeId: registrationChallenge.id,
        userId,
        credentialId: "integration-passkey-replay",
        publicKey: new Uint8Array([4, 3, 2, 1]),
        counter: 0,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        name: "Replay"
      });
    assert.equal(replayedRegistration, null);

    const parentMfaToken = hashOpaqueToken(
      "integration-mfa-token-012345678901234567890123456789"
    );
    await fixture.query(
      `INSERT INTO auth_mfa_challenges (
         user_id, token_hash, expires_at, purpose
       )
       VALUES ($1::uuid, $2, now() + interval '1 minute', 'VERIFY')`,
      [userId, parentMfaToken]
    );

    await repository.replaceWebAuthnChallenge({
      userId,
      challenge: "integration-authentication-challenge",
      purpose: "AUTHENTICATION",
      parentMfaTokenHash: parentMfaToken,
      expiresAt: new Date(Date.now() + 60_000)
    });
    const authenticationChallenge =
      await repository.getActiveWebAuthnChallenge({
        userId,
        purpose: "AUTHENTICATION",
        parentMfaTokenHash: parentMfaToken
      });
    assert.ok(authenticationChallenge);

    assert.equal(
      await repository.completePasskeyAuthentication({
        webauthnChallengeId: authenticationChallenge.id,
        userId,
        mfaTokenHash: parentMfaToken,
        passkeyId: passkey.id,
        newCounter: 1
      }),
      true
    );
    assert.equal(
      await repository.completePasskeyAuthentication({
        webauthnChallengeId: authenticationChallenge.id,
        userId,
        mfaTokenHash: parentMfaToken,
        passkeyId: passkey.id,
        newCounter: 2
      }),
      false
    );

    const storedPasskey = await repository.findPasskeyByCredential(
      userId,
      "integration-passkey-credential"
    );
    assert.equal(storedPasskey?.counter, 1);
    assert.ok(storedPasskey?.lastUsedAt);

    await fixture.query(
      `UPDATE auth_sessions
       SET reauthenticated_at = now() - interval '20 minutes'
       WHERE id = $1::uuid`,
      [secondLogin.sessionId]
    );

    await repository.replaceWebAuthnChallenge({
      userId,
      challenge: "integration-step-up-challenge",
      purpose: "STEP_UP",
      sessionId: secondLogin.sessionId,
      expiresAt: new Date(Date.now() + 60_000)
    });
    const stepUpChallenge =
      await repository.getActiveWebAuthnChallenge({
        userId,
        purpose: "STEP_UP",
        sessionId: secondLogin.sessionId
      });
    assert.ok(stepUpChallenge);

    assert.equal(
      await repository.completePasskeyStepUp({
        webauthnChallengeId: stepUpChallenge.id,
        userId,
        sessionId: secondLogin.sessionId,
        passkeyId: passkey.id,
        newCounter: 2
      }),
      true
    );
    assert.equal(
      await repository.completePasskeyStepUp({
        webauthnChallengeId: stepUpChallenge.id,
        userId,
        sessionId: secondLogin.sessionId,
        passkeyId: passkey.id,
        newCounter: 3
      }),
      false
    );

    const refreshedSession = await service.authenticateSession(
      secondLogin.sessionToken
    );
    assert.ok(refreshedSession);
    assert.equal(service.stepUpStatus(refreshedSession).recent, true);

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
