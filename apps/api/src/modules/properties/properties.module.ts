import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { AssetCommandController } from "./application/asset-command.controller.js";
import { AssetCommandService } from "./application/asset-command.service.js";
import { AssetReadController } from "./application/asset-read.controller.js";
import { AssetReadService } from "./application/asset-read.service.js";
import { PropertyImportController } from "./application/property-import.controller.js";
import { PropertyImportService } from "./application/property-import.service.js";
import { RoomApplicationService } from "./application/room-application.service.js";
import { RoomEquipmentService } from "./application/room-equipment.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, CommercialModule],
  controllers: [
    AssetReadController,
    AssetCommandController,
    PropertyImportController
  ],
  providers: [
    RoomApplicationService,
    AssetReadService,
    AssetCommandService,
    RoomEquipmentService,
    PropertyImportService
  ],
  exports: [
    RoomApplicationService,
    AssetReadService,
    AssetCommandService,
    RoomEquipmentService,
    PropertyImportService
  ]
})
export class PropertiesModule {}

