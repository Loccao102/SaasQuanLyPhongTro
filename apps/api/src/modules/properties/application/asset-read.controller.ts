import {
  Controller,
  Get,
  Param,
  Req,
  UseGuards
} from "@nestjs/common";
import { TenantPrincipalGuard } from "../../identity/tenant-principal.guard.js";
import type {
  TenantPrincipal,
  TenantRequest
} from "../../identity/tenant-principal.js";
import { AssetReadService } from "./asset-read.service.js";

@Controller("admin/assets")
@UseGuards(TenantPrincipalGuard)
export class AssetReadController {
  constructor(private readonly assets: AssetReadService) {}

  @Get()
  overview(@Req() request: TenantRequest) {
    return this.assets.overview(this.principal(request));
  }

  @Get("properties/:propertyId")
  property(
    @Req() request: TenantRequest,
    @Param("propertyId") propertyId: string
  ) {
    return this.assets.property(this.principal(request), propertyId);
  }

  @Get("rooms/:roomId")
  room(
    @Req() request: TenantRequest,
    @Param("roomId") roomId: string
  ) {
    return this.assets.room(this.principal(request), roomId);
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}
