import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards
} from "@nestjs/common";
import { TenantPrincipalGuard } from "../../identity/tenant-principal.guard.js";
import type {
  TenantPrincipal,
  TenantRequest
} from "../../identity/tenant-principal.js";
import { AssetReadService } from "./asset-read.service.js";
import { RoomEquipmentService } from "./room-equipment.service.js";

@Controller("admin/assets")
@UseGuards(TenantPrincipalGuard)
export class AssetReadController {
  constructor(
    private readonly assets: AssetReadService,
    private readonly equipment: RoomEquipmentService
  ) {}

  @Get()
  overview(@Req() request: TenantRequest) {
    return this.assets.overview(this.principal(request));
  }

  @Get("properties/:propertyId")
  property(
    @Req() request: TenantRequest,
    @Param("propertyId", new ParseUUIDPipe({ version: "4" })) propertyId: string
  ) {
    return this.assets.property(this.principal(request), propertyId);
  }

  @Get("rooms/:roomId")
  room(
    @Req() request: TenantRequest,
    @Param("roomId", new ParseUUIDPipe({ version: "4" })) roomId: string
  ) {
    return this.assets.room(this.principal(request), roomId);
  }

  @Get("rooms/:roomId/equipment")
  roomEquipment(
    @Req() request: TenantRequest,
    @Param("roomId", new ParseUUIDPipe({ version: "4" })) roomId: string
  ) {
    return this.equipment.listByRoom(this.principal(request), roomId);
  }

  private principal(request: TenantRequest): TenantPrincipal {
    if (!request.tenantPrincipal) {
      throw new Error("TenantPrincipalGuard did not attach a principal.");
    }
    return request.tenantPrincipal;
  }
}
