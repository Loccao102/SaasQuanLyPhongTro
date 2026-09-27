import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import {
  tenantFeatureEnabled,
  tenantFeatureKeys,
  type TenantFeatureKey
} from "../../commercial/domain/entitlements.js";
import { DatabaseService } from "../../database/database.service.js";
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
import { AuthEmailDeliveryService } from "./auth-email-delivery.service.js";
import { TenantOnboardingService } from "./tenant-onboarding.service.js";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  totpProvisioningUri,
  verifyTotpCode
} from "./totp.js";

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

export type SessionContext = {
  userAgent?: string | null;
};

export interface MfaRequiredResult {
  mfaRequired: true;
  challengeToken: string;
  expiresAt: string;
}

export type AuthenticationResult = LoginResult | MfaRequiredResult;

export interface LoginResult {
  user: {
    id: string;
    email: string;
    displayName: string;
    organizationId: string | null;
    accountType: "TENANT" | "PLATFORM";
  };
  memberships: AuthMembershipSummary[];
  features: Record<TenantFeatureKey, boolean> | null;
  sessionToken: string;
  csrfToken: string;
  sessionId: string;
  expiresAt: Date;
}

@Injectable()
export class AuthenticationService {
  constructor(
    private readonly repository: AuthenticationRepository,
    private readonly onboarding?: TenantOnboardingService,
    private readonly database?: DatabaseService,
    private readonly commercialPolicy?: CommercialPolicyService,
    private readonly authEmail?: AuthEmailDeliveryService
  ) {}

  async authConfig() {
    const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;
    return {
      registrationEnabled: await this.requireOnboarding().registrationEnabled(),
      passwordRegistrationEnabled:
        (await this.requireOnboarding().passwordRegistrationEnabled()) &&
        this.requireAuthEmail().isAvailable(),
      passwordRecoveryEnabled: this.requireAuthEmail().isAvailable(),
      googleEnabled:
        Boolean(googleClientId) && (await this.requireOnboarding().googleAuthEnabled()),
      googleClientId
    };
  }

  async login(input: {
    email: string;
    password: string;
    sessionContext?: SessionContext;
  }): Promise<AuthenticationResult> {
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

    return this.completePrimaryAuthentication(identity, input.sessionContext);
  }

  async register(input: {
    email: string;
    password: string;
    displayName: string;
    organizationName: string;
  }): Promise<{ pendingVerification: true; email: string }> {
    if (!this.requireAuthEmail().isAvailable()) {
      throw new ConflictException(
        "Đăng ký bằng email/mật khẩu chưa được cấu hình."
      );
    }

    const email = this.email(input.email);
    const displayName = this.required(input.displayName, "displayName");
    const organizationName = this.required(
      input.organizationName,
      "organizationName"
    );

    const credential = await this.passwordCredential(input.password);
    const verificationToken = generateOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.verificationTtlHours() * 60 * 60 * 1000
    );

    await this.requireOnboarding().beginPasswordRegistration({
      email,
      displayName,
      organizationName,
      credential,
      tokenHash: hashOpaqueToken(verificationToken),
      expiresAt
    });

    await this.requireAuthEmail().sendVerification(
      email,
      verificationToken
    );

    return { pendingVerification: true, email };
  }

  async verifyEmail(
    token: string,
    sessionContext?: SessionContext
  ): Promise<LoginResult> {
    const tokenHash = safeTokenHash(token);
    if (!tokenHash) {
      throw new BadRequestException(
        "Liên kết xác minh không hợp lệ hoặc đã hết hạn."
      );
    }

    const onboarding = await this.requireOnboarding()
      .verifyPasswordRegistration(tokenHash);
    if (!onboarding) {
      throw new BadRequestException(
        "Liên kết xác minh không hợp lệ hoặc đã hết hạn."
      );
    }

    const identity = await this.repository.findAccountByEmail(
      onboarding.email
    );
    if (!identity) {
      throw new Error("Verified account could not be loaded.");
    }
    return this.issueSession(identity, sessionContext);
  }

  async requestPasswordReset(emailInput: string): Promise<void> {
    const email = this.email(emailInput);
    const identity = await this.repository.findCredentialByEmail(email);
    if (!identity || identity.userStatus !== "ACTIVE") {
      return;
    }

    const token = generateOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.passwordResetTtlMinutes() * 60 * 1000
    );
    await this.repository.replacePasswordResetToken({
      userId: identity.userId,
      tokenHash: hashOpaqueToken(token),
      expiresAt
    });

    try {
      await this.requireAuthEmail().sendPasswordReset(identity.email, token);
    } catch (error) {
      console.error(
        "[auth-email] password reset delivery failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = safeTokenHash(token);
    if (!tokenHash) {
      throw new BadRequestException(
        "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn."
      );
    }

    const credential = await this.passwordCredential(newPassword);
    const identity = await this.repository.resetPasswordWithToken(
      tokenHash,
      credential
    );
    if (!identity) {
      throw new BadRequestException(
        "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn."
      );
    }
  }

  async google(input: {
    credential: string;
    mode: "LOGIN" | "REGISTER";
    expectedNonce: string;
    organizationName?: string;
    sessionContext?: SessionContext;
  }): Promise<AuthenticationResult> {
    const config = await this.authConfig();
    if (!config.googleEnabled || !config.googleClientId) {
      throw new ConflictException("Đăng nhập Google hiện đang tắt.");
    }

    const google = await verifyGoogleIdentityToken(
      this.required(input.credential, "credential"),
      config.googleClientId,
      this.required(input.expectedNonce, "expectedNonce")
    );

    const linked = await this.repository.findAccountByGoogleSubject(
      google.subject
    );
    if (linked) {
      if (
        linked.accountType !== "TENANT" ||
        linked.userStatus !== "ACTIVE"
      ) {
        throw new InvalidCredentialsError();
      }
      return this.completePrimaryAuthentication(linked, input.sessionContext);
    }

    const existing = await this.repository.findAccountByEmail(google.email);
    if (existing) {
      if (existing.accountType !== "TENANT") {
        throw new ConflictException(
          "Google sign-in không được bật cho tài khoản nền tảng."
        );
      }
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
      return this.completePrimaryAuthentication(existing, input.sessionContext);
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

    await this.requireOnboarding().register({
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
    return this.completePrimaryAuthentication(created, input.sessionContext);
  }

  async mfaStatus(userId: string): Promise<{ enabled: boolean }> {
    return {
      enabled: Boolean(await this.repository.getMfaCredential(userId))
    };
  }

  async beginMfaSetup(userId: string, email: string): Promise<{
    secret: string;
    provisioningUri: string;
  }> {
    const secret = generateTotpSecret();
    const encrypted = encryptTotpSecret(secret);
    await this.repository.upsertMfaSetup({
      userId,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag
    });

    return {
      secret,
      provisioningUri: totpProvisioningUri({ secret, email })
    };
  }

  async confirmMfaSetup(
    userId: string,
    code: string
  ): Promise<{ recoveryCodes: string[] }> {
    const credential = await this.repository.getMfaCredential(userId, false);
    if (
      !credential ||
      credential.confirmed ||
      !verifyTotpCode(
        decryptTotpSecret({
          ciphertext: credential.ciphertext,
          iv: credential.iv,
          tag: credential.tag
        }),
        code
      )
    ) {
      throw new BadRequestException("Mã xác thực không hợp lệ.");
    }

    const recoveryCodes = generateRecoveryCodes();
    const confirmed = await this.repository.confirmMfaSetup(
      userId,
      recoveryCodes.map(hashRecoveryCode)
    );
    if (!confirmed) {
      throw new BadRequestException("Thiết lập MFA đã thay đổi. Hãy thử lại.");
    }
    return { recoveryCodes };
  }

  async disableMfa(
    userId: string,
    currentSessionId: string,
    code: string
  ): Promise<void> {
    if (!(await this.verifySecondFactor(userId, code))) {
      throw new BadRequestException("Mã xác thực không hợp lệ.");
    }
    await this.repository.disableMfa(userId, currentSessionId);
  }

  async verifyMfaChallenge(input: {
    challengeToken: string;
    code: string;
    sessionContext?: SessionContext;
  }): Promise<LoginResult> {
    const tokenHash = safeTokenHash(input.challengeToken);
    if (!tokenHash) {
      throw new BadRequestException(
        "Phiên xác thực hai bước không hợp lệ hoặc đã hết hạn."
      );
    }

    const identity = await this.repository.findMfaChallenge(tokenHash);
    if (!identity || !(await this.verifySecondFactor(identity.userId, input.code))) {
      throw new BadRequestException("Mã xác thực không hợp lệ hoặc đã hết hạn.");
    }

    if (
      !(await this.repository.consumeMfaChallenge(identity.userId, tokenHash))
    ) {
      throw new BadRequestException(
        "Phiên xác thực hai bước đã được sử dụng hoặc đã hết hạn."
      );
    }

    return this.issueSession(identity, input.sessionContext);
  }

  async authenticateSession(
    sessionToken: string | undefined
  ): Promise<SessionIdentity | null> {
    const tokenHash = safeTokenHash(sessionToken);
    if (!tokenHash) return null;

    const now = Date.now();
    const idleCutoff = new Date(
      now - this.sessionIdleTtlHours() * 60 * 60 * 1000
    );
    const session = await this.repository.findSessionByTokenHash(
      tokenHash,
      idleCutoff
    );
    if (!session) return null;

    const touchIntervalMs =
      this.sessionTouchIntervalMinutes() * 60 * 1000;
    if (now - session.lastSeenAt.getTime() >= touchIntervalMs) {
      await this.repository.touchSession(
        session.sessionId,
        new Date(now - touchIntervalMs)
      );
      session.lastSeenAt = new Date(now);
    }

    return session;
  }

  membershipsForUser(userId: string): Promise<AuthMembershipSummary[]> {
    return this.repository.listActiveMemberships(userId);
  }

  async featuresForOrganization(
    organizationId: string | null
  ): Promise<Record<TenantFeatureKey, boolean> | null> {
    if (!organizationId) return null;
    if (!this.database || !this.commercialPolicy) {
      return null;
    }

    const policy = await this.database.withTransaction((client) =>
      this.commercialPolicy!.loadPolicy(client, organizationId)
    );

    return Object.fromEntries(
      tenantFeatureKeys.map((key) => [
        key,
        tenantFeatureEnabled(policy.entitlements, key)
      ])
    ) as Record<TenantFeatureKey, boolean>;
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

  async listSessions(
    userId: string,
    currentSessionId: string
  ): Promise<Array<{
    id: string;
    current: boolean;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
    userAgent: string | null;
    deviceLabel: string | null;
  }>> {
    const sessions = await this.repository.listActiveSessions(userId);
    return sessions.map((session) => ({
      id: session.id,
      current: session.id === currentSessionId,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      userAgent: session.userAgent,
      deviceLabel: session.deviceLabel
    }));
  }

  revokeSession(userId: string, sessionId: string): Promise<boolean> {
    return this.repository.revokeSessionForUser(userId, sessionId);
  }

  revokeOtherSessions(
    userId: string,
    currentSessionId: string
  ): Promise<number> {
    return this.repository.revokeOtherSessions(userId, currentSessionId);
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

  private async completePrimaryAuthentication(
    identity: AccountIdentity,
    sessionContext?: SessionContext
  ): Promise<AuthenticationResult> {
    const mfa = await this.repository.getMfaCredential(identity.userId);
    if (!mfa) {
      return this.issueSession(identity, sessionContext);
    }

    const challengeToken = generateOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.mfaChallengeTtlMinutes() * 60 * 1000
    );
    await this.repository.createMfaChallenge({
      userId: identity.userId,
      tokenHash: hashOpaqueToken(challengeToken),
      expiresAt
    });
    return {
      mfaRequired: true,
      challengeToken,
      expiresAt: expiresAt.toISOString()
    };
  }

  private async verifySecondFactor(
    userId: string,
    code: string
  ): Promise<boolean> {
    const credential = await this.repository.getMfaCredential(userId);
    if (!credential) return false;

    const secret = decryptTotpSecret({
      ciphertext: credential.ciphertext,
      iv: credential.iv,
      tag: credential.tag
    });
    if (verifyTotpCode(secret, code)) return true;

    if (looksLikeRecoveryCode(code)) {
      return this.repository.consumeRecoveryCode(
        userId,
        hashRecoveryCode(code)
      );
    }

    return false;
  }

  private async passwordCredential(password: string): Promise<PasswordCredential> {
    try {
      return await hashPassword(password);
    } catch (error) {
      if (error instanceof InvalidPasswordPolicyError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private async issueSession(
    identity: AccountIdentity,
    sessionContext?: SessionContext
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
      expiresAt,
      userAgent: this.normalizedUserAgent(sessionContext?.userAgent),
      deviceLabel: this.deviceLabel(sessionContext?.userAgent)
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
      features: await this.featuresForOrganization(identity.organizationId),
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

  private requireAuthEmail(): AuthEmailDeliveryService {
    if (!this.authEmail) {
      throw new Error("Auth email delivery service is not configured.");
    }
    return this.authEmail;
  }

  private requireOnboarding(): TenantOnboardingService {
    if (!this.onboarding) {
      throw new Error("Tenant onboarding service is not configured.");
    }
    return this.onboarding;
  }

  private normalizedUserAgent(userAgent: string | null | undefined): string | null {
    const normalized = userAgent?.trim();
    return normalized ? normalized.slice(0, 512) : null;
  }

  private deviceLabel(userAgent: string | null | undefined): string | null {
    const ua = userAgent ?? "";
    if (!ua.trim()) return null;

    const browser =
      /Edg\//.test(ua) ? "Edge" :
      /Firefox\//.test(ua) ? "Firefox" :
      /Chrome\//.test(ua) || /CriOS\//.test(ua) ? "Chrome" :
      /Safari\//.test(ua) ? "Safari" : "Trình duyệt";
    const os =
      /iPhone/.test(ua) ? "iPhone" :
      /iPad/.test(ua) ? "iPad" :
      /Android/.test(ua) ? "Android" :
      /Windows/.test(ua) ? "Windows" :
      /Macintosh|Mac OS X/.test(ua) ? "macOS" :
      /Linux/.test(ua) ? "Linux" : "Thiết bị";
    return browser + " · " + os;
  }

  private mfaChallengeTtlMinutes(): number {
    const value = Number(process.env.AUTH_MFA_CHALLENGE_TTL_MINUTES ?? "5");
    if (!Number.isInteger(value) || value < 1 || value > 30) {
      throw new Error(
        "AUTH_MFA_CHALLENGE_TTL_MINUTES must be between 1 and 30."
      );
    }
    return value;
  }

  private verificationTtlHours(): number {
    const value = Number(process.env.AUTH_EMAIL_VERIFICATION_TTL_HOURS ?? "24");
    if (!Number.isInteger(value) || value < 1 || value > 168) {
      throw new Error(
        "AUTH_EMAIL_VERIFICATION_TTL_HOURS must be between 1 and 168."
      );
    }
    return value;
  }

  private passwordResetTtlMinutes(): number {
    const value = Number(process.env.AUTH_PASSWORD_RESET_TTL_MINUTES ?? "30");
    if (!Number.isInteger(value) || value < 5 || value > 1440) {
      throw new Error(
        "AUTH_PASSWORD_RESET_TTL_MINUTES must be between 5 and 1440."
      );
    }
    return value;
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

  private sessionIdleTtlHours(): number {
    const value = Number(process.env.AUTH_SESSION_IDLE_TTL_HOURS ?? "24");
    if (!Number.isInteger(value) || value < 1 || value > 720) {
      throw new Error(
        "AUTH_SESSION_IDLE_TTL_HOURS must be an integer between 1 and 720."
      );
    }
    return value;
  }

  private sessionTouchIntervalMinutes(): number {
    const value = Number(
      process.env.AUTH_SESSION_TOUCH_INTERVAL_MINUTES ?? "5"
    );
    if (!Number.isInteger(value) || value < 1 || value > 60) {
      throw new Error(
        "AUTH_SESSION_TOUCH_INTERVAL_MINUTES must be an integer between 1 and 60."
      );
    }
    return value;
  }
}
