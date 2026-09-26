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
  InvalidCredentialsError
} from "./authentication.service.js";

type LoginBody = Record<string, unknown>;

@Controller("auth")
export class AuthenticationController {
  constructor(private readonly authentication: AuthenticationService) {}

  @Post("login")
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: LoginBody
  ) {
    assertTrustedBrowserOrigin(request);

    try {
      const result = await this.authentication.login({
        email: this.requiredString(body.email, "email"),
        password: this.requiredString(body.password, "password")
      });
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
        expiresAt: result.expiresAt.toISOString()
      };
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException("Email or password is invalid.");
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
        displayName: session.displayName
      },
      memberships: await this.authentication.membershipsForUser(
        session.userId
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
    const session = await this.authentication.authenticateSession(
      sessionToken
    );

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
    @Body() body: Record<string, unknown>
  ) {
    assertTrustedBrowserOrigin(request);
    const sessionToken = this.sessionCookie(request);
    const session = await this.authentication.authenticateSession(sessionToken);

    if (!session) {
      throw new UnauthorizedException("Phiên đăng nhập đã hết hạn hoặc không hợp lệ.");
    }

    if (!this.authentication.verifyCsrf(session, readCsrfHeader(request))) {
      throw new UnauthorizedException("CSRF token không hợp lệ.");
    }

    const currentPassword = this.requiredString(body.currentPassword, "currentPassword");
    const newPassword = this.requiredString(body.newPassword, "newPassword");

    await this.authentication.changePassword(
      session.userId,
      session.sessionId,
      currentPassword,
      newPassword
    );

    return { success: true, message: "Đổi mật khẩu thành công." };
  }

  private sessionCookie(request: Request): string | undefined {
    return parseCookies(request.headers.cookie)[authCookieNames().session];
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length === 0) {
      throw new BadRequestException(`${field} is required.`);
    }
    return value;
  }
}
