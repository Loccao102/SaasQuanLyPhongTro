import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { TenantPrincipalGuard } from "../../identity/tenant-principal.guard.js";
import type { TenantRequest } from "../../identity/tenant-principal.js";
import { NotificationCampaignService } from "./notification-campaign.service.js";
import { NotificationAdminService } from "./notification-admin.service.js";

type BodyInput = Record<string, unknown>;

@Controller("admin/notifications")
@UseGuards(TenantPrincipalGuard)
export class NotificationAdminController {
  constructor(
    private readonly admin: NotificationAdminService,
    private readonly campaigns: NotificationCampaignService
  ) {}

  @Get()
  list(@Req() request: TenantRequest) {
    return this.admin.list(this.principal(request));
  }

  @Get(":campaignId")
  detail(
    @Req() request: TenantRequest,
    @Param("campaignId", new ParseUUIDPipe({ version: "4" })) campaignId: string
  ) {
    return this.admin.detail(this.principal(request), campaignId);
  }

  @Post()
  create(@Req() request: TenantRequest, @Body() input: BodyInput) {
    const messageBody = this.requiredString(input.messageBody, "messageBody");
    if (!Array.isArray(input.recipients)) {
      throw new BadRequestException("recipients must be an array.");
    }
    const recipients = input.recipients.map((item, index) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new BadRequestException("recipient " + String(index + 1) + " is invalid.");
      }
      const raw = item as BodyInput;
      return {
        recipientKey: this.requiredString(raw.recipientKey, "recipientKey"),
        recipientDisplayName:
          typeof raw.recipientDisplayName === "string"
            ? raw.recipientDisplayName.trim() || null
            : null
      };
    });
    const principal = this.principal(request);
    return this.campaigns.create({
      actor: {
        userId: principal.userId,
        membership: principal.membership
      },
      organizationId: principal.organizationId,
      idempotencyKey: this.requiredString(input.idempotencyKey, "idempotencyKey"),
      messageBody,
      recipients
    });
  }

  @Post(":campaignId/pause")
  pause(
    @Req() request: TenantRequest,
    @Param("campaignId", new ParseUUIDPipe({ version: "4" })) campaignId: string,
    @Body() input: BodyInput
  ) {
    return this.admin.pause(
      this.principal(request),
      campaignId,
      this.requiredString(input.reason, "reason")
    );
  }

  @Post(":campaignId/resume")
  resume(
    @Req() request: TenantRequest,
    @Param("campaignId", new ParseUUIDPipe({ version: "4" })) campaignId: string
  ) {
    return this.admin.resume(this.principal(request), campaignId);
  }

  @Post(":campaignId/cancel")
  cancel(
    @Req() request: TenantRequest,
    @Param("campaignId", new ParseUUIDPipe({ version: "4" })) campaignId: string,
    @Body() input: BodyInput
  ) {
    return this.admin.cancel(
      this.principal(request),
      campaignId,
      this.requiredString(input.reason, "reason")
    );
  }

  @Post(":campaignId/retry")
  retry(
    @Req() request: TenantRequest,
    @Param("campaignId", new ParseUUIDPipe({ version: "4" })) campaignId: string
  ) {
    return this.admin.retryFailed(this.principal(request), campaignId);
  }

  private principal(request: TenantRequest) {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(field + " is required.");
    }
    return value.trim();
  }
}
