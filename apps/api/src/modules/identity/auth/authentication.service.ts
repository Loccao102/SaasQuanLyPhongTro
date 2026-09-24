import { Injectable } from "@nestjs/common";
import {
  PASSWORD_KEY_LENGTH,
  PASSWORD_SCRYPT_N,
  PASSWORD_SCRYPT_P,
  PASSWORD_SCRYPT_R,
  verifyPassword,
  type PasswordCredential
} from "./password.js";
import {
  generateOpaqueToken,
  hashOpaqueToken,
  safeTokenHash,
  tokenMatchesHash
} from "./session-token.js";
import {
  AuthenticationRepository,
  type AuthMembershipSummary,
  type SessionIdentity
} from "./authentication.repository.js";

const DUMMY_CREDENTIAL: PasswordCredential = {
  hash: Buffer.alloc(PASSWORD_KEY_LENGTH),
  salt: Buffer.alloc(16),
  n: PASSWORD_SCRYPT_N,
  r: PASSWORD_SCRYPT_R,
  p: PASSWORD_SCRYPT_P
};

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Email or password is invalid.");
    this.name = "InvalidCredentialsError";
  }
}

export interface LoginResult {
  user: { id: string; email: string; displayName: string };
  memberships: AuthMembershipSummary[];
  sessionToken: string;
  csrfToken: string;
  sessionId: string;
  expiresAt: Date;
}

@Injectable()
export class AuthenticationService {
  constructor(private readonly repository: AuthenticationRepository) {}

  async login(input: { email: string; password: string }): Promise<LoginResult> {
    const email = input.email.trim();

    if (
      email.length === 0 ||
      email.length > 320 ||
      !email.includes("@")
    ) {
      await verifyPassword(input.password, DUMMY_CREDENTIAL);
      throw new InvalidCredentialsError();
    }

    const identity = await this.repository.findCredentialByEmail(email);
    const verified = await verifyPassword(
      input.password,
      identity?.credential ?? DUMMY_CREDENTIAL
    );

    if (!identity || identity.userStatus !== "ACTIVE" || !verified) {
      throw new InvalidCredentialsError();
    }

    const sessionToken = generateOpaqueToken();
    const csrfToken = generateOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.sessionTtlDays() * 24 * 60 * 60 * 1000
    );

    const sessionId = await this.repository.createSession({
      userId: identity.userId,
      authVersion: identity.authVersion,
      tokenHash: hashOpaqueToken(sessionToken),
      csrfHash: hashOpaqueToken(csrfToken),
      expiresAt
    });

    return {
      user: {
        id: identity.userId,
        email: identity.email,
        displayName: identity.displayName
      },
      memberships: await this.repository.listActiveMemberships(
        identity.userId
      ),
      sessionToken,
      csrfToken,
      sessionId,
      expiresAt
    };
  }

  async authenticateSession(
    sessionToken: string | undefined
  ): Promise<SessionIdentity | null> {
    const tokenHash = safeTokenHash(sessionToken);
    if (!tokenHash) return null;
    return this.repository.findSessionByTokenHash(tokenHash);
  }

  membershipsForUser(userId: string): Promise<AuthMembershipSummary[]> {
    return this.repository.listActiveMemberships(userId);
  }

  verifyCsrf(
    session: SessionIdentity,
    csrfToken: string | undefined
  ): boolean {
    return tokenMatchesHash(csrfToken, session.csrfHash);
  }

  async logout(sessionToken: string | undefined): Promise<void> {
    const tokenHash = safeTokenHash(sessionToken);
    if (!tokenHash) return;
    await this.repository.revokeSessionByTokenHash(tokenHash);
  }

  sessionTtlSeconds(): number {
    return this.sessionTtlDays() * 24 * 60 * 60;
  }

  private sessionTtlDays(): number {
    const value = Number(process.env.AUTH_SESSION_TTL_DAYS ?? "30");
    if (!Number.isInteger(value) || value < 1 || value > 365) {
      throw new Error(
        "AUTH_SESSION_TTL_DAYS must be an integer between 1 and 365."
      );
    }
    return value;
  }
}
