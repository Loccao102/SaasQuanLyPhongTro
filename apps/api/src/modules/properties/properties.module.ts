import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { AssetManagementController } from "./application/asset-management.controller.js";
import { AssetReadController } from "./application/asset-read.controller.js";
import { AssetReadService } from "./application/asset-read.service.js";
import { FloorApplicationService } from "./application/floor-application.service.js";
import { PropertyApplicationService } from "./application/property-application.service.js";
import { RoomApplicationService } from "./application/room-application.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, CommercialModule],
  controllers: [AssetReadController, AssetManagementController],
  providers: [
    RoomApplicationService,
    PropertyApplicationService,
    FloorApplicationService,
    AssetReadService
  ],
  exports: [
    RoomApplicationService,
    PropertyApplicationService,
    FloorApplicationService,
    AssetReadService
  ]
})
export class PropertiesModule {}
