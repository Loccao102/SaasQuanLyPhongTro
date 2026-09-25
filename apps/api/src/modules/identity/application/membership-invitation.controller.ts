import {
  BadRequestException,
  Body,
  Controller,
  Get,
  GoneException,
  Param,
  Post,
  Req
} from "@nestjs/common";
import type { Request } from "express";
import { assertTrustedBrowserOrigin } from "../auth/auth-http.js";
import { InvalidPasswordPolicyError } from "../auth/password.js";
import {
  MembershipInvitationPasswordRequiredError,
  MembershipInvitationService,
  MembershipInvitationUnavailableError
} from "./membership-invitation.service.js";

@Controller("auth/invitations")
export class MembershipInvitationController {
  constructor(private readonly invitations: MembershipInvitationService) {}

  @Get(":token")
  inspect(@Param("token") token: string) {
    return this.mapUnavailable(() => this.invitations.inspect(token));
  }

  @Post(":token/accept")
  accept(
    @Req() request: Request,
    @Param("token") token: string,
    @Body() body: Record<string, unknown>
  ) {
    assertTrustedBrowserOrigin(request);
    const password =
      typeof body.password === "string" && body.password.length > 0
        ? body.password
        : undefined;

    return this.mapUnavailable(async () => {
      try {
        return await this.invitations.accept({ token, password });
      } catch (error) {
        if (
          error instanceof MembershipInvitationPasswordRequiredError ||
          error instanceof InvalidPasswordPolicyError
        ) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }
    });
  }

  private async mapUnavailable<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof MembershipInvitationUnavailableError) {
        throw new GoneException(
          "Lời mời không hợp lệ, đã hết hạn, đã thu hồi hoặc đã được sử dụng."
        );
      }
      throw error;
    }
  }
}
