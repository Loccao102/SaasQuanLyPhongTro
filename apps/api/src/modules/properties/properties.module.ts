import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { AssetCommandController } from "./application/asset-command.controller.js";
import { AssetCommandService } from "./application/asset-command.service.js";
import { AssetReadController } from "./application/asset-read.controller.js";
import { AssetReadService } from "./application/asset-read.service.js";
import { RoomApplicationService } from "./application/room-application.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, CommercialModule],
  controllers: [AssetReadController, AssetCommandController],
  providers: [RoomApplicationService, AssetReadService, AssetCommandService],
  exports: [RoomApplicationService, AssetReadService, AssetCommandService]
})
export class PropertiesModule {}
