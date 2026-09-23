import { Module } from "@nestjs/common";
import { CommercialModule } from "../commercial/commercial.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { MeteringController } from "./metering.controller.js";
import { MeteringService } from "./metering.service.js";
import { StaffMeteringController } from "./staff-metering.controller.js";
import { StaffMeteringService } from "./staff-metering.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, CommercialModule],
  controllers: [MeteringController, StaffMeteringController],
  providers: [MeteringService, StaffMeteringService],
  exports: [MeteringService, StaffMeteringService]
})
export class MeteringModule {}
