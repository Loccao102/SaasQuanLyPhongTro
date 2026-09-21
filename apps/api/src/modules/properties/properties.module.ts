import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { RoomApplicationService } from "./application/room-application.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, CommercialModule],
  providers: [RoomApplicationService],
  exports: [RoomApplicationService]
})
export class PropertiesModule {}
