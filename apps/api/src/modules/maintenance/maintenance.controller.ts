import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { TenantPrincipalGuard } from "../identity/tenant-principal.guard.js";
import type { TenantPrincipal, TenantRequest } from "../identity/tenant-principal.js";
import { MaintenanceService } from "./maintenance.service.js";
import type {
  CreateMaintenanceTicketInput,
  MaintenanceFilterQuery,
  UpdateMaintenanceTicketInput
} from "./maintenance.types.js";

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
  constructor(private readonly service: MaintenanceService) {}

  @Post(":token")
  createPublic(
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
    if (!token || token.trim().length === 0) {
      throw new BadRequestException("Mã token không hợp lệ.");
    }
    return this.service.createFromPublicInvoice(token, body);
  }
}
