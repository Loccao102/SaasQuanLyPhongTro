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
import {
  AuthenticationService,
  InvalidCredentialsError,
  type LoginResult
} from "./authentication.service.js";

type BodyInput = Record<string, unknown>;

@Controller("auth")
export class AuthenticationController {
  constructor(private readonly authentication: AuthenticationService) {}

  @Get("config")
  config() {
    return this.authentication.authConfig();
  }

  @Post("login")
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: BodyInput
  ) {
    assertTrustedBrowserOrigin(request);

    try {
      const result = await this.authentication.login({
        email: this.requiredString(body.email, "email"),
        password: this.requiredString(body.password, "password")
      });
      return this.finishAuthentication(response, result);
    } catch (error) {
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

    const result = await this.authentication.register({
      email: this.requiredString(body.email, "email"),
      password: this.requiredString(body.password, "password"),
      displayName: this.requiredString(body.displayName, "displayName"),
      organizationName: this.requiredString(
        body.organizationName,
        "organizationName"
      )
    });

    return this.finishAuthentication(response, result);
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

    try {
      const result = await this.authentication.google({
        credential: this.requiredString(body.credential, "credential"),
        mode,
        organizationName:
          typeof body.organizationName === "string"
            ? body.organizationName
            : undefined
      });
      return this.finishAuthentication(response, result);
    } catch (error) {
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

    response.setHeader("Set-Cookie", [
      serializeAuthCookie(names.session, result.sessionToken, {
        httpOnly: true,
        maxAgeSeconds
      }),
      serializeAuthCookie(names.csrf, result.csrfToken, {
        httpOnly: false,
        maxAgeSeconds
      })
    ]);

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

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required.`);
    }
    return value.trim();
  }
}
