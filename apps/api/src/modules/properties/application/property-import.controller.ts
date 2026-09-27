import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type { Response } from "express";
import { TenantPrincipalGuard } from "../../identity/tenant-principal.guard.js";
import type {
  TenantPrincipal,
  TenantRequest
} from "../../identity/tenant-principal.js";
import {
  generatePropertyImportTemplateWorkbook,
  type PropertyImportPayload
} from "./excel-property.helper.js";
import { PropertyImportService } from "./property-import.service.js";

@Controller("admin/assets/import")
@UseGuards(TenantPrincipalGuard)
export class PropertyImportController {
  constructor(private readonly importService: PropertyImportService) {}

  @Get("template")
  getTemplate(@Res() res: Response) {
    const buffer = generatePropertyImportTemplateWorkbook();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="Mau_Nhap_Co_So_Phong_Tai_San.xlsx"'
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
