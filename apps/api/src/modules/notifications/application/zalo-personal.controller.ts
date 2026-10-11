import { Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { TenantPrincipalGuard } from "../../identity/tenant-principal.guard.js";
import { RequireTenantFeature } from "../../identity/tenant-feature.js";
import type { TenantRequest } from "../../identity/tenant-principal.js";
import { ZaloPersonalService } from "./zalo-personal.service.js";

@RequireTenantFeature("notifications")
@Controller("admin/zalo-personal")
@UseGuards(TenantPrincipalGuard)
export class ZaloPersonalController {
  constructor(private readonly zalo: ZaloPersonalService) {}

  private principal(request: TenantRequest) {
    if (!request.tenantPrincipal) throw new Error("Tenant principal missing.");
    return request.tenantPrincipal;
  }

  @Get()
  status(@Req() request: TenantRequest) {
    return this.zalo.status(this.principal(request));
  }

  @Post("connect")
  connect(@Req() request: TenantRequest) {
    return this.zalo.begin(this.principal(request));
  }

  @Post("disconnect")
  disconnect(@Req() request: TenantRequest) {
    return this.zalo.disconnect(this.principal(request));
  }
}
