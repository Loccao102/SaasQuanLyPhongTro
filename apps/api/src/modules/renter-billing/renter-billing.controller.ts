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
import { TenantPrincipalGuard } from "../identity/tenant-principal.guard.js";
import type {
  TenantPrincipal,
  TenantRequest
} from "../identity/tenant-principal.js";
import { RenterBillingService } from "./renter-billing.service.js";
import { RenterPublicInvoiceService } from "./renter-public-invoice.service.js";
import { RenterInvoiceNotificationService } from "./renter-invoice-notification.service.js";

type BodyInput = Record<string, unknown>;

function requiredString(input: BodyInput, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(field + " is required.");
  }
  return value.trim();
}

function requiredUuid(input: BodyInput, field: string): string {
  const value = requiredString(input, field);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    throw new BadRequestException(field + " must be a UUID v4.");
  }
  return value;
}

@Controller("admin/renter-billing")
@UseGuards(TenantPrincipalGuard)
export class RenterBillingController {
  constructor(
    private readonly billing: RenterBillingService,
    private readonly publicInvoices: RenterPublicInvoiceService,
    private readonly invoiceNotifications: RenterInvoiceNotificationService
  ) {}

  @Get()
  list(@Req() request: TenantRequest) {
    return this.billing.list(this.principal(request));
  }

  @Get("cycles/:cycleId")
  detail(
    @Req() request: TenantRequest,
    @Param("cycleId", new ParseUUIDPipe({ version: "4" })) cycleId: string
  ) {
    return this.billing.detail(this.principal(request), cycleId);
  }

  @Post("cycles")
  createCycle(@Req() request: TenantRequest, @Body() input: BodyInput) {
    return this.billing.createCycle(this.principal(request), {
      id: requiredUuid(input, "id"),
      propertyId: requiredUuid(input, "propertyId"),
      code: requiredString(input, "code"),
      periodStart: requiredString(input, "periodStart"),
      periodEnd: requiredString(input, "periodEnd"),
      dueDate: requiredString(input, "dueDate")
    });
  }

  @Post("cycles/:cycleId/generate-rent")
  generateRent(
    @Req() request: TenantRequest,
    @Param("cycleId", new ParseUUIDPipe({ version: "4" })) cycleId: string
  ) {
    return this.billing.generateRentDrafts(this.principal(request), cycleId);
  }

  @Post("cycles/:cycleId/finalize")
  finalize(
    @Req() request: TenantRequest,
    @Param("cycleId", new ParseUUIDPipe({ version: "4" })) cycleId: string
  ) {
    return this.billing.finalizeCycle(this.principal(request), cycleId);
  }

  @Post("cycles/:cycleId/notification-campaign")
  createInvoiceNotificationCampaign(
    @Req() request: TenantRequest,
    @Param("cycleId", new ParseUUIDPipe({ version: "4" })) cycleId: string,
    @Body() input: BodyInput
  ) {
    return this.invoiceNotifications.createCycleCampaign(
      this.principal(request),
      cycleId,
      requiredString(input, "idempotencyKey")
    );
  }

  @Post("invoices/:invoiceId/public-link")
  issuePublicLink(
    @Req() request: TenantRequest,
    @Param("invoiceId", new ParseUUIDPipe({ version: "4" })) invoiceId: string
  ) {
    return this.publicInvoices.issueAccess(this.principal(request), invoiceId);
  }

  @Post("invoices/:invoiceId/public-link/revoke")
  revokePublicLink(
    @Req() request: TenantRequest,
    @Param("invoiceId", new ParseUUIDPipe({ version: "4" })) invoiceId: string
  ) {
    return this.publicInvoices.revokeAccess(this.principal(request), invoiceId);
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}
