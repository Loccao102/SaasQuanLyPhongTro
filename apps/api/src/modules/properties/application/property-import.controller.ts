import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type { Response } from "express";
import { TenantPrincipalGuard } from "../../identity/tenant-principal.guard.js";
import { RequireTenantFeature } from "../../identity/tenant-feature.js";
import type {
  TenantPrincipal,
  TenantRequest
} from "../../identity/tenant-principal.js";
import type { PropertyImportPayload } from "./excel-property.helper.js";
import { PropertyImportService } from "./property-import.service.js";

@RequireTenantFeature("properties")
@Controller("admin/assets/import")
@UseGuards(TenantPrincipalGuard)
export class PropertyImportController {
  constructor(private readonly importService: PropertyImportService) {}

  @Get("template")
  async getTemplate(
    @Req() request: TenantRequest,
    @Res() res: Response,
    @Query("propertyId") propertyId?: string
  ) {
    const { buffer, filename } = await this.importService.generateTemplate(
      this.principal(request),
      propertyId
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.send(buffer);
  }

  @Post("validate")
  async validate(
    @Req() request: TenantRequest,
    @Body() body: { payload: PropertyImportPayload }
  ) {
    if (!body?.payload) {
      throw new BadRequestException("Thiếu dữ liệu payload.");
    }
    return this.importService.validate(this.principal(request), body.payload);
  }

  @Post("execute")
  async execute(
    @Req() request: TenantRequest,
    @Body() body: { payload: PropertyImportPayload }
  ) {
    if (!body?.payload) {
      throw new BadRequestException("Thiếu dữ liệu payload.");
    }
    return this.importService.execute(this.principal(request), body.payload);
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new BadRequestException("Principal not found in request.");
    }
    return request.tenantPrincipal;
  }
}
