import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type { Request } from "express";
import { AuthSecurityService } from "../identity/auth/auth-security.service.js";
import { TenantPrincipalGuard } from "../identity/tenant-principal.guard.js";
import { RequireTenantFeature } from "../identity/tenant-feature.js";
import type { TenantPrincipal, TenantRequest } from "../identity/tenant-principal.js";
import { MaintenanceService } from "./maintenance.service.js";
import type {
  CreateMaintenanceTicketInput,
  MaintenanceFilterQuery,
  UpdateMaintenanceTicketInput
} from "./maintenance.types.js";

@RequireTenantFeature("maintenance")
@Controller("admin/maintenance")
@UseGuards(TenantPrincipalGuard)
export class MaintenanceController {
  constructor(private readonly service: MaintenanceService) {}

  @Get()
  list(@Req() req: TenantRequest, @Query() query: MaintenanceFilterQuery) {
    return this.service.list(this.principal(req), query);
  }

  @Get(":ticketId")
  getById(
    @Req() req: TenantRequest,
    @Param("ticketId", new ParseUUIDPipe({ version: "4" })) ticketId: string
  ) {
    return this.service.getById(this.principal(req), ticketId);
  }

  @Post()
  create(@Req() req: TenantRequest, @Body() body: CreateMaintenanceTicketInput) {
    if (!body.propertyId) {
      throw new BadRequestException("propertyId là bắt buộc.");
    }
    return this.service.create(this.principal(req), body);
  }

  @Patch(":ticketId")
  update(
    @Req() req: TenantRequest,
    @Param("ticketId", new ParseUUIDPipe({ version: "4" })) ticketId: string,
    @Body() body: UpdateMaintenanceTicketInput
  ) {
    return this.service.update(this.principal(req), ticketId, body);
  }

  @Delete(":ticketId")
  delete(
    @Req() req: TenantRequest,
    @Param("ticketId", new ParseUUIDPipe({ version: "4" })) ticketId: string
  ) {
    return this.service.delete(this.principal(req), ticketId);
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}

@Controller("public/maintenance")
export class PublicMaintenanceController {
  constructor(
    private readonly service: MaintenanceService,
    private readonly security: AuthSecurityService
  ) {}

  @Get(":token")
  async listPublic(
    @Req() request: Request,
    @Param("token") token: string
  ) {
    await this.security.assertPublicMaintenanceAllowed(
      request.ip || request.socket.remoteAddress || "unknown"
    );
    return this.service.listForPublicInvoice(token);
  }

  @Post(":token")
  async createPublic(
    @Req() request: Request,
    @Param("token") token: string,
    @Body()
    body: {
      title: string;
      category?: string;
      description: string;
      residentName?: string;
      residentPhone?: string;
      images?: string[];
    }
  ) {
    await this.security.assertPublicMaintenanceAllowed(
      request.ip || request.socket.remoteAddress || "unknown"
    );
    if (!/^habi_inv_[A-Za-z0-9_-]{32}$/.test(token.trim())) {
      throw new NotFoundException(
        "Đường link hoá đơn không hợp lệ hoặc đã hết hạn."
      );
    }
    return this.service.createFromPublicInvoice(token, body);
  }
}
