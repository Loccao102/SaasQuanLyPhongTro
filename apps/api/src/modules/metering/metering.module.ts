import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { MeteringController } from "./metering.controller.js";
import { MeteringService } from "./metering.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, CommercialModule],
  controllers: [MeteringController],
  providers: [MeteringService],
  exports: [MeteringService]
})
export class MeteringModule {}
