import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { verifyPassword } from "../auth/password.js";
import {
  MembershipInvitationService,
  MembershipInvitationUnavailableError
} from "./membership-invitation.service.js";

const organizationId = "31000000-0000-4000-8000-000000000001";
const inviterUserId = "31000000-0000-4000-8000-000000000002";
const invitedUserId = "31000000-0000-4000-8000-000000000003";
const secondInvitedUserId = "31000000-0000-4000-8000-000000000004";
const inviterMembershipId = "31000000-0000-4000-8000-000000000005";
const invitedMembershipId = "31000000-0000-4000-8000-000000000006";
const secondMembershipId = "31000000-0000-4000-8000-000000000007";
const password = "invitation integration password 2026";

async function cleanup(pool: Pool) {
  await pool.query("DELETE FROM audit_events WHERE organization_id = $1", [
    organizationId
  ]);
  await pool.query(
    "DELETE FROM membership_invitations WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM user_password_credentials WHERE user_id = ANY($1::uuid[])",
    [[invitedUserId, secondInvitedUserId]]
  );
  await pool.query(
    "DELETE FROM membership_scopes WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM organization_memberships WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query(
    "DELETE FROM organization_subscriptions WHERE organization_id = $1",
    [organizationId]
  );
  await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
  await pool.query(
    "DELETE FROM users WHERE id = ANY($1::uuid[])",
    [[inviterUserId, invitedUserId, secondInvitedUserId]]
  );
}

test("membership invitation token is hashed, single-use, resendable and revocable", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL must be set.");

  const pool = new Pool({ connectionString });
  const db = new DatabaseService();
  const service = new MembershipInvitationService(
    db,
    new CommercialPolicyService()
  );

  try {
    await cleanup(pool);

    await pool.query(
      `INSERT INTO users (id, email, display_name)
       VALUES
         ($1, 'inviter@example.invalid', 'Inviter'),
         ($2, 'invitee@example.invalid', 'Invitee'),
         ($3, 'invitee-two@example.invalid', 'Invitee Two')`,
      [inviterUserId, invitedUserId, secondInvitedUserId]
    );
    await pool.query(
      `INSERT INTO organizations (
         id, slug, name, organization_type
       )
       VALUES ($1, 'invitation-integration', 'Invitation Integration', 'INDIVIDUAL')`,
      [organizationId]
    );

    const plan = await pool.query<{
      plan_id: string;
      plan_version_id: string;
    }>(
      `SELECT id::text AS plan_id, current_version_id::text AS plan_version_id
       FROM saas_plans
       WHERE code = 'STARTER'`
    );
    assert.ok(plan.rows[0]?.plan_version_id);
    await pool.query(
      `INSERT INTO organization_subscriptions (
         organization_id,
         plan_id,
         plan_version_id,
         status
       )
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [
        organizationId,
        plan.rows[0]!.plan_id,
        plan.rows[0]!.plan_version_id
      ]
    );
    await pool.query(
      `INSERT INTO organization_memberships (
         id, organization_id, user_id, role, status
       )
       VALUES
         ($1, $2, $3, 'OWNER', 'ACTIVE'),
         ($4, $2, $5, 'STAFF', 'INVITED'),
         ($6, $2, $7, 'VIEWER', 'INVITED')`,
      [
        inviterMembershipId,
        organizationId,
        inviterUserId,
        invitedMembershipId,
        invitedUserId,
        secondMembershipId,
        secondInvitedUserId
      ]
    );

    const issued = await db.withTransaction((client) =>
      service.issueInTransaction(client, {
        organizationId,
        membershipId: invitedMembershipId,
        createdByUserId: inviterUserId
      })
    );

    const stored = await pool.query<{ token_hash: Buffer }>(
      `SELECT token_hash
       FROM membership_invitations
       WHERE organization_id = $1 AND membership_id = $2`,
      [organizationId, invitedMembershipId]
    );
    assert.equal(stored.rows.length, 1);
    assert.notEqual(stored.rows[0]!.token_hash.toString("utf8"), issued.token);

    const preview = await service.inspect(issued.token);
    assert.equal(preview.requiresPassword, true);
    assert.equal(preview.email, "invitee@example.invalid");

    const accepted = await service.accept({
      token: issued.token,
      password
    });
    assert.equal(accepted.status, "ACTIVE");

    const membership = await pool.query<{ status: string }>(
      "SELECT status FROM organization_memberships WHERE id = $1",
      [invitedMembershipId]
    );
    assert.equal(membership.rows[0]?.status, "ACTIVE");

    const credential = await pool.query<{
      password_hash: Buffer;
      password_salt: Buffer;
      scrypt_n: number;
      scrypt_r: number;
      scrypt_p: number;
    }>(
      `SELECT password_hash, password_salt, scrypt_n, scrypt_r, scrypt_p
       FROM user_password_credentials
       WHERE user_id = $1`,
      [invitedUserId]
    );
    assert.equal(
      await verifyPassword(password, {
        hash: credential.rows[0]!.password_hash,
        salt: credential.rows[0]!.password_salt,
        n: credential.rows[0]!.scrypt_n,
        r: credential.rows[0]!.scrypt_r,
        p: credential.rows[0]!.scrypt_p
      }),
      true
    );

    await assert.rejects(
      () => service.inspect(issued.token),
      MembershipInvitationUnavailableError
    );

    const firstForSecond = await db.withTransaction((client) =>
      service.issueInTransaction(client, {
        organizationId,
        membershipId: secondMembershipId,
        createdByUserId: inviterUserId
      })
    );
    const resent = await db.withTransaction((client) =>
      service.issueInTransaction(client, {
        organizationId,
        membershipId: secondMembershipId,
        createdByUserId: inviterUserId
      })
    );
    await assert.rejects(
      () => service.inspect(firstForSecond.token),
      MembershipInvitationUnavailableError
    );
    assert.equal((await service.inspect(resent.token)).role, "VIEWER");

    await db.withTransaction((client) =>
      service.revokeInTransaction(client, {
        organizationId,
        membershipId: secondMembershipId
      })
    );
    await assert.rejects(
      () => service.inspect(resent.token),
      MembershipInvitationUnavailableError
    );
  } finally {
    await db.onModuleDestroy();
    await cleanup(pool);
    await pool.end();
  }
});
