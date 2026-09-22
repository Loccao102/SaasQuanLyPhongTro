import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { AssetReadController } from "./application/asset-read.controller.js";
import { AssetReadService } from "./application/asset-read.service.js";
import { RoomApplicationService } from "./application/room-application.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, CommercialModule],
  controllers: [AssetReadController],
  providers: [RoomApplicationService, AssetReadService],
  exports: [RoomApplicationService, AssetReadService]
})
export class PropertiesModule {}
