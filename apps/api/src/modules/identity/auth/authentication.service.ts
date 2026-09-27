import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import {
  hashPassword,
  InvalidPasswordPolicyError,
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
  type AccountIdentity,
  type AuthMembershipSummary,
  type SessionIdentity
} from "./authentication.repository.js";
import { verifyGoogleIdentityToken } from "./google-identity.js";
import { TenantOnboardingService } from "./tenant-onboarding.service.js";

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
  user: {
    id: string;
    email: string;
    displayName: string;
    organizationId: string | null;
    accountType: "TENANT" | "PLATFORM";
  };
  memberships: AuthMembershipSummary[];
  sessionToken: string;
  csrfToken: string;
  sessionId: string;
  expiresAt: Date;
}

@Injectable()
export class AuthenticationService {
  constructor(
    private readonly repository: AuthenticationRepository,
    private readonly onboarding: TenantOnboardingService
  ) {}

  async authConfig() {
    const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;
    return {
      registrationEnabled: await this.onboarding.registrationEnabled(),
      googleEnabled:
        Boolean(googleClientId) && (await this.onboarding.googleAuthEnabled()),
      googleClientId
    };
  }

  async login(input: { email: string; password: string }): Promise<LoginResult> {
    const email = input.email.trim();

    if (email.length === 0 || email.length > 320 || !email.includes("@")) {
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

    return this.issueSession(identity);
  }

  async register(input: {
    email: string;
    password: string;
    displayName: string;
    organizationName: string;
  }): Promise<LoginResult> {
    const email = this.email(input.email);
    const displayName = this.required(input.displayName, "displayName");
    const organizationName = this.required(
      input.organizationName,
      "organizationName"
    );

    let credential: PasswordCredential;
    try {
      credential = await hashPassword(input.password);
    } catch (error) {
      if (error instanceof InvalidPasswordPolicyError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    await this.onboarding.register({
      email,
      displayName,
      organizationName,
      credential
    });

    const identity = await this.repository.findAccountByEmail(email);
    if (!identity) {
      throw new Error("Registered account could not be loaded.");
    }
    return this.issueSession(identity);
  }

  async google(input: {
    credential: string;
    mode: "LOGIN" | "REGISTER";
    organizationName?: string;
  }): Promise<LoginResult> {
    const config = await this.authConfig();
    if (!config.googleEnabled || !config.googleClientId) {
      throw new ConflictException("Đăng nhập Google hiện đang tắt.");
    }

    const google = await verifyGoogleIdentityToken(
      this.required(input.credential, "credential"),
      config.googleClientId
    );

    const linked = await this.repository.findAccountByGoogleSubject(
      google.subject
    );
    if (linked) {
      if (linked.userStatus !== "ACTIVE") {
        throw new InvalidCredentialsError();
      }
      return this.issueSession(linked);
    }

    const existing = await this.repository.findAccountByEmail(google.email);
    if (existing) {
      if (!google.authoritativeEmail) {
        throw new ConflictException(
          "Email đã tồn tại. Hãy đăng nhập bằng mật khẩu để liên kết Google an toàn."
        );
      }
      if (existing.userStatus !== "ACTIVE") {
        throw new InvalidCredentialsError();
      }
      await this.repository.linkGoogleIdentity({
        userId: existing.userId,
        subject: google.subject,
        providerEmail: google.email
      });
      return this.issueSession(existing);
    }

    if (input.mode !== "REGISTER") {
      throw new ConflictException(
        "Chưa có tài khoản Habi cho Google này. Hãy chọn đăng ký."
      );
    }

    const organizationName = this.required(
      input.organizationName,
      "organizationName"
    );

    await this.onboarding.register({
      email: google.email,
      displayName: google.displayName,
      organizationName,
      google: {
        subject: google.subject,
        providerEmail: google.email
      }
    });

    const created = await this.repository.findAccountByGoogleSubject(
      google.subject
    );
    if (!created) {
      throw new Error("Google account could not be loaded after registration.");
    }
    return this.issueSession(created);
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

  async changePassword(
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const identity = await this.repository.findCredentialByUserId(userId);
    if (!identity || identity.userStatus !== "ACTIVE") {
      throw new InvalidCredentialsError();
    }

    const verified = await verifyPassword(currentPassword, identity.credential);
    if (!verified) {
      throw new BadRequestException("Mật khẩu hiện tại không chính xác.");
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException(
        "Mật khẩu mới không được trùng với mật khẩu hiện tại."
      );
    }

    try {
      const newCredential = await hashPassword(newPassword);
      await this.repository.changePassword(
        userId,
        currentSessionId,
        newCredential
      );
    } catch (error) {
      if (error instanceof InvalidPasswordPolicyError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  sessionTtlSeconds(): number {
    return this.sessionTtlDays() * 24 * 60 * 60;
  }

  private async issueSession(
    identity: AccountIdentity
  ): Promise<LoginResult> {
    const sessionToken = generateOpaqueToken();
    const csrfToken = generateOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.sessionTtlDays() * 24 * 60 * 60 * 1000
    );

    const sessionId = await this.repository.createSession({
      userId: identity.userId,
      organizationId: identity.organizationId,
      authVersion: identity.authVersion,
      tokenHash: hashOpaqueToken(sessionToken),
      csrfHash: hashOpaqueToken(csrfToken),
      expiresAt
    });

    return {
      user: {
        id: identity.userId,
        email: identity.email,
        displayName: identity.displayName,
        organizationId: identity.organizationId,
        accountType: identity.accountType
      },
      memberships: await this.repository.listActiveMemberships(identity.userId),
      sessionToken,
      csrfToken,
      sessionId,
      expiresAt
    };
  }

  private email(value: string): string {
    const email = value.trim().toLowerCase();
    if (
      email.length === 0 ||
      email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      throw new BadRequestException("Email không hợp lệ.");
    }
    return email;
  }

  private required(value: string | undefined, field: string): string {
    const normalized = value?.trim() ?? "";
    if (!normalized) {
      throw new BadRequestException(field + " is required.");
    }
    return normalized;
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
