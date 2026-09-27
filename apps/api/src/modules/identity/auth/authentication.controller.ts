import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  assertTrustedBrowserOrigin,
  authCookieNames,
  parseCookies,
  readCsrfHeader,
  serializeAuthCookie
} from "./auth-http.js";
import { AuthSecurityService } from "./auth-security.service.js";
import { generateOpaqueToken } from "./session-token.js";
import {
  AuthenticationService,
  InvalidCredentialsError,
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

  @Get("google/challenge")
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
        password: this.requiredString(body.password, "password")
      });
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
        eventType: "TENANT_REGISTER",
        outcome: "SUCCESS",
        email,
        ip,
        userId: result.user.id,
        organizationId: result.user.organizationId,
        metadata: { method: "PASSWORD" }
      });
      return this.finishAuthentication(response, result);
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
            : undefined
      });
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
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException("Tài khoản không còn hoạt động.");
      }
      throw error;
    }
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

    const names = authCookieNames();
    response.setHeader("Set-Cookie", [
      serializeAuthCookie(names.session, "", {
        httpOnly: true,
        maxAgeSeconds: 0
      }),
      serializeAuthCookie(names.csrf, "", {
        httpOnly: false,
        maxAgeSeconds: 0
      })
    ]);

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

    await this.authentication.changePassword(
      session.userId,
      session.sessionId,
      this.requiredString(body.currentPassword, "currentPassword"),
      this.requiredString(body.newPassword, "newPassword")
    );

    return { success: true, message: "Đổi mật khẩu thành công." };
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

  private sessionCookie(request: Request): string | undefined {
    return parseCookies(request.headers.cookie)[authCookieNames().session];
  }

  private requestIp(request: Request): string {
    return request.ip || request.socket.remoteAddress || "unknown";
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required.`);
    }
    return value.trim();
  }
}
