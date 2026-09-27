import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import type { Request, Response } from "express";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON
} from "@simplewebauthn/server";
import {
  assertTrustedBrowserOrigin,
  authCookieNames,
  parseCookies,
  readCsrfHeader,
  serializeAuthCookie
} from "./auth-http.js";
import { AuthSecurityService } from "./auth-security.service.js";
import type { SessionIdentity } from "./authentication.repository.js";
import { InvalidGoogleIdentityTokenError } from "./google-identity.js";
import { generateOpaqueToken } from "./session-token.js";
import {
  AuthenticationService,
  InvalidCredentialsError,
  type AuthenticationResult,
  type LoginResult
} from "./authentication.service.js";

type BodyInput = Record<string, unknown>;

@Controller("auth")
export class AuthenticationController {
  constructor(
    private readonly authentication: AuthenticationService,
    private readonly security: AuthSecurityService
  ) {}

  @Get("config")
  config() {
    return this.authentication.authConfig();
  }

  @Post("google/challenge")
  async googleChallenge(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    assertTrustedBrowserOrigin(request);
    await this.security.assertGoogleChallengeAllowed(this.requestIp(request));

    const nonce = generateOpaqueToken();
    const names = authCookieNames();
    response.setHeader("Cache-Control", "no-store");
    response.append(
      "Set-Cookie",
      serializeAuthCookie(names.googleNonce, nonce, {
        httpOnly: true,
        maxAgeSeconds: 5 * 60
      })
    );
    return { nonce };
  }

  @Post("login")
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);

    const email = this.requiredString(body.email, "email");
    const ip = this.requestIp(request);
    await this.security.assertPasswordLoginAllowed(email, ip);

    try {
      const result = await this.authentication.login({
        email,
        password: this.requiredString(body.password, "password"),
        accountType: "TENANT",
        sessionContext: this.sessionContext(request)
      });
      if ("mfaRequired" in result || "mfaEnrollmentRequired" in result) {
        await this.security.recordEvent({
          eventType: "PASSWORD_LOGIN_PRIMARY",
          outcome: "SUCCESS",
          email,
          ip,
          metadata: {
            mfaRequired: "mfaRequired" in result,
            mfaEnrollmentRequired: "mfaEnrollmentRequired" in result
          }
        });
        return result;
      }
      await this.security.recordEvent({
        eventType: "PASSWORD_LOGIN",
        outcome: "SUCCESS",
        email,
        ip,
        userId: result.user.id,
        organizationId: result.user.organizationId
      });
      return this.finishAuthentication(response, result);
    } catch (error) {
      await this.security.recordEvent({
        eventType: "PASSWORD_LOGIN",
        outcome: "FAILURE",
        email,
        ip
      });
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException("Email hoặc mật khẩu không đúng.");
      }
      throw error;
    }
  }

  @Post("platform/login")
  async platformLogin(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);

    const email = this.requiredString(body.email, "email");
    const ip = this.requestIp(request);
    await this.security.assertPasswordLoginAllowed(email, ip);

    try {
      const result = await this.authentication.login({
        email,
        password: this.requiredString(body.password, "password"),
        accountType: "PLATFORM",
        sessionContext: this.sessionContext(request)
      });
      if ("mfaRequired" in result || "mfaEnrollmentRequired" in result) {
        await this.security.recordEvent({
          eventType: "PLATFORM_LOGIN_PRIMARY",
          outcome: "SUCCESS",
          email,
          ip,
          metadata: {
            mfaRequired: "mfaRequired" in result,
            mfaEnrollmentRequired: "mfaEnrollmentRequired" in result
          }
        });
        return result;
      }

      await this.security.recordEvent({
        eventType: "PLATFORM_LOGIN",
        outcome: "SUCCESS",
        email,
        ip,
        userId: result.user.id
      });
      return this.finishAuthentication(response, result);
    } catch (error) {
      await this.security.recordEvent({
        eventType: "PLATFORM_LOGIN",
        outcome: "FAILURE",
        email,
        ip
      });
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException("Email hoặc mật khẩu không đúng.");
      }
      throw error;
    }
  }

  @Post("register")
  async register(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);

    const ip = this.requestIp(request);
    const email = this.requiredString(body.email, "email");
    await this.security.assertRegistrationAllowed(ip);

    try {
      const result = await this.authentication.register({
        email,
        password: this.requiredString(body.password, "password"),
        displayName: this.requiredString(body.displayName, "displayName"),
        organizationName: this.requiredString(
          body.organizationName,
          "organizationName"
        )
      });
      await this.security.recordEvent({
        eventType: "TENANT_REGISTRATION_STARTED",
        outcome: "SUCCESS",
        email,
        ip,
        metadata: { method: "PASSWORD" }
      });
      return result;
    } catch (error) {
      await this.security.recordEvent({
        eventType: "TENANT_REGISTER",
        outcome: "FAILURE",
        email,
        ip,
        metadata: { method: "PASSWORD" }
      });
      throw error;
    }
  }

  @Post("verify-email")
  async verifyEmail(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);
    const ip = this.requestIp(request);
    await this.security.assertEmailVerificationAllowed(ip);

    try {
      const result = await this.authentication.verifyEmail(
        this.requiredString(body.token, "token"),
        this.sessionContext(request)
      );
      if ("mfaRequired" in result || "mfaEnrollmentRequired" in result) {
        await this.security.recordEvent({
          eventType: "EMAIL_VERIFIED",
          outcome: "SUCCESS",
          ip,
          metadata: {
            mfaRequired: "mfaRequired" in result,
            mfaEnrollmentRequired: "mfaEnrollmentRequired" in result
          }
        });
        return result;
      }

      await this.security.recordEvent({
        eventType: "EMAIL_VERIFIED",
        outcome: "SUCCESS",
        email: result.user.email,
        ip,
        userId: result.user.id,
        organizationId: result.user.organizationId
      });
      return this.finishAuthentication(response, result);
    } catch (error) {
      await this.security.recordEvent({
        eventType: "EMAIL_VERIFY",
        outcome: "FAILURE",
        ip
      });
      throw error;
    }
  }

  @Post("forgot-password")
  async forgotPassword(
    @Req() request: Request,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);
    const email = this.requiredString(body.email, "email");
    const ip = this.requestIp(request);
    await this.security.assertPasswordResetRequestAllowed(email, ip);

    await this.authentication.requestPasswordReset(email);
    await this.security.recordEvent({
      eventType: "PASSWORD_RESET_REQUESTED",
      outcome: "SUCCESS",
      email,
      ip
    });

    return {
      accepted: true,
      message:
        "Nếu email tồn tại và có thể đặt lại mật khẩu, Habi đã gửi hướng dẫn."
    };
  }

  @Post("reset-password")
  async resetPassword(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);
    const ip = this.requestIp(request);
    await this.security.assertPasswordResetConfirmAllowed(ip);

    try {
      await this.authentication.resetPassword(
        this.requiredString(body.token, "token"),
        this.requiredString(body.newPassword, "newPassword")
      );
      this.clearAuthCookies(response);
      await this.security.recordEvent({
        eventType: "PASSWORD_RESET",
        outcome: "SUCCESS",
        ip
      });
      return {
        success: true,
        message: "Mật khẩu đã được đặt lại. Hãy đăng nhập lại."
      };
    } catch (error) {
      await this.security.recordEvent({
        eventType: "PASSWORD_RESET",
        outcome: "FAILURE",
        ip
      });
      throw error;
    }
  }

  @Post("google")
  async google(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);

    const mode = body.mode;
    if (mode !== "LOGIN" && mode !== "REGISTER") {
      throw new BadRequestException("mode must be LOGIN or REGISTER.");
    }

    const ip = this.requestIp(request);
    await this.security.assertGoogleAllowed(ip);

    const names = authCookieNames();
    const nonce = parseCookies(request.headers.cookie)[names.googleNonce];
    response.append(
      "Set-Cookie",
      serializeAuthCookie(names.googleNonce, "", {
        httpOnly: true,
        maxAgeSeconds: 0
      })
    );
    if (!nonce) {
      await this.security.recordEvent({
        eventType: "GOOGLE_AUTH",
        outcome: "FAILURE",
        ip,
        metadata: { mode, reason: "MISSING_NONCE" }
      });
      throw new UnauthorizedException(
        "Google sign-in challenge đã hết hạn. Vui lòng thử lại."
      );
    }

    try {
      const result = await this.authentication.google({
        credential: this.requiredString(body.credential, "credential"),
        mode,
        expectedNonce: nonce,
        organizationName:
          typeof body.organizationName === "string"
            ? body.organizationName
            : undefined,
        sessionContext: this.sessionContext(request)
      });
      if ("mfaRequired" in result || "mfaEnrollmentRequired" in result) {
        await this.security.recordEvent({
          eventType: "GOOGLE_AUTH_PRIMARY",
          outcome: "SUCCESS",
          ip,
          metadata: {
            mode,
            mfaRequired: "mfaRequired" in result,
            mfaEnrollmentRequired: "mfaEnrollmentRequired" in result
          }
        });
        return result;
      }
      await this.security.recordEvent({
        eventType: "GOOGLE_AUTH",
        outcome: "SUCCESS",
        email: result.user.email,
        ip,
        userId: result.user.id,
        organizationId: result.user.organizationId,
        metadata: { mode }
      });
      return this.finishAuthentication(response, result);
    } catch (error) {
      await this.security.recordEvent({
        eventType: "GOOGLE_AUTH",
        outcome: "FAILURE",
        ip,
        metadata: { mode }
      });
      if (error instanceof InvalidGoogleIdentityTokenError) {
        throw new UnauthorizedException(
          "Google credential không hợp lệ hoặc đã hết hạn."
        );
      }
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException("Tài khoản không còn hoạt động.");
      }
      throw error;
    }
  }

  @Post("mfa/enrollment/setup")
  async setupRequiredMfa(
    @Req() request: Request,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);
    await this.security.assertMfaSetupAllowed(
      this.requiredString(body.challengeToken, "challengeToken")
    );
    return this.authentication.beginRequiredMfaEnrollment({
      challengeToken: this.requiredString(
        body.challengeToken,
        "challengeToken"
      )
    });
  }

  @Post("mfa/enrollment/confirm")
  async confirmRequiredMfa(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);
    const ip = this.requestIp(request);
    await this.security.assertMfaVerifyAllowed(ip);

    try {
      const result = await this.authentication.confirmRequiredMfaEnrollment({
        challengeToken: this.requiredString(
          body.challengeToken,
          "challengeToken"
        ),
        code: this.requiredString(body.code, "code"),
        sessionContext: this.sessionContext(request)
      });
      await this.security.recordEvent({
        eventType: "MFA_ENROLLMENT_COMPLETED",
        outcome: "SUCCESS",
        email: result.user.email,
        ip,
        userId: result.user.id,
        organizationId: result.user.organizationId
      });
      return {
        ...this.finishAuthentication(response, result),
        recoveryCodes: result.recoveryCodes
      };
    } catch (error) {
      await this.security.recordEvent({
        eventType: "MFA_ENROLLMENT",
        outcome: "FAILURE",
        ip
      });
      throw error;
    }
  }

  @Post("mfa/passkey/options")
  async passkeyMfaOptions(
    @Req() request: Request,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);
    const ip = this.requestIp(request);
    await this.security.assertMfaVerifyAllowed(ip);
    return this.authentication.beginPasskeyMfa(
      this.requiredString(body.challengeToken, "challengeToken")
    );
  }

  @Post("mfa/passkey/verify")
  async verifyPasskeyMfa(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);
    const ip = this.requestIp(request);
    await this.security.assertMfaVerifyAllowed(ip);

    try {
      const result = await this.authentication.verifyPasskeyMfa({
        challengeToken: this.requiredString(
          body.challengeToken,
          "challengeToken"
        ),
        response: this.requiredObject(
          body.response,
          "response"
        ) as unknown as AuthenticationResponseJSON,
        sessionContext: this.sessionContext(request)
      });
      await this.security.recordEvent({
        eventType: "PASSKEY_MFA_LOGIN",
        outcome: "SUCCESS",
        email: result.user.email,
        ip,
        userId: result.user.id,
        organizationId: result.user.organizationId
      });
      return this.finishAuthentication(response, result);
    } catch (error) {
      await this.security.recordEvent({
        eventType: "PASSKEY_MFA_LOGIN",
        outcome: "FAILURE",
        ip
      });
      throw error;
    }
  }

  @Post("mfa/verify")
  async verifyMfa(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);
    const ip = this.requestIp(request);
    await this.security.assertMfaVerifyAllowed(ip);

    try {
      const result = await this.authentication.verifyMfaChallenge({
        challengeToken: this.requiredString(
          body.challengeToken,
          "challengeToken"
        ),
        code: this.requiredString(body.code, "code"),
        sessionContext: this.sessionContext(request)
      });
      await this.security.recordEvent({
        eventType: "MFA_LOGIN",
        outcome: "SUCCESS",
        email: result.user.email,
        ip,
        userId: result.user.id,
        organizationId: result.user.organizationId
      });
      return this.finishAuthentication(response, result);
    } catch (error) {
      await this.security.recordEvent({
        eventType: "MFA_LOGIN",
        outcome: "FAILURE",
        ip
      });
      throw error;
    }
  }

  @Get("passkeys")
  async passkeys(@Req() request: Request) {
    const session = await this.requireSession(request);
    return {
      passkeys: await this.authentication.listPasskeys(session.userId)
    };
  }

  @Post("passkeys/registration/options")
  async passkeyRegistrationOptions(@Req() request: Request) {
    assertTrustedBrowserOrigin(request);
    const session = await this.requireSession(request);
    this.requireCsrf(request, session);
    await this.security.assertMfaSetupAllowed(session.userId);

    return this.authentication.beginPasskeyRegistration({
      userId: session.userId,
      email: session.email,
      displayName: session.displayName
    });
  }

  @Post("passkeys/registration/verify")
  async verifyPasskeyRegistration(
    @Req() request: Request,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);
    const session = await this.requireSession(request);
    this.requireCsrf(request, session);
    await this.security.assertMfaSetupAllowed(session.userId);

    const passkey = await this.authentication.confirmPasskeyRegistration({
      userId: session.userId,
      response: this.requiredObject(
        body.response,
        "response"
      ) as unknown as RegistrationResponseJSON,
      name:
        typeof body.name === "string"
          ? body.name
          : undefined
    });

    await this.security.recordEvent({
      eventType: "PASSKEY_REGISTERED",
      outcome: "SUCCESS",
      email: session.email,
      ip: this.requestIp(request),
      userId: session.userId,
      organizationId: session.organizationId,
      metadata: {
        passkeyId: passkey.id,
        deviceType: passkey.deviceType,
        backedUp: passkey.backedUp
      }
    });

    return passkey;
  }

  @Post("passkeys/:passkeyId/revoke")
  async revokePasskey(
    @Req() request: Request,
    @Param("passkeyId", new ParseUUIDPipe({ version: "4" })) passkeyId: string
  ) {
    assertTrustedBrowserOrigin(request);
    const session = await this.requireSession(request);
    this.requireCsrf(request, session);

    const revoked = await this.authentication.revokePasskey(
      session.userId,
      passkeyId
    );
    await this.security.recordEvent({
      eventType: "PASSKEY_REVOKED",
      outcome: revoked ? "SUCCESS" : "FAILURE",
      email: session.email,
      ip: this.requestIp(request),
      userId: session.userId,
      organizationId: session.organizationId,
      metadata: { passkeyId }
    });
    return { revoked };
  }

  @Get("mfa")
  async mfaStatus(@Req() request: Request) {
    const session = await this.requireSession(request);
    return this.authentication.mfaStatus(
      session.userId,
      session.accountType
    );
  }

  @Post("mfa/setup")
  async setupMfa(
    @Req() request: Request,
    @Body() _body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);
    const session = await this.requireSession(request);
    this.requireCsrf(request, session);
    await this.security.assertMfaSetupAllowed(session.userId);
    return this.authentication.beginMfaSetup(
      session.userId,
      session.email
    );
  }

  @Post("mfa/confirm")
  async confirmMfa(
    @Req() request: Request,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);
    const session = await this.requireSession(request);
    this.requireCsrf(request, session);
    await this.security.assertMfaSetupAllowed(session.userId);

    const result = await this.authentication.confirmMfaSetup(
      session.userId,
      this.requiredString(body.code, "code")
    );
    await this.security.recordEvent({
      eventType: "MFA_ENABLED",
      outcome: "SUCCESS",
      email: session.email,
      ip: this.requestIp(request),
      userId: session.userId,
      organizationId: session.organizationId
    });
    return result;
  }

  @Post("mfa/disable")
  async disableMfa(
    @Req() request: Request,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);
    const session = await this.requireSession(request);
    this.requireCsrf(request, session);
    await this.security.assertMfaSetupAllowed(session.userId);

    await this.authentication.disableMfa(
      session.userId,
      session.accountType,
      session.sessionId,
      this.requiredString(body.code, "code")
    );
    await this.security.recordEvent({
      eventType: "MFA_DISABLED",
      outcome: "SUCCESS",
      email: session.email,
      ip: this.requestIp(request),
      userId: session.userId,
      organizationId: session.organizationId
    });
    return { disabled: true };
  }

  @Get("me")
  async me(@Req() request: Request) {
    const session = await this.authentication.authenticateSession(
      this.sessionCookie(request)
    );

    if (!session) {
      throw new UnauthorizedException("Authentication session is required.");
    }

    return {
      user: {
        id: session.userId,
        email: session.email,
        displayName: session.displayName,
        organizationId: session.organizationId,
        accountType: session.accountType
      },
      memberships: await this.authentication.membershipsForUser(
        session.userId
      ),
      features: await this.authentication.featuresForOrganization(
        session.organizationId
      ),
      expiresAt: session.expiresAt.toISOString()
    };
  }

  @Get("sessions")
  async sessions(@Req() request: Request) {
    const session = await this.requireSession(request);
    return {
      sessions: await this.authentication.listSessions(
        session.userId,
        session.sessionId
      )
    };
  }

  @Post("sessions/:sessionId/revoke")
  async revokeSession(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("sessionId", new ParseUUIDPipe({ version: "4" })) sessionId: string
  ) {
    assertTrustedBrowserOrigin(request);
    const session = await this.requireSession(request);
    this.requireCsrf(request, session);

    const revoked = await this.authentication.revokeSession(
      session.userId,
      sessionId
    );
    const currentSessionRevoked = revoked && sessionId === session.sessionId;

    await this.security.recordEvent({
      eventType: "SESSION_REVOKED",
      outcome: revoked ? "SUCCESS" : "FAILURE",
      email: session.email,
      ip: this.requestIp(request),
      userId: session.userId,
      organizationId: session.organizationId,
      metadata: {
        targetSessionId: sessionId,
        currentSessionRevoked
      }
    });

    if (currentSessionRevoked) {
      this.clearAuthCookies(response);
    }

    return { revoked, currentSessionRevoked };
  }

  @Post("sessions/revoke-others")
  async revokeOtherSessions(@Req() request: Request) {
    assertTrustedBrowserOrigin(request);
    const session = await this.requireSession(request);
    this.requireCsrf(request, session);

    const revokedSessions = await this.authentication.revokeOtherSessions(
      session.userId,
      session.sessionId
    );

    await this.security.recordEvent({
      eventType: "OTHER_SESSIONS_REVOKED",
      outcome: "SUCCESS",
      email: session.email,
      ip: this.requestIp(request),
      userId: session.userId,
      organizationId: session.organizationId,
      metadata: { revokedSessions }
    });

    return { revokedSessions };
  }

  @Post("logout")
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    assertTrustedBrowserOrigin(request);
    const sessionToken = this.sessionCookie(request);
    const session = await this.authentication.authenticateSession(sessionToken);

    if (
      session &&
      !this.authentication.verifyCsrf(session, readCsrfHeader(request))
    ) {
      throw new UnauthorizedException("Valid CSRF token is required.");
    }

    await this.authentication.logout(sessionToken);

    this.clearAuthCookies(response);

    return { loggedOut: true };
  }

  @Post("change-password")
  async changePassword(
    @Req() request: Request,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);
    const sessionToken = this.sessionCookie(request);
    const session = await this.authentication.authenticateSession(sessionToken);

    if (!session) {
      throw new UnauthorizedException(
        "Phiên đăng nhập đã hết hạn hoặc không hợp lệ."
      );
    }

    if (!this.authentication.verifyCsrf(session, readCsrfHeader(request))) {
      throw new UnauthorizedException("CSRF token không hợp lệ.");
    }

    const ip = this.requestIp(request);
    await this.security.assertPasswordChangeAllowed(session.userId);

    try {
      await this.authentication.changePassword(
        session.userId,
        session.sessionId,
        this.requiredString(body.currentPassword, "currentPassword"),
        this.requiredString(body.newPassword, "newPassword")
      );
      await this.security.recordEvent({
        eventType: "PASSWORD_CHANGED",
        outcome: "SUCCESS",
        email: session.email,
        ip,
        userId: session.userId,
        organizationId: session.organizationId
      });
    } catch (error) {
      await this.security.recordEvent({
        eventType: "PASSWORD_CHANGE_ATTEMPT",
        outcome: "FAILURE",
        email: session.email,
        ip,
        userId: session.userId,
        organizationId: session.organizationId
      });
      throw error;
    }

    return { success: true, message: "Đổi mật khẩu thành công." };
  }

  private async requireSession(request: Request) {
    const session = await this.authentication.authenticateSession(
      this.sessionCookie(request)
    );
    if (!session) {
      throw new UnauthorizedException(
        "Phiên đăng nhập đã hết hạn hoặc không hợp lệ."
      );
    }
    return session;
  }

  private requireCsrf(
    request: Request,
    session: SessionIdentity
  ): void {
    if (!this.authentication.verifyCsrf(session, readCsrfHeader(request))) {
      throw new UnauthorizedException("CSRF token không hợp lệ.");
    }
  }

  private clearAuthCookies(response: Response): void {
    const names = authCookieNames();
    response.setHeader("Set-Cookie", [
      serializeAuthCookie(names.session, "", {
        httpOnly: true,
        maxAgeSeconds: 0
      }),
      serializeAuthCookie(names.csrf, "", {
        httpOnly: false,
        maxAgeSeconds: 0
      }),
      serializeAuthCookie(names.googleNonce, "", {
        httpOnly: true,
        maxAgeSeconds: 0
      })
    ]);
  }

  private finishPrimaryAuthentication(
    response: Response,
    result: AuthenticationResult
  ) {
    return "mfaRequired" in result || "mfaEnrollmentRequired" in result
      ? result
      : this.finishAuthentication(response, result);
  }

  private finishAuthentication(response: Response, result: LoginResult) {
    const names = authCookieNames();
    const maxAgeSeconds = this.authentication.sessionTtlSeconds();

    response.setHeader("Cache-Control", "no-store");
    response.append(
      "Set-Cookie",
      serializeAuthCookie(names.session, result.sessionToken, {
        httpOnly: true,
        maxAgeSeconds
      })
    );
    response.append(
      "Set-Cookie",
      serializeAuthCookie(names.csrf, result.csrfToken, {
        httpOnly: false,
        maxAgeSeconds
      })
    );

    return {
      user: result.user,
      memberships: result.memberships,
      features: result.features,
      expiresAt: result.expiresAt.toISOString()
    };
  }

  private sessionContext(request: Request) {
    return {
      userAgent: request.get("user-agent") ?? null
    };
  }

  private sessionCookie(request: Request): string | undefined {
    return parseCookies(request.headers.cookie)[authCookieNames().session];
  }

  private requestIp(request: Request): string {
    return request.ip || request.socket.remoteAddress || "unknown";
  }

  private requiredObject(
    value: unknown,
    field: string
  ): Record<string, unknown> {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      throw new BadRequestException(field + " must be an object.");
    }
    return value as Record<string, unknown>;
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required.`);
    }
    return value.trim();
  }
}
