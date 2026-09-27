import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { CmsPlatformGuard } from "./cms-platform.guard.js";
import { CmsTenantAccountsService } from "./cms-tenant-accounts.service.js";
import type { CmsRequest, PlatformPrincipal } from "./cms.types.js";

type BodyInput = Record<string, unknown>;

@Controller("cms/organizations/:organizationId/accounts")
@UseGuards(CmsPlatformGuard)
export class CmsTenantAccountsController {
  constructor(private readonly accounts: CmsTenantAccountsService) {}

  @Get()
  list(
    @Req() request: CmsRequest,
    @Param("organizationId") organizationId: string
  ) {
    return this.accounts.list(this.principal(request), organizationId);
  }

  @Post()
  create(
    @Req() request: CmsRequest,
    @Param("organizationId") organizationId: string,
    @Body() body: BodyInput
  ) {
    return this.accounts.create(this.principal(request), organizationId, {
      email: this.string(body.email, "email"),
      displayName: this.string(body.displayName, "displayName"),
      role: this.string(body.role, "role"),
      temporaryPassword: this.string(
        body.temporaryPassword,
        "temporaryPassword"
      ),
      reason: this.string(body.reason, "reason")
    });
  }

  @Post(":userId/role")
  setRole(
    @Req() request: CmsRequest,
    @Param("organizationId") organizationId: string,
    @Param("userId") userId: string,
    @Body() body: BodyInput
  ) {
    return this.accounts.setRole(
      this.principal(request),
      organizationId,
      userId,
      this.string(body.role, "role"),
      this.string(body.reason, "reason")
    );
  }

  @Post(":userId/status")
  setStatus(
    @Req() request: CmsRequest,
    @Param("organizationId") organizationId: string,
    @Param("userId") userId: string,
    @Body() body: BodyInput
  ) {
    const status = this.string(body.status, "status");
    if (status !== "ACTIVE" && status !== "SUSPENDED") {
      throw new BadRequestException("status must be ACTIVE or SUSPENDED.");
    }
    return this.accounts.setStatus(
      this.principal(request),
      organizationId,
      userId,
      status,
      this.string(body.reason, "reason")
    );
  }

  @Post(":userId/reset-password")
  resetPassword(
    @Req() request: CmsRequest,
    @Param("organizationId") organizationId: string,
    @Param("userId") userId: string,
    @Body() body: BodyInput
  ) {
    return this.accounts.resetPassword(
      this.principal(request),
      organizationId,
      userId,
      this.string(body.temporaryPassword, "temporaryPassword"),
      this.string(body.reason, "reason")
    );
  }

  @Post(":userId/reset-authenticators")
  resetAuthenticators(
    @Req() request: CmsRequest,
    @Param("organizationId") organizationId: string,
    @Param("userId") userId: string,
    @Body() body: BodyInput
  ) {
    return this.accounts.resetAuthenticators(
      this.principal(request),
      organizationId,
      userId,
      this.string(body.reason, "reason")
    );
  }

  @Post(":userId/revoke-sessions")
  revokeSessions(
    @Req() request: CmsRequest,
    @Param("organizationId") organizationId: string,
    @Param("userId") userId: string,
    @Body() body: BodyInput
  ) {
    return this.accounts.revokeAllSessions(
      this.principal(request),
      organizationId,
      userId,
      this.string(body.reason, "reason")
    );
  }

  private principal(request: CmsRequest): PlatformPrincipal {
    if (!request.platformPrincipal) {
      throw new Error("CmsPlatformGuard did not attach a principal.");
    }
    return request.platformPrincipal;
  }

  private string(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new BadRequestException(field + " is required.");
    }
    return value.trim();
  }
}
